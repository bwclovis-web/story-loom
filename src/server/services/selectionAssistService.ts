import { createHash, randomBytes } from "node:crypto";
import { checkSize, chooseBoundary, describeSizeProblem } from "@/assistant/prompt";
import { ProviderError, type AssistantProvider, type ProviderRequest, type ProviderUsage } from "@/assistant/provider";
import { newId } from "@/domain/ids";
import { isRecordType } from "@/domain/recordTypes";
import { normalizeNewlines } from "@/proofread/anchors";
import {
  parseSelectionAssistOutput,
  SELECTION_ASSIST_OUTPUT_JSON_SCHEMA,
  SELECTION_ASSIST_SCHEMA_CHARS,
  SELECTION_ASSIST_SCHEMA_NAME,
  type SelectionAssistAction,
} from "@/selectionAssist/output";
import { buildSelectionAssistRequest } from "@/selectionAssist/prompt";
import type { Db } from "../db";
import { LIVE_RECORD } from "./trashFilters";
import { AssistantError, checkRequestLimits, estimatedUsage, loadAuthorReferenceDocuments, type AssistantRuntime } from "./assistantService";
import { getPromptPreset, normalizeAuthorInstructionText } from "./promptPresetService";
import { listReadingPins } from "./readingPinService";

/*
 * AI writing assist on a selected passage in the editor. Read-only: it never writes
 * records or revisions. The author accepts or dismisses the suggestion in the
 * text box; saving uses the normal record save (revision check and protection).
 * Codex context comes from reading pins for the active manuscript draft.
 */

export type SelectionAssistStatus = "complete" | "incomplete" | "cancelled" | "failed";

export interface SelectionAssistInput {
  projectId: string;
  recordId: string;
  revision: number;
  range: { start: number; end: number };
  action: SelectionAssistAction;
  /** Manuscript draft id for reading pins, or "" when the project has no drafts. */
  scopeDraftId: string;
  /** Pin record ids omitted after Context Inspector toggles. */
  excludeRecordIds?: readonly string[];
  /** Optional saved preset or custom lens text appended to instructions. */
  authorInstructionText?: string | null;
  promptPresetId?: string | null;
}

export interface PreparedSelectionAssist {
  runId: string;
  recordId: string;
  revision: number;
  range: { start: number; end: number };
  action: SelectionAssistAction;
  /** Full record text; the suggestion replaces range in this string. */
  text: string;
  request: ProviderRequest;
  requestChars: number;
}

