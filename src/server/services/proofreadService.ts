import { createHash, randomBytes } from "node:crypto";
import { checkSize, chooseBoundary, describeSizeProblem } from "@/assistant/prompt";
import { ProviderError, type AssistantProvider, type ProviderRequest, type ProviderUsage } from "@/assistant/provider";
import { newId } from "@/domain/ids";
import { isRecordType } from "@/domain/recordTypes";
import { normalizeNewlines, resolveSuggestions, type ProofreadSuggestion, type RejectedSuggestion } from "@/proofread/anchors";
import { parseProofreadOutput, PROOFREAD_OUTPUT_JSON_SCHEMA, PROOFREAD_SCHEMA_NAME } from "@/proofread/output";
import { buildProofreadRequest } from "@/proofread/prompt";
import { changesDictionaryWord, DictionaryMatcher, dictionaryWordsIn, type DictionaryWord } from "@/spelling/dictionary";
import type { Db } from "../db";
import { LIVE_RECORD } from "./trashFilters";
import { AssistantError, checkRequestLimits, estimatedUsage, type AssistantRuntime } from "./assistantService";
import { dictionaryWordsForProject } from "./dictionaryService";

/*
 * AI proofreading of one record's saved text, or a selected range of it.
 * Read-only: it never writes records or revisions. Suggestions go back to the
 * editor, where the author accepts or dismisses each one in the text box and
 * saves through the normal record save (revision check and protection apply).
 * Dictionary words that occur in the text are sent as accepted spellings.
 */

export const PROOFREAD_SCHEMA_CHARS = JSON.stringify(PROOFREAD_OUTPUT_JSON_SCHEMA).length;

export type ProofreadStatus = "complete" | "incomplete" | "cancelled" | "failed";

export interface ProofreadInput {
  projectId: string;
  recordId: string;
  /** The saved revision the editor shows; proofreading refuses if the record was saved again since. */
  revision: number;
  /** Characters to check, counted in the text with line endings as "\n"; null for the whole document. */
  range: { start: number; end: number } | null;
}

export interface PreparedProofread {
  runId: string;
  recordId: string;
  revision: number;
  scope: "document" | "selection";
  range: { start: number; end: number };
  /** The whole proofread text; suggestions are located in it. Kept in memory only. */
  text: string;
  /** Dictionary words sent as accepted spellings; suggestions that change them are left out. */
  acceptedWords: DictionaryWord[];
  request: ProviderRequest;
  requestChars: number;
}

export interface ProofreadResult {
  runId: string;
  recordId: string;
  revision: number;
  scope: "document" | "selection";
  range: { start: number; end: number };
  status: ProofreadStatus;
  errorCode: string | null;
  errorMessage: string | null;
  suggestions: ProofreadSuggestion[];
  rejected: RejectedSuggestion[];
  model: string;
  usage: (ProviderUsage & { estimated: boolean }) | null;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Marks runs left "running" by a stopped app as failed. */
async function markInterrupted(db: Db, timeoutSeconds: number, now: Date): Promise<void> {
  await db.proofreadRun.updateMany({
    where: { status: "running", createdAt: { lt: new Date(now.getTime() - (timeoutSeconds + 60) * 1000) } },
    data: { status: "failed", errorCode: "interrupted", errorMessage: "The app stopped before proofreading finished.", completedAt: now },
  });
}

export async function prepareProofread(db: Db, runtime: AssistantRuntime, input: ProofreadInput, now = new Date()): Promise<PreparedProofread> {
  if (!runtime.configured || !runtime.model) {
    throw new AssistantError("NOT_CONFIGURED", "Proofreading uses the assistant, which is not set up. See How to use, \"Assistant setup\".");
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
      `"${record.title}" was saved again since this page was loaded (revision ${input.revision} is now ${record.currentRevision}). Reload the page, then proofread again.`,
    );
  }
  const revision = await db.revision.findUnique({
    where: { recordId_revisionNumber: { recordId: record.id, revisionNumber: input.revision } },
  });
  if (!revision) throw new AssistantError("NOT_FOUND", `Revision ${input.revision} of "${record.title}" does not exist.`);

  const text = normalizeNewlines(revision.body);
  const r = input.range;
  if (r && (!Number.isInteger(r.start) || !Number.isInteger(r.end) || r.start < 0 || r.end > text.length || r.start >= r.end)) {
    throw new AssistantError("INVALID_REQUEST", "The selection is not inside the saved text. Select the text again.");
  }
  const range = r ?? { start: 0, end: text.length };
  const scope = r ? "selection" : "document";
  const sent = text.slice(range.start, range.end);
  if (!sent.trim()) throw new AssistantError("INVALID_REQUEST", "There is no text to proofread.");

