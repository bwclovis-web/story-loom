import "server-only";
import { randomBytes } from "node:crypto";
import { estimateTokens } from "@/assistant/config";
import { checkSize, chooseBoundary, describeSizeProblem, type BuiltRequest } from "@/assistant/prompt";
import { isRecordType } from "@/domain/recordTypes";
import { normalizeNewlines } from "@/proofread/anchors";
import { buildProofreadRequest } from "@/proofread/prompt";
import { dictionaryWordsIn } from "@/spelling/dictionary";
import { getPromptPreset, normalizeAuthorInstructionText } from "./promptPresetService";
import { buildSelectionAssistRequest } from "@/selectionAssist/prompt";
import { SELECTION_ASSIST_SCHEMA_CHARS, type SelectionAssistAction } from "@/selectionAssist/output";
import type { Db } from "../db";
import { AssistantError, loadAuthorReferenceDocuments, type AssistantRuntime } from "./assistantService";
import { dictionaryWordsForProject } from "./dictionaryService";
import { PROOFREAD_SCHEMA_CHARS } from "./proofreadService";
import { listReadingPins } from "./readingPinService";
import { LIVE_RECORD } from "./trashFilters";

/*
 * Pre-flight Context Inspector: builds the exact payload items that would be
 * sent, with character counts and a token estimate. Never creates a run and
 * never calls the model. Toggleable item ids can be omitted on the real send.
 */

export type ContextInspectKind = "instructions" | "schema" | "manuscript" | "reference" | "dictionary" | "framing";

export interface ContextInspectItem {
  id: string;
  kind: ContextInspectKind;
  label: string;
  chars: number;
  /** Short preview of what would be sent (never secrets). */
  preview: string;
  toggleable: boolean;
}

export interface ContextInspectReport {
  kind: "proofread" | "selection_assist";
  items: ContextInspectItem[];
  totalChars: number;
  estimatedTokens: number;
  model: string | null;
  limitChars: number;
  overLimit: boolean;
}