export interface SelectionAssistResult {
  runId: string;
  recordId: string;
  revision: number;
  range: { start: number; end: number };
  action: SelectionAssistAction;
  status: SelectionAssistStatus;
  errorCode: string | null;
  errorMessage: string | null;
  replacement: string | null;
  note: string | null;
  contextRecordIds: string[];
  model: string;
  usage: (ProviderUsage & { estimated: boolean }) | null;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function markInterrupted(db: Db, timeoutSeconds: number, now: Date): Promise<void> {
  await db.proofreadRun.updateMany({
    where: { status: "running", createdAt: { lt: new Date(now.getTime() - (timeoutSeconds + 60) * 1000) } },
    data: { status: "failed", errorCode: "interrupted", errorMessage: "The app stopped before the request finished.", completedAt: now },
  });
}

export async function prepareSelectionAssist(
  db: Db,
  runtime: AssistantRuntime,
  input: SelectionAssistInput,
  now = new Date(),
): Promise<PreparedSelectionAssist> {
  if (!runtime.configured || !runtime.model) {
    throw new AssistantError("NOT_CONFIGURED", "Writing assist uses the assistant, which is not set up. See How to use, \"Assistant setup\".");
  }
  const { limits } = runtime;
  const record = await db.record.findFirst({
    where: { id: input.recordId, projectId: input.projectId, ...LIVE_RECORD },
    include: { project: true },
  });
  if (!record || !isRecordType(record.type)) throw new AssistantError("NOT_FOUND", "That record is not in this project.");
  if (record.currentRevision !== input.revision) {
    throw new AssistantError(
      "STALE_SELECTION",
      `"${record.title}" was saved again since this page was loaded (revision ${input.revision} is now ${record.currentRevision}). Reload the page, then try again.`,
    );
  }
  const revision = await db.revision.findUnique({
    where: { recordId_revisionNumber: { recordId: record.id, revisionNumber: input.revision } },
  });
  if (!revision) throw new AssistantError("NOT_FOUND", `Revision ${input.revision} of "${record.title}" does not exist.`);

  const text = normalizeNewlines(revision.body);
  const r = input.range;
  if (!Number.isInteger(r.start) || !Number.isInteger(r.end) || r.start < 0 || r.end > text.length || r.start >= r.end) {
    throw new AssistantError("INVALID_REQUEST", "The selection is not inside the saved text. Select the text again.");
  }
  const sent = text.slice(r.start, r.end);
  if (!sent.trim()) throw new AssistantError("INVALID_REQUEST", "There is no text in the selection.");

  await markInterrupted(db, limits.requestTimeoutSeconds, now);
  if (await db.proofreadRun.count({ where: { recordId: record.id, status: "running" } })) {
    throw new AssistantError("BUSY", "An assistant request is already running for this record. Wait for it or cancel it.");
  }

  const excluded = new Set(input.excludeRecordIds ?? []);
  const pins = (await listReadingPins(db, input.projectId, input.scopeDraftId)).filter((p) => !excluded.has(p.recordId));
  const contextDocs = await loadAuthorReferenceDocuments(
    db,
    input.projectId,
    pins.map((p) => ({ recordId: p.recordId, revision: p.currentRevision })),
  );

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
  const size = checkSize(built, limits.maxInputChars);
  if (size) throw new AssistantError("TOO_LARGE", describeSizeProblem(size), size);
  await checkRequestLimits(db, limits, built.totalChars, now);

  const runId = newId("prf");
  await db.proofreadRun.create({
    data: {
      id: runId,
      workspaceId: record.project.workspaceId,
      projectId: record.projectId,
      recordId: record.id,
      revisionNumber: input.revision,
      mode: "selection_assist",
      scope: "selection",
      rangeStart: r.start,
      rangeEnd: r.end,
      contentHash: sha256(sent),
      status: "running",
      model: runtime.model,
      requestChars: built.totalChars,
      dictionaryTermCount: 0,
      createdAt: now,
    },
  });

  return {
    runId,
    recordId: record.id,
    revision: input.revision,
    range: r,
    action: input.action,
    text,
    requestChars: built.totalChars,
    request: {
      model: runtime.model,
      instructions: built.instructions,
      input: built.input,
      maxOutputTokens: limits.maxOutputTokens,
      timeoutMs: limits.requestTimeoutSeconds * 1000,
    },
  };
}

export async function runSelectionAssist(
  db: Db,
  provider: AssistantProvider,
  prep: PreparedSelectionAssist,
  contextRecordIds: string[],
  signal: AbortSignal,
  onDelta?: (text: string) => void,
): Promise<SelectionAssistResult> {
  let status: SelectionAssistStatus = "failed";
  let errorCode: string | null = null;
  let errorMessage: string | null = null;
  let usage: ProviderUsage | undefined;
  let usageEstimated = false;
  let responseId: string | undefined;
  let replacement: string | null = null;
  let note: string | null = null;

  try {
    const schema = { name: SELECTION_ASSIST_SCHEMA_NAME, schema: SELECTION_ASSIST_OUTPUT_JSON_SCHEMA };
  if (onDelta) {
      let streamed = "";
      let doneStatus: "complete" | "incomplete" = "complete";
      let incompleteReason: string | undefined;
      for await (const event of provider.stream(prep.request, signal)) {
        if (event.type === "delta") {
          streamed += event.text;
          onDelta(event.text);
        } else if (event.type === "done") {
          if (event.usage) usage = event.usage;
          doneStatus = event.status;
          incompleteReason = event.incompleteReason;
          responseId = event.responseId;
        }
      }
      if (signal.aborted) throw new ProviderError("cancelled", "The request was cancelled.");
      if (!usage) {
        usage = estimatedUsage(prep.requestChars, streamed.length);
        usageEstimated = true;
      }
      if (doneStatus === "incomplete") {
        status = "incomplete";
        errorCode = incompleteReason ?? "incomplete";
        errorMessage =
          incompleteReason === "max_output_tokens"
            ? "The response stopped at the output limit (ASSISTANT_MAX_OUTPUT_TOKENS) before it finished. Nothing from the partial response is shown. Try a shorter selection."
            : `The response is incomplete (${incompleteReason ?? "no reason given"}). Nothing from the partial response is shown.`;
      } else {
        const parsed = parseSelectionAssistOutput(streamed);
        if (!parsed.ok) {
          errorCode = "malformed_output";
          errorMessage = `The model's response did not match the expected format, so no suggestion is shown. ${parsed.problems.join(" ")}`;
        } else {
          status = "complete";
          replacement = parsed.replacement;
          note = parsed.note;
        }
      }
    } else {
      const result = await provider.structured(prep.request, schema, signal);
      if (signal.aborted) throw new ProviderError("cancelled", "The request was cancelled.");
      responseId = result.responseId;
      const outputChars = result.status === "complete" ? result.text.length : result.status === "refused" ? result.refusal.length : 0;
      if (result.usage) usage = result.usage;
      else {
        usage = estimatedUsage(prep.requestChars, outputChars);
        usageEstimated = true;
      }

      if (result.status === "refused") {
        errorCode = "refused";
        errorMessage = "The model declined to suggest a revision. No suggestion was made.";
      } else if (result.status === "incomplete") {
        status = "incomplete";
        errorCode = result.incompleteReason ?? "incomplete";
        errorMessage =
          result.incompleteReason === "max_output_tokens"
            ? "The response stopped at the output limit (ASSISTANT_MAX_OUTPUT_TOKENS) before it finished. Nothing from the partial response is shown. Try a shorter selection."
            : `The response is incomplete (${result.incompleteReason ?? "no reason given"}). Nothing from the partial response is shown.`;
      } else {
        const parsed = parseSelectionAssistOutput(result.text);
        if (!parsed.ok) {
          errorCode = "malformed_output";
          errorMessage = `The model's response did not match the expected format, so no suggestion is shown. ${parsed.problems.join(" ")}`;
        } else {
          status = "complete";
          replacement = parsed.replacement;
          note = parsed.note;
        }
      }
    }
  } catch (error) {
    const e = error instanceof ProviderError ? error : new ProviderError("provider_failed", "The writing assist request failed unexpectedly.");
    const cancelled = e.code === "cancelled" || signal.aborted;
    status = cancelled ? "cancelled" : "failed";
    errorCode = cancelled ? "cancelled" : e.code;
    errorMessage = cancelled ? "Cancelled. No suggestion was made." : e.message;
    if (cancelled) {
      usage = estimatedUsage(prep.requestChars, 0);
      usageEstimated = true;
    }
  }

  const row = await db.proofreadRun.update({
    where: { id: prep.runId },
    data: {
      status,
      errorCode,
      errorMessage,
      providerResponseId: responseId ?? null,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      totalTokens: usage?.totalTokens ?? null,
      usageEstimated,
      suggestionCount: replacement ? 1 : 0,
      rejectedCount: 0,
      completedAt: new Date(),
    },
  });

  return {
    runId: prep.runId,
    recordId: prep.recordId,
    revision: prep.revision,
    range: prep.range,
    action: prep.action,
    status,
    errorCode,
    errorMessage,
    replacement,
    note,
    contextRecordIds,
    model: row.model ?? prep.request.model,
    usage: usage ? { ...usage, estimated: usageEstimated } : null,
  };
}