  await markInterrupted(db, limits.requestTimeoutSeconds, now);
  if (await db.proofreadRun.count({ where: { recordId: record.id, status: "running" } })) {
    throw new AssistantError("BUSY", "Proofreading is already running for this record. Wait for it or cancel it.");
  }

  const acceptedWords = dictionaryWordsIn(sent, await dictionaryWordsForProject(db, record.projectId));
  const boundary = chooseBoundary([sent, ...acceptedWords.map((w) => w.word)], () => randomBytes(6).toString("hex"));
  const built = buildProofreadRequest(
    { recordId: record.id, title: revision.title, type: record.type, revision: input.revision, scope, range, text: sent },
    boundary,
    PROOFREAD_SCHEMA_CHARS,
    acceptedWords,
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
      scope,
      rangeStart: range.start,
      rangeEnd: range.end,
      contentHash: sha256(sent),
      status: "running",
      model: runtime.model,
      requestChars: built.totalChars,
      dictionaryTermCount: acceptedWords.length,
      createdAt: now,
    },
  });

  return {
    runId,
    recordId: record.id,
    revision: input.revision,
    scope,
    range,
    text,
    acceptedWords,
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

/**
 * Asks the provider for structured suggestions and always stores the outcome.
 * Refused, incomplete and malformed responses produce no suggestions.
 */
export async function runProofread(
  db: Db,
  provider: AssistantProvider,
  prep: PreparedProofread,
  signal: AbortSignal,
): Promise<ProofreadResult> {
  let status: ProofreadStatus = "failed";
  let errorCode: string | null = null;
  let errorMessage: string | null = null;
  let usage: ProviderUsage | undefined;
  let usageEstimated = false;
  let responseId: string | undefined;
  let suggestions: ProofreadSuggestion[] = [];
  let rejected: RejectedSuggestion[] = [];

  try {
    const result = await provider.structured(prep.request, { name: PROOFREAD_SCHEMA_NAME, schema: PROOFREAD_OUTPUT_JSON_SCHEMA }, signal);
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
      errorMessage = "The model declined to proofread this text. No suggestions were made.";
    } else if (result.status === "incomplete") {
      status = "incomplete";
      errorCode = result.incompleteReason ?? "incomplete";
      errorMessage =
        result.incompleteReason === "max_output_tokens"
          ? "Proofreading stopped at the output limit (ASSISTANT_MAX_OUTPUT_TOKENS) before it finished. Nothing from the partial response is shown. Proofread a shorter selection."
          : `Proofreading is incomplete (${result.incompleteReason ?? "no reason given"}). Nothing from the partial response is shown.`;
    } else {
      const parsed = parseProofreadOutput(result.text);
      if (!parsed.ok) {
        errorCode = "malformed_output";
        errorMessage = `The model's response did not match the proofreading format, so no suggestions are shown. ${parsed.problems.join(" ")}`;
      } else {
        status = "complete";
        const matcher = new DictionaryMatcher(prep.acceptedWords);
        ({ suggestions, rejected } = resolveSuggestions(prep.text, prep.range, parsed.suggestions, (d) =>
          changesDictionaryWord(d.original, d.replacement, matcher) ? "dictionary_word" : null,
        ));
      }
    }
  } catch (error) {
    const e = error instanceof ProviderError ? error : new ProviderError("provider_failed", "The proofreading request failed unexpectedly.");
    const cancelled = e.code === "cancelled" || signal.aborted;
    status = cancelled ? "cancelled" : "failed";
    errorCode = cancelled ? "cancelled" : e.code;
    errorMessage = cancelled ? "Cancelled. No suggestions were made." : e.message;
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
      suggestionCount: suggestions.length,
      rejectedCount: rejected.length,
      completedAt: new Date(),
    },
  });

  return {
    runId: prep.runId,
    recordId: prep.recordId,
    revision: prep.revision,
    scope: prep.scope,
    range: prep.range,
    status,
    errorCode,
    errorMessage,
    suggestions,
    rejected,
    model: row.model ?? prep.request.model,
    usage: usage ? { ...usage, estimated: usageEstimated } : null,
  };
}

/** Finds a run in this project, for the Cancel button. */
export async function findProofreadRun(db: Db, projectId: string, runId: string) {
  const run = await db.proofreadRun.findFirst({ where: { id: runId, projectId } });
  if (!run) throw new AssistantError("NOT_FOUND", "That proofreading request is not in this project.");
  return run;
}

/** Marks a run cancelled when no request is in progress for it (for example after a restart). */
export async function markProofreadCancelled(db: Db, runId: string): Promise<boolean> {
  const { count } = await db.proofreadRun.updateMany({
    where: { id: runId, status: "running" },
    data: { status: "cancelled", errorCode: "cancelled", errorMessage: "Cancelled. No suggestions were made.", completedAt: new Date() },
  });
  return count > 0;
}