function previewOf(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1)}…`;
}

function itemsFromBuilt(
  built: BuiltRequest,
  extras: { id: string; kind: ContextInspectKind; label: string; preview: string; toggleable: boolean; chars: number }[],
): ContextInspectItem[] {
  // Prefer explicit extras (with stable ids) when provided; fall back to size items.
  if (extras.length) return extras.map((e) => ({ ...e }));
  return built.items.map((item, index) => ({
    id: `item-${index}`,
    kind: "framing" as const,
    label: item.label,
    chars: item.chars,
    preview: "",
    toggleable: false,
  }));
}

export async function inspectProofreadContext(
  db: Db,
  runtime: AssistantRuntime,
  input: {
    projectId: string;
    recordId: string;
    revision: number;
    range?: { start: number; end: number } | null;
    /** Dictionary word strings to omit from the payload. */
    excludeDictionaryWords?: readonly string[];
  },
): Promise<ContextInspectReport> {
  if (!runtime.configured || !runtime.model) {
    throw new AssistantError("NOT_CONFIGURED", "The assistant is not set up. See How to use, \"Assistant setup\".");
  }
  const record = await db.record.findFirst({
    where: { id: input.recordId, projectId: input.projectId, ...LIVE_RECORD },
  });
  if (!record || !isRecordType(record.type)) throw new AssistantError("NOT_FOUND", "That record is not in this project.");
  if (record.currentRevision !== input.revision) {
    throw new AssistantError("STALE_SELECTION", `"${record.title}" was saved again. Reload, then inspect again.`);
  }
  const revision = await db.revision.findUnique({
    where: { recordId_revisionNumber: { recordId: record.id, revisionNumber: input.revision } },
  });
  if (!revision) throw new AssistantError("NOT_FOUND", `Revision ${input.revision} does not exist.`);

  const text = normalizeNewlines(revision.body);
  const r = input.range;
  if (r && (!Number.isInteger(r.start) || !Number.isInteger(r.end) || r.start < 0 || r.end > text.length || r.start >= r.end)) {
    throw new AssistantError("INVALID_REQUEST", "The selection is not inside the saved text.");
  }
  const range = r ?? { start: 0, end: text.length };
  const scope = r ? "selection" : "document";
  const sent = text.slice(range.start, range.end);
  if (!sent.trim()) throw new AssistantError("INVALID_REQUEST", "There is no text to inspect.");

  const excluded = new Set((input.excludeDictionaryWords ?? []).map((w) => w.toLocaleLowerCase()));
  const allWords = dictionaryWordsIn(sent, await dictionaryWordsForProject(db, record.projectId));
  const acceptedWords = allWords.filter((w) => !excluded.has(w.word.toLocaleLowerCase()));
  const boundary = chooseBoundary([sent, ...acceptedWords.map((w) => w.word)], () => randomBytes(6).toString("hex"));
  const built = buildProofreadRequest(
    { recordId: record.id, title: revision.title, type: record.type, revision: input.revision, scope, range, text: sent },
    boundary,
    PROOFREAD_SCHEMA_CHARS,
    acceptedWords,
  );
  const size = checkSize(built, runtime.limits.maxInputChars);

  const items: ContextInspectItem[] = [
    {
      id: "instructions",
      kind: "instructions",
      label: "Proofread instructions (fixed)",
      chars: built.items[0]?.chars ?? 0,
      preview: previewOf(built.instructions),
      toggleable: false,
    },
    {
      id: "manuscript",
      kind: "manuscript",
      label: scope === "selection" ? "Selected passage" : "Whole document",
      chars: sent.length,
      preview: previewOf(sent),
      toggleable: false,
    },
    ...allWords.map((w) => ({
      id: `dict:${w.word}`,
      kind: "dictionary" as const,
      label: `Dictionary: ${w.word}${w.caseSensitive ? " (match case)" : ""}`,
      chars: w.word.length,
      preview: w.word,
      toggleable: true,
    })),
  ];

  const activeChars = items
    .filter((i) => i.id === "instructions" || i.id === "manuscript" || !excluded.has(i.label.replace(/^Dictionary: /i, "").split(" ")[0]!.toLocaleLowerCase()))
    .reduce((n, i) => n + i.chars, 0);

  return {
    kind: "proofread",
    items,
    totalChars: size ? built.totalChars : built.totalChars,
    estimatedTokens: estimateTokens(built.totalChars),
    model: runtime.model,
    limitChars: runtime.limits.maxInputChars,
    overLimit: Boolean(size),
  };
}

export async function inspectSelectionAssistContext(
  db: Db,
  runtime: AssistantRuntime,
  input: {
    projectId: string;
    recordId: string;
    revision: number;
    range: { start: number; end: number };
    action: SelectionAssistAction;
    scopeDraftId: string;
    /** Pin record ids to omit from the payload. */
    excludeRecordIds?: readonly string[];
    authorInstructionText?: string | null;
    promptPresetId?: string | null;
  },
): Promise<ContextInspectReport> {
  if (!runtime.configured || !runtime.model) {
    throw new AssistantError("NOT_CONFIGURED", "The assistant is not set up. See How to use, \"Assistant setup\".");
  }
  const record = await db.record.findFirst({
    where: { id: input.recordId, projectId: input.projectId, ...LIVE_RECORD },
  });
  if (!record || !isRecordType(record.type)) throw new AssistantError("NOT_FOUND", "That record is not in this project.");
  if (record.currentRevision !== input.revision) {
    throw new AssistantError("STALE_SELECTION", `"${record.title}" was saved again. Reload, then inspect again.`);
  }
  const revision = await db.revision.findUnique({
    where: { recordId_revisionNumber: { recordId: record.id, revisionNumber: input.revision } },
  });
  if (!revision) throw new AssistantError("NOT_FOUND", `Revision ${input.revision} does not exist.`);

  const text = normalizeNewlines(revision.body);
  const r = input.range;
  if (!Number.isInteger(r.start) || !Number.isInteger(r.end) || r.start < 0 || r.end > text.length || r.start >= r.end) {
    throw new AssistantError("INVALID_REQUEST", "The selection is not inside the saved text.");
  }
  const sent = text.slice(r.start, r.end);
  if (!sent.trim()) throw new AssistantError("INVALID_REQUEST", "There is no text in the selection.");

  const excluded = new Set(input.excludeRecordIds ?? []);
  const pins = await listReadingPins(db, input.projectId, input.scopeDraftId);
  const pinRefs = pins.filter((p) => !excluded.has(p.recordId)).map((p) => ({ recordId: p.recordId, revision: p.currentRevision }));
  const contextDocs = await loadAuthorReferenceDocuments(db, input.projectId, pinRefs, {
    mode: "drafting",
    focusRecordId: record.id,
  });
  let authorInstructionText = normalizeAuthorInstructionText(input.authorInstructionText);
  if (input.promptPresetId) {
    const preset = await getPromptPreset(db, input.projectId, input.promptPresetId);
    if (preset.surface !== "selection") {
      throw new AssistantError("INVALID_REQUEST", "That preset is for a different assistant surface. Choose a selection preset.");
    }
    if (!authorInstructionText) authorInstructionText = preset.instructionText;
  }
  const boundary = chooseBoundary([sent, ...contextDocs.map((d) => d.text)], () => randomBytes(6).toString("hex"));
  const built = buildSelectionAssistRequest(
    {
      recordId: record.id,
      title: revision.title,
      type: record.type,
      revision: input.revision,
      range: r,
      text: sent,
      action: input.action,
    },
    contextDocs,
    boundary,
    SELECTION_ASSIST_SCHEMA_CHARS,
    authorInstructionText,
  );
  const size = checkSize(built, runtime.limits.maxInputChars);
  if (size) {
    // Still return the report so the author can toggle items off; surface overLimit.
    void describeSizeProblem(size);
  }

  const allPins = pins;
  const items: ContextInspectItem[] = [
    {
      id: "instructions",
      kind: "instructions",
      label: "Selection-assist instructions (fixed)",
      chars: built.items[0]?.chars ?? 0,
      preview: previewOf(built.instructions),
      toggleable: false,
    },
    {
      id: "manuscript",
      kind: "manuscript",
      label: "Selected passage",
      chars: sent.length,
      preview: previewOf(sent),
      toggleable: false,
    },
    ...allPins.map((p) => {
      const doc = contextDocs.find((d) => d.recordId === p.recordId);
      const included = !excluded.has(p.recordId);
      return {
        id: `record:${p.recordId}`,
        kind: "reference" as const,
        label: `Pinned: ${doc?.title ?? p.recordId}`,
        chars: included && doc ? doc.text.length : 0,
        preview: included && doc ? previewOf(doc.text) : "(toggled off)",
        toggleable: true,
      };
    }),
  ];

  return {
    kind: "selection_assist",
    items,
    totalChars: built.totalChars,
    estimatedTokens: estimateTokens(built.totalChars),
    model: runtime.model,
    limitChars: runtime.limits.maxInputChars,
    overLimit: Boolean(size),
  };
}

void itemsFromBuilt;
