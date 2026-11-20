import { createHash } from "node:crypto";
import { analysisOutputTokens, estimateTokens } from "@/assistant/config";
import { ProviderError, type AssistantProvider, type OutputSchema, type ProviderUsage } from "@/assistant/provider";
import {
  CHAPTER_ANALYSIS_OUTPUT_JSON_SCHEMA,
  CHAPTER_ANALYSIS_SCHEMA_NAME,
  parseChapterAnalysisOutput,
  type AnalysisAction,
  type AnalysisAssessments,
  type AnalysisCandidate,
  type AnalysisDecisions,
  type AnalysisKind,
  type AnalysisProposal,
  type AnalysisSuggestion,
} from "@/analyze/chapterAnalysisOutput";
import { ANALYSIS_KINDS } from "@/analyze/chapterAnalysisOutput";
import {
  CATEGORY_BOUNDARY,
  chronologyGap,
  interpretationCaution,
  resolveQuotation,
} from "@/analyze/chapterAnalysisReview";
import { buildChapterAnalysisRequest, type AnalysisCatalogItem } from "@/analyze/chapterAnalysisPrompt";
import { newId } from "@/domain/ids";
import { sha256 } from "@/domain/json";
import { errorIssue } from "@/domain/issues";
import { isRecordType } from "@/domain/recordTypes";
import { nameFormsOf } from "@/writing/crossRefs";
import { orderWouldCycle, type OrderEdge } from "@/world/storyOrder";
import type { Db, DbOrTx, Tx } from "../db";
import { AssistantError, checkRequestLimits, estimatedUsage, usageSummary, type AssistantRuntime, type UsageSummary } from "./assistantService";
import { writeAudit } from "./auditService";
import { evidenceKindForSource } from "./establishedFactService";
import { MutationRejectedError, NotFoundError } from "./errors";
import { applyMutationsInTx } from "./mutationService";
import { LIVE_RECORD } from "./trashFilters";

const UI_ACTOR = "author";

export type ChapterAnalysisStatus = "preparing" | "proposed" | "applying" | "applied" | "failed" | "cancelled";

export interface DraftManuscriptCount {
  id: string | null;
  label: string;
  kind: "zero_draft" | "author_manuscript" | "legacy";
  chapters: number;
  scenes: number;
}

export interface ChapterAnalysisRunView {
  id: string;
  projectId: string;
  chapterRecordId: string;
  chapterTitle: string;
  draftId: string;
  pinnedRevision: number;
  status: ChapterAnalysisStatus;
  errorCode: string | null;
  errorMessage: string | null;
  sourceHash: string;
  contentHash: string;
  sentMaterial: string;
  proposal: AnalysisProposal | null;
  decisions: AnalysisDecisions;
  assessments: AnalysisAssessments;
  categories: AnalysisKind[];
  diagnostics: string;
  outputTokenAllowance: number;
  appliedKeys: string[];
  requestChars: number;
  model: string | null;
  usage: (ProviderUsage & { estimated: boolean }) | null;
  createdAt: string;
  completedAt: string | null;
}

export interface PreparedChapterAnalysis {
  runId: string;
  requestChars: number;
  request: ReturnType<typeof buildChapterAnalysisRequest>;
  sourceHash: string;
  limits: AssistantRuntime["limits"];
  outputTokenAllowance: number;
  categories: AnalysisKind[];
}

export interface ChapterAnalysisPreview {
  projectTitle: string;
  draftLabel: string;
  draftKind: string;
  chapterTitle: string;
  chapterRecordId: string;
  pinnedRevision: number;
  model: string | null;
  categories: AnalysisKind[];
  catalogs: { heading: string; count: number; text: string }[];
  instructions: string;
  userText: string;
  inputChars: number;
  userChars: number;
  estimatedInputTokens: number;
  outputTokenAllowance: number;
  requestsLastHour: number;
  maxRequestsPerHour: number;
  monthTokens: number;
  monthlyTokenCap: number;
  sourceHash: string;
  configured: boolean;
  problem: string | null;
}

function chosenCategories(categories?: readonly AnalysisKind[]): AnalysisKind[] {
  const allowed = new Set<string>(ANALYSIS_KINDS);
  const picked = [...new Set((categories ?? ANALYSIS_KINDS).filter((kind) => allowed.has(kind)))];
  return picked.length ? picked : [...ANALYSIS_KINDS];
}

function catalogSections(catalog: Awaited<ReturnType<typeof catalogs>>): ChapterAnalysisPreview["catalogs"] {
  const section = (heading: string, items: { id: string; title: string; detail?: string }[]) => ({
    heading,
    count: items.length,
    text: items.map((item) => `- ${item.id}: ${item.title}${item.detail ? ` (${item.detail})` : ""}`).join("\n"),
  });
  return [
    section("Characters", catalog.characters),
    section("Places", catalog.places),
    section("Accepted facts", catalog.facts),
    section("Story events", catalog.events),
    section("Plot beats on this chapter", catalog.beats),
  ];
}

function rejected(message: string): MutationRejectedError {
  return new MutationRejectedError([errorIssue("INVALID_REFERENCE", message)]);
}

function beatStamp(beat: { title: string; body: string; manuscriptRecordId: string | null }): number {
  return createHash("sha256").update(`${beat.title}\0${beat.body}\0${beat.manuscriptRecordId ?? ""}`, "utf8").digest().readUInt32BE(0);
}

function stableId(prefix: string, runId: string, key: string): string {
  const hash = createHash("sha256").update(`${runId}\0${key}`, "utf8").digest("hex").slice(0, 26);
  return `${prefix}_${hash}`;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Chapters and scenes grouped by Zero draft, Author manuscript, and legacy (no draft). */
export async function manuscriptCountsByDraft(db: DbOrTx, projectId: string): Promise<DraftManuscriptCount[]> {
  const drafts = await db.manuscriptDraft.findMany({
    where: { projectId },
    select: { id: true, label: true, kind: true },
    orderBy: { createdAt: "asc" },
  });
  const rows = await db.record.findMany({
    where: { projectId, ...LIVE_RECORD, type: { in: ["manuscript_chapter", "manuscript_scene"] } },
    select: { draftId: true, type: true },
  });
  const counts = new Map<string, { chapters: number; scenes: number }>();
  for (const row of rows) {
    const key = row.draftId ?? "";
    const bucket = counts.get(key) ?? { chapters: 0, scenes: 0 };
    if (row.type === "manuscript_chapter") bucket.chapters += 1;
    else bucket.scenes += 1;
    counts.set(key, bucket);
  }
  const out: DraftManuscriptCount[] = drafts.flatMap((draft) => {
    if (draft.kind !== "zero_draft" && draft.kind !== "author_manuscript") return [];
    const bucket = counts.get(draft.id) ?? { chapters: 0, scenes: 0 };
    return [{ id: draft.id, label: draft.label, kind: draft.kind, ...bucket }];
  });
  const legacy = counts.get("") ?? { chapters: 0, scenes: 0 };
  out.push({ id: null, label: "Legacy manuscript", kind: "legacy", ...legacy });
  return out;
}

async function loadPinnedChapter(db: DbOrTx, projectId: string, chapterRecordId: string, pinnedRevision: number) {
  const chapter = await db.record.findFirst({
    where: { id: chapterRecordId, projectId, ...LIVE_RECORD },
    select: { id: true, title: true, type: true, body: true, currentRevision: true, draftId: true, projectId: true },
  });
  if (!chapter || chapter.type !== "manuscript_chapter") throw rejected("Choose a manuscript chapter.");
  const draft = chapter.draftId
    ? await db.manuscriptDraft.findFirst({ where: { id: chapter.draftId, projectId } })
    : null;
  if (!draft || draft.kind !== "zero_draft") {
    throw rejected("Analyze chapter reads one Zero-draft chapter. Legacy and author-manuscript chapters are not sent.");
  }
  const revision = await db.revision.findUnique({
    where: { recordId_revisionNumber: { recordId: chapter.id, revisionNumber: pinnedRevision } },
    select: { body: true, title: true },
  });
  if (!revision) throw rejected(`Revision ${pinnedRevision} is not on that chapter.`);
  return { chapter, draft, body: revision.body, title: revision.title };
}

async function catalogs(db: DbOrTx, projectId: string, chapterId: string) {
  const records = await db.record.findMany({
    where: { projectId, ...LIVE_RECORD, type: { in: ["character_dossier", "worldbuilding"] } },
    select: { id: true, title: true, type: true, fields: true, currentRevision: true },
    orderBy: { title: "asc" },
  });
  const characters: AnalysisCatalogItem[] = [];
  const places: AnalysisCatalogItem[] = [];
  for (const record of records) {
    if (!isRecordType(record.type)) continue;
    const item = { id: record.id, title: record.title };
    if (record.type === "character_dossier") characters.push(item);
    else places.push(item);
  }
  const facts = await db.establishedFact.findMany({
    where: { projectId, status: "accepted" },
    select: { id: true, statement: true, updatedAt: true, subject: { select: { title: true } }, evidence: { select: { id: true } } },
    orderBy: { statement: "asc" },
  });
  const events = await db.storyEvent.findMany({
    where: { projectId },
    select: { id: true, title: true, timeLabel: true, revision: true },
    orderBy: { title: "asc" },
  });
  const beats = await db.weaveBeat.findMany({
    where: { projectId, manuscriptRecordId: chapterId },
    select: { id: true, title: true, body: true, manuscriptRecordId: true },
    orderBy: { title: "asc" },
  });
  return {
    records,
    characters,
    places,
    facts: facts.map((fact) => ({
      id: fact.id,
      title: fact.statement,
      detail: `${fact.evidence.length} pinned`,
      evidenceCount: fact.evidence.length,
      subjectTitle: fact.subject.title,
      revision: fact.updatedAt.getTime(),
    })),
    events: events.map((event) => ({
      id: event.id,
      title: event.title,
      detail: event.timeLabel.trim() ? event.timeLabel : "time unknown",
      revision: event.revision,
    })),
    beats: beats.map((beat) => ({ id: beat.id, title: beat.title, revision: beatStamp(beat) })),
  };
}

function nameHits(
  title: string,
  records: Array<{ id: string; title: string; type: string; fields: string; currentRevision: number }>,
  type: "character_dossier" | "worldbuilding",
): AnalysisCandidate[] {
  const needle = title.trim().toLowerCase();
  if (!needle) return [];
  const full: AnalysisCandidate[] = [];
  const parts: AnalysisCandidate[] = [];
  for (const record of records) {
    if (record.type !== type || !isRecordType(record.type)) continue;
    let fields: Record<string, unknown> = {};
    try {
      fields = JSON.parse(record.fields) as Record<string, unknown>;
    } catch {
      fields = {};
    }
    const forms = nameFormsOf({ title: record.title, type: record.type, fields });
    const candidate = { id: record.id, title: record.title, kind: "record" as const, evidenceCount: 0, revision: record.currentRevision };
    if (forms.full.some((form) => form.toLowerCase() === needle) || record.title.trim().toLowerCase() === needle) full.push(candidate);
    else if (forms.parts.some((form) => form.toLowerCase() === needle)) parts.push(candidate);
  }
  return full.length ? full : parts;
}

function titleHits(
  title: string,
  rows: Array<{ id: string; title: string; revision?: number }>,
  kind: AnalysisCandidate["kind"],
): AnalysisCandidate[] {
  const needle = title.trim().toLowerCase();
  return rows
    .filter((row) => row.title.trim().toLowerCase() === needle)
    .map((row) => ({ id: row.id, title: row.title, kind, evidenceCount: 0, revision: row.revision }));
}

function matchStatus(candidates: AnalysisCandidate[], quoteValid: boolean): AnalysisSuggestion["match"] {
  if (!quoteValid) return { status: "invalid_quote", candidates: [] };
  if (candidates.length === 1) return { status: "unique", candidates };
  if (candidates.length > 1) return { status: "ambiguous", candidates };
  return { status: "none", candidates: [] };
}

export function enrichAnalysisSuggestions(
  chapter: { id: string; title: string; pinnedRevision: number },
  body: string,
  drafts: Array<{ kind: AnalysisKind; excerpt: string; title: string; note: string; uncertain: boolean; uncertainty: string; explicitOrder: boolean; earlierTitle: string; laterTitle: string; occurrence: number }>,
  catalog: {
    records: Array<{ id: string; title: string; type: string; fields: string; currentRevision: number }>;
    facts: Array<{ id: string; title: string; evidenceCount: number; revision?: number }>;
    events: Array<{ id: string; title: string; revision?: number }>;
    beats: Array<{ id: string; title: string; revision?: number }>;
  },
  categories: readonly AnalysisKind[] = ANALYSIS_KINDS,
): AnalysisProposal {
  const allowed = new Set(categories);
  const kept = drafts.filter((item) => {
    if (!allowed.has(item.kind)) return false;
    if (item.kind === "chronology" && !item.explicitOrder) return false;
    return true;
  });
  const suggestions: AnalysisSuggestion[] = kept.map((item, index) => {
    const resolved = resolveQuotation(body, item.excerpt, item.occurrence);
    const passageVerified = resolved.ok;
    const orderGap = item.kind === "chronology" ? chronologyGap(item.excerpt, item.earlierTitle, item.laterTitle) : null;
    const caution = interpretationCaution(item.kind, item.excerpt);
    const blockedReason = !resolved.ok ? resolved.reason : orderGap ?? "";
    const quoteValid = resolved.ok && !orderGap;
    let candidates: AnalysisCandidate[] = [];
    if (quoteValid && (item.kind === "character_presence" || item.kind === "character_learning")) {
      candidates = nameHits(item.title, catalog.records, "character_dossier");
    } else if (quoteValid && item.kind === "location") {
      candidates = nameHits(item.title, catalog.records, "worldbuilding");
    } else if (quoteValid && (item.kind === "event" || item.kind === "reader_revelation" || item.kind === "chronology")) {
      candidates = titleHits(item.title, catalog.events, "event");
    } else if (quoteValid && item.kind === "plot_beat") {
      candidates = titleHits(item.title, catalog.beats, "beat");
    } else if (quoteValid && item.kind === "reference_evidence") {
      const needle = item.title.trim().toLowerCase();
      candidates = catalog.facts
        .filter((fact) => fact.title.trim().toLowerCase() === needle)
        .map((fact) => ({ id: fact.id, title: fact.title, kind: "fact" as const, evidenceCount: fact.evidenceCount, revision: fact.revision }));
    }
    const uncertainty = [!quoteValid ? blockedReason : "", item.uncertain ? item.uncertainty.trim() : "", caution ?? ""]
      .filter(Boolean)
      .join(" ");
    return {
      key: `s${index + 1}`,
      kind: item.kind,
      title: item.title.trim() || "Untitled",
      note: item.note.trim(),
      uncertain: item.uncertain || !quoteValid || Boolean(caution),
      uncertainty,
      passage: resolved.ok ? { start: resolved.start, end: resolved.end, excerpt: resolved.excerpt } : null,
      passageVerified,
      quoteValid,
      blockedReason,
      boundary: CATEGORY_BOUNDARY[item.kind],
      explicitOrder: item.explicitOrder,
      earlierTitle: item.earlierTitle.trim(),
      laterTitle: item.laterTitle.trim(),
      dependsOnKeys: [],
      match: matchStatus(candidates, quoteValid),
    };
  });
  const eventKey = (title: string) => suggestions.find((item) => item.kind === "event" && item.title.toLowerCase() === title.toLowerCase())?.key;
  for (const item of suggestions) {
    if (item.kind === "reader_revelation") {
      const key = eventKey(item.title);
      if (key) item.dependsOnKeys.push(key);
    }
    if (item.kind === "character_learning") {
      const key = suggestions.find((other) => other.kind === "character_presence" && other.title.toLowerCase() === item.title.toLowerCase())?.key;
      if (key) item.dependsOnKeys.push(key);
    }
    if (item.kind === "chronology") {
      for (const title of [item.earlierTitle, item.laterTitle]) {
        const key = eventKey(title);
        if (key) item.dependsOnKeys.push(key);
      }
    }
  }
  return { chapterRecordId: chapter.id, chapterTitle: chapter.title, pinnedRevision: chapter.pinnedRevision, suggestions };
}

async function assembleChapterAnalysis(
  db: Db,
  runtime: AssistantRuntime,
  input: { projectId: string; chapterRecordId: string; pinnedRevision: number; categories?: readonly AnalysisKind[] },
  now: Date,
) {
  const project = await db.project.findFirst({
    where: { id: input.projectId, trashedAt: null },
    select: { id: true, title: true, workspaceId: true },
  });
  if (!project) throw new NotFoundError(`Project ${input.projectId} not found`);
  const pinned = await loadPinnedChapter(db, input.projectId, input.chapterRecordId, input.pinnedRevision);
  if (pinned.chapter.currentRevision !== input.pinnedRevision) {
    throw new AssistantError(
      "STALE_SELECTION",
      `"${pinned.chapter.title}" is at revision ${pinned.chapter.currentRevision}. Pin that revision, or analyze the revision you chose only after it is current.`,
    );
  }
  const categories = chosenCategories(input.categories);
  const catalog = await catalogs(db, input.projectId, pinned.chapter.id);
  const request = buildChapterAnalysisRequest({
    projectTitle: project.title,
    draftLabel: pinned.draft.label,
    chapterId: pinned.chapter.id,
    chapterTitle: pinned.title,
    revision: input.pinnedRevision,
    body: pinned.body,
    characters: catalog.characters,
    places: catalog.places,
    facts: catalog.facts,
    events: catalog.events,
    beats: catalog.beats,
    categories,
  });
  const sourceHash = sha256(`${pinned.chapter.id}\n${input.pinnedRevision}\n${pinned.body}`);
  const outputTokenAllowance = analysisOutputTokens(runtime.limits);
  const usage = runtime.configured ? await usageSummary(db, runtime.limits, now) : null;
  return { project, pinned, catalog, request, sourceHash, categories, outputTokenAllowance, usage };
}

function limitProblem(limits: AssistantRuntime["limits"], requestChars: number, usage: UsageSummary | null, outputTokenAllowance: number): string | null {
  if (requestChars > limits.maxInputChars) {
    return `This chapter analysis is ${requestChars.toLocaleString("en-US")} characters; the limit is ${limits.maxInputChars.toLocaleString("en-US")}. Nothing will be sent.`;
  }
  if (!usage) return null;
  if (usage.requestsLastHour >= limits.maxRequestsPerHour) {
    return `This app allows ${limits.maxRequestsPerHour} assistant requests per hour, and that many were started in the last hour. Nothing will be sent.`;
  }
  const projected = estimateTokens(requestChars) + outputTokenAllowance;
  if (usage.monthTokens + projected > limits.monthlyTokenCap) {
    return `This request could use up to about ${projected.toLocaleString("en-US")} tokens (an estimate of the input plus the output allowance, not a price). The monthly cap is ${limits.monthlyTokenCap.toLocaleString("en-US")}. Nothing will be sent.`;
  }
  return null;
}

/** Builds the exact request and checks the pin. Does not call the model and does not store a run. */
export async function previewChapterAnalysis(
  db: Db,
  runtime: AssistantRuntime,
  input: { projectId: string; chapterRecordId: string; pinnedRevision: number; categories?: readonly AnalysisKind[] },
  now = new Date(),
): Promise<ChapterAnalysisPreview> {
  const built = await assembleChapterAnalysis(db, runtime, input, now);
  const problem =
    !runtime.configured || !runtime.model
      ? "The assistant is not set up, so nothing can be sent."
      : limitProblem(runtime.limits, built.request.totalChars, built.usage, built.outputTokenAllowance);
  return {
    projectTitle: built.project.title,
    draftLabel: built.pinned.draft.label,
    draftKind: built.pinned.draft.kind,
    chapterTitle: built.pinned.title,
    chapterRecordId: built.pinned.chapter.id,
    pinnedRevision: input.pinnedRevision,
    model: runtime.model,
    categories: built.categories,
    catalogs: catalogSections(built.catalog),
    instructions: built.request.instructions,
    userText: built.request.userText,
    inputChars: built.request.totalChars,
    userChars: built.request.userText.length,
    estimatedInputTokens: estimateTokens(built.request.totalChars),
    outputTokenAllowance: built.outputTokenAllowance,
    requestsLastHour: built.usage?.requestsLastHour ?? 0,
    maxRequestsPerHour: runtime.limits.maxRequestsPerHour,
    monthTokens: built.usage?.monthTokens ?? 0,
    monthlyTokenCap: runtime.limits.monthlyTokenCap,
    sourceHash: built.sourceHash,
    configured: Boolean(runtime.configured && runtime.model),
    problem,
  };
}

export async function prepareChapterAnalysis(
  db: Db,
  runtime: AssistantRuntime,
  input: {
    projectId: string;
    chapterRecordId: string;
    pinnedRevision: number;
    categories?: readonly AnalysisKind[];
    expectedSourceHash?: string;
  },
  now = new Date(),
): Promise<PreparedChapterAnalysis> {
  if (!runtime.configured || !runtime.model) {
    throw new AssistantError("NOT_CONFIGURED", "Analyze chapter uses the assistant, which is not set up. See How to use, \"Assistant setup\".");
  }
  const built = await assembleChapterAnalysis(db, runtime, input, now);
  if (input.expectedSourceHash && input.expectedSourceHash !== built.sourceHash) {
    throw new AssistantError("STALE_SELECTION", "The chapter changed after you inspected the request. Show what will be sent again.");
  }
  const problem = limitProblem(runtime.limits, built.request.totalChars, built.usage, built.outputTokenAllowance);
  if (problem) {
    const code = problem.includes("characters") ? "TOO_LARGE" : problem.includes("hour") ? "RATE_LIMITED" : "USAGE_CAP";
    throw new AssistantError(code, problem);
  }
  await checkRequestLimits(db, runtime.limits, built.request.totalChars, now, built.outputTokenAllowance);
  const runId = newId("car");
  await db.chapterAnalysisRun.create({
    data: {
      id: runId,
      workspaceId: built.project.workspaceId,
      projectId: built.project.id,
      chapterRecordId: built.pinned.chapter.id,
      draftId: built.pinned.draft.id,
      pinnedRevision: input.pinnedRevision,
      status: "preparing",
      sourceHash: built.sourceHash,
      sentMaterialJson: built.request.userText,
      requestChars: built.request.totalChars,
      categoriesJson: JSON.stringify(built.categories),
      outputTokenAllowance: built.outputTokenAllowance,
      model: runtime.model,
    },
  });
  return {
    runId,
    requestChars: built.request.totalChars,
    request: built.request,
    sourceHash: built.sourceHash,
    limits: runtime.limits,
    outputTokenAllowance: built.outputTokenAllowance,
    categories: built.categories,
  };
}

export async function runChapterAnalysis(
  db: Db,
  provider: AssistantProvider,
  prep: PreparedChapterAnalysis,
  signal: AbortSignal,
): Promise<ChapterAnalysisRunView> {
  const row = await db.chapterAnalysisRun.findFirstOrThrow({ where: { id: prep.runId } });
  let status: ChapterAnalysisStatus = "failed";
  let errorCode: string | null = null;
  let errorMessage: string | null = null;
  let usage: ProviderUsage | undefined;
  let usageEstimated = false;
  let responseId: string | undefined;
  let proposal: AnalysisProposal | null = null;
  let contentHash = "";
  let diagnostics = "";
  try {
    const result = await provider.structured(
      {
        model: row.model ?? "",
        instructions: prep.request.instructions,
        input: prep.request.input,
        maxOutputTokens: prep.outputTokenAllowance,
        timeoutMs: prep.limits.requestTimeoutSeconds * 1000,
      },
      {
        name: CHAPTER_ANALYSIS_SCHEMA_NAME,
        schema: CHAPTER_ANALYSIS_OUTPUT_JSON_SCHEMA as unknown as OutputSchema["schema"],
      },
      signal,
    );
    if (signal.aborted) throw new ProviderError("cancelled", "The request was cancelled.");
    responseId = result.responseId;
    if (result.usage) {
      usage = result.usage;
      usageEstimated = false;
    }
    diagnostics = JSON.stringify({
      providerCode: result.status,
      incompleteReason: result.status === "incomplete" ? result.incompleteReason ?? null : null,
      responseId: responseId ?? null,
    });
    if (result.status === "refused") {
      errorCode = "refused";
      errorMessage = "The model declined this chapter. Nothing was written. You can send the request again.";
    } else if (result.status === "incomplete") {
      errorCode = result.incompleteReason ?? "incomplete";
      errorMessage = "The analysis stopped before it finished, so there are no suggestions to review. You can send it again. Nothing was written.";
    } else {
      const parsed = parseChapterAnalysisOutput(result.text);
      if (!parsed.ok) {
        errorCode = "malformed_output";
        errorMessage = "The response was not usable analysis. Nothing was written. You can send it again.";
        diagnostics = JSON.stringify({ providerCode: "malformed_output", responseId: responseId ?? null, problems: parsed.problems.slice(0, 8) });
      } else {
        const pinned = await loadPinnedChapter(db, row.projectId, row.chapterRecordId, row.pinnedRevision);
        const catalog = await catalogs(db, row.projectId, row.chapterRecordId);
        proposal = enrichAnalysisSuggestions(
          { id: row.chapterRecordId, title: pinned.title, pinnedRevision: row.pinnedRevision },
          pinned.body,
          parsed.suggestions,
          catalog,
          prep.categories,
        );
        contentHash = sha256(JSON.stringify(proposal));
        status = "proposed";
        diagnostics = "";
        if (!usage) {
          usage = estimatedUsage(prep.requestChars, result.text.length);
          usageEstimated = true;
        }
      }
    }
  } catch (error) {
    const failure = error instanceof ProviderError ? error : new ProviderError("provider_failed", "The chapter analysis failed unexpectedly.");
    const cancelled = failure.code === "cancelled" || signal.aborted;
    status = cancelled ? "cancelled" : "failed";
    errorCode = cancelled ? "cancelled" : failure.code;
    errorMessage = cancelled ? "Cancelled. No suggestions were applied. This run stays in the list." : failure.message;
    diagnostics = JSON.stringify({ providerCode: errorCode, responseId: responseId ?? null });
  }
  await db.chapterAnalysisRun.update({
    where: { id: prep.runId },
    data: {
      status,
      errorCode,
      errorMessage,
      diagnosticsJson: diagnostics,
      contentHash,
      proposalJson: proposal ? JSON.stringify(proposal) : "",
      providerResponseId: responseId ?? null,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      totalTokens: usage?.totalTokens ?? null,
      usageEstimated,
      completedAt: status === "proposed" ? null : new Date(),
    },
  });
  return getChapterAnalysis(db, row.projectId, prep.runId);
}

export async function getChapterAnalysis(db: DbOrTx, projectId: string, runId: string): Promise<ChapterAnalysisRunView> {
  const row = await db.chapterAnalysisRun.findFirst({ where: { id: runId, projectId } });
  if (!row) throw new NotFoundError(`Chapter analysis ${runId} not found`);
  const chapter = await db.record.findFirst({ where: { id: row.chapterRecordId }, select: { title: true } });
  return {
    id: row.id,
    projectId: row.projectId,
    chapterRecordId: row.chapterRecordId,
    chapterTitle: chapter?.title ?? "Chapter",
    draftId: row.draftId,
    pinnedRevision: row.pinnedRevision,
    status: row.status as ChapterAnalysisStatus,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    sourceHash: row.sourceHash,
    contentHash: row.contentHash,
    sentMaterial: row.sentMaterialJson,
    proposal: row.proposalJson ? parseJson<AnalysisProposal | null>(row.proposalJson, null) : null,
    decisions: parseJson<AnalysisDecisions>(row.decisionsJson, {}),
    assessments: parseJson<AnalysisAssessments>(row.assessmentsJson, {}),
    categories: parseJson<AnalysisKind[]>(row.categoriesJson, []),
    diagnostics: row.diagnosticsJson,
    outputTokenAllowance: row.outputTokenAllowance,
    appliedKeys: parseJson<string[]>(row.appliedKeysJson, []),
    requestChars: row.requestChars,
    model: row.model,
    usage:
      row.totalTokens != null
        ? { inputTokens: row.inputTokens ?? 0, outputTokens: row.outputTokens ?? 0, totalTokens: row.totalTokens, estimated: row.usageEstimated }
        : null,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

export async function saveChapterAnalysisDecisions(
  db: Db,
  projectId: string,
  runId: string,
  decisions: AnalysisDecisions,
): Promise<void> {
  const row = await db.chapterAnalysisRun.findFirst({ where: { id: runId, projectId }, select: { status: true } });
  if (!row) throw new NotFoundError(`Chapter analysis ${runId} not found`);
  if (row.status !== "proposed" && row.status !== "applied") throw rejected("This analysis has no suggestions to review.");
  await db.chapterAnalysisRun.update({ where: { id: runId }, data: { decisionsJson: JSON.stringify(decisions) } });
}

const ASSESSMENTS = new Set(["correct", "needs_editing", "unsupported", "duplicate"]);

/** Records the author's quality marks. Does not change records, decisions, or canon. */
export async function saveChapterAnalysisAssessments(
  db: Db,
  projectId: string,
  runId: string,
  assessments: AnalysisAssessments,
): Promise<void> {
  const row = await db.chapterAnalysisRun.findFirst({ where: { id: runId, projectId }, select: { id: true } });
  if (!row) throw new NotFoundError(`Chapter analysis ${runId} not found`);
  const clean: AnalysisAssessments = {};
  for (const [key, value] of Object.entries(assessments)) {
    if (ASSESSMENTS.has(value)) clean[key] = value;
  }
  await db.chapterAnalysisRun.update({ where: { id: runId }, data: { assessmentsJson: JSON.stringify(clean) } });
}

export async function listChapterAnalyses(db: DbOrTx, projectId: string) {
  const rows = await db.chapterAnalysisRun.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, status: true, chapterRecordId: true, pinnedRevision: true, createdAt: true, contentHash: true },
  });
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

function chosen(decisions: AnalysisDecisions, key: string): AnalysisAction {
  return decisions[key]?.action ?? "pending";
}

function isApply(action: AnalysisAction): boolean {
  return action === "reuse" || action === "edit" || action === "create";
}

export type ApplyChapterAnalysisResult =
  | { status: "applied"; appliedKeys: string[]; created: number }
  | { status: "already_applied"; appliedKeys: string[] };

export async function applyChapterAnalysis(
  db: Db,
  projectId: string,
  runId: string,
  expectedContentHash: string,
  decisions: AnalysisDecisions,
): Promise<ApplyChapterAnalysisResult> {
  return db.$transaction(async (tx) => {
    const row = await tx.chapterAnalysisRun.findFirst({ where: { id: runId, projectId } });
    if (!row) throw new NotFoundError(`Chapter analysis ${runId} not found`);
    if (row.status !== "proposed" && row.status !== "applied") throw rejected("This analysis has no suggestions to apply.");
    if (row.contentHash !== expectedContentHash) throw rejected("This analysis changed since the page loaded. Reload and try again.");
    const proposal = parseJson<AnalysisProposal | null>(row.proposalJson, null);
    if (!proposal) throw rejected("This analysis has no proposal.");
    const already = new Set(parseJson<string[]>(row.appliedKeysJson, []));
    const previously = new Set(already);
    const chapter = await tx.record.findFirst({
      where: { id: row.chapterRecordId, projectId, ...LIVE_RECORD },
      select: { id: true, title: true, currentRevision: true, draftId: true },
    });
    if (!chapter) throw rejected("The chapter is missing or in Trash.");
    if (chapter.currentRevision !== row.pinnedRevision) {
      throw rejected(`"${chapter.title}" changed after it was pinned (revision ${row.pinnedRevision} is now ${chapter.currentRevision}). Analyze it again.`);
    }
    const revision = await tx.revision.findUnique({
      where: { recordId_revisionNumber: { recordId: chapter.id, revisionNumber: row.pinnedRevision } },
      select: { body: true },
    });
    if (!revision) throw rejected("The pinned revision is gone. Analyze the chapter again.");
    if (sha256(`${chapter.id}\n${row.pinnedRevision}\n${revision.body}`) !== row.sourceHash) {
      throw rejected("The pinned chapter text does not match this analysis. Analyze it again.");
    }

    const byKey = new Map(proposal.suggestions.map((item) => [item.key, item]));
    for (const item of proposal.suggestions) {
      const action = chosen(decisions, item.key);
      if (!isApply(action) || already.has(item.key)) continue;
      if (!item.quoteValid || !item.passage) throw rejected(`"${item.title}" does not quote the pinned revision. Skip it or analyze again.`);
      if (revision.body.slice(item.passage.start, item.passage.end) !== item.passage.excerpt) {
        throw rejected(`The quote for "${item.title}" is not at the pinned offsets.`);
      }
      for (const dep of item.dependsOnKeys) {
        if (already.has(dep)) continue;
        if (!isApply(chosen(decisions, dep))) {
          const other = byKey.get(dep);
          throw rejected(`"${item.title}" depends on "${other?.title ?? "another suggestion"}", which is not selected. Choose that one too, or skip this one. Nothing was written.`);
        }
      }
      if (item.match.status === "ambiguous" && action === "reuse" && !decisions[item.key]?.targetId) {
        throw rejected(`"${item.title}" matches more than one record. Choose which one to reuse.`);
      }
      if (action === "reuse" && item.match.status === "none") throw rejected(`"${item.title}" has nothing to reuse. Create it or skip it.`);
      if (action === "edit" && item.match.status !== "unique" && !decisions[item.key]?.targetId) {
        throw rejected(`"${item.title}" needs a record to edit.`);
      }
    }

    const recordIds = new Map<string, string>();
    const eventIds = new Map<string, string>();

    const targetOf = (item: AnalysisSuggestion): string | null => {
      const decision = decisions[item.key];
      if (decision?.targetId) return decision.targetId;
      if (item.match.status === "unique") return item.match.candidates[0]?.id ?? null;
      return null;
    };

    for (const item of proposal.suggestions) {
      const action = chosen(decisions, item.key);
      if (!isApply(action) || already.has(item.key)) continue;
      if (item.kind !== "character_presence" && item.kind !== "location" && item.kind !== "character_learning") continue;
      if (item.kind === "character_learning") continue;
      const type = item.kind === "location" ? "worldbuilding" : "character_dossier";
      if (action === "create") {
        const id = stableId("rec", runId, item.key);
        const existing = await tx.record.findFirst({ where: { id } });
        if (!existing) {
          await applyMutationsInTx(
            tx,
            { projectId, actor: UI_ACTOR, source: { kind: "ui", conversationLabel: `Chapter analysis ${runId}` }, scope: "reference", protectedOverrides: new Set() },
            [{
              kind: "create_record",
              recordId: id,
              type,
              title: (decisions[item.key]?.title || item.title).slice(0, 200),
              body: "",
              fields: {},
              authorityStatus: "draft",
              parentRecordId: null,
              draftId: null,
            }],
            { action: "record.create", summary: `Draft ${type === "character_dossier" ? "dossier" : "place"} from chapter analysis` },
          );
        }
        recordIds.set(item.key, id);
      } else {
        const target = targetOf(item);
        if (!target) throw rejected(`Choose a record for "${item.title}".`);
        const live = await tx.record.findFirst({ where: { id: target, projectId, ...LIVE_RECORD }, select: { id: true, type: true, authorityStatus: true, currentRevision: true } });
        if (!live || live.type !== type) throw rejected(`"${item.title}" does not match a ${type === "character_dossier" ? "character" : "place"} in this project.`);
        const expected = item.match.candidates.find((candidate) => candidate.id === live.id)?.revision;
        if (typeof expected === "number" && expected !== live.currentRevision) {
          throw rejected(`"${item.title}" changed after this analysis. Review it again. Nothing was written.`);
        }
        if (action === "edit") {
          if (live.authorityStatus === "approved") throw rejected(`"${item.title}" is approved. Reuse it, or change its status yourself before editing.`);
          await applyMutationsInTx(
            tx,
            { projectId, actor: UI_ACTOR, source: { kind: "ui", conversationLabel: `Chapter analysis ${runId}` }, scope: "reference", protectedOverrides: new Set() },
            [{
              kind: "update_record",
              recordId: live.id,
              expectedRevision: (await tx.record.findFirstOrThrow({ where: { id: live.id }, select: { currentRevision: true } })).currentRevision,
              changes: { title: (decisions[item.key]?.title || item.title).slice(0, 200) },
            }],
            { action: "record.update", summary: `Retitled a draft reference from chapter analysis` },
          );
        }
        recordIds.set(item.key, live.id);
      }
    }

    for (const item of proposal.suggestions.filter((entry) => entry.kind === "event")) {
      const action = chosen(decisions, item.key);
      if (!isApply(action) || already.has(item.key)) continue;
      if (action === "create") {
        const id = stableId("sev", runId, item.key);
        const existing = await tx.storyEvent.findFirst({ where: { id } });
        if (!existing) {
          await tx.storyEvent.create({
            data: {
              id,
              projectId,
              title: (decisions[item.key]?.title || item.title).slice(0, 200),
              summary: (decisions[item.key]?.note || item.note).slice(0, 4000),
              timeLabel: "",
              planned: false,
              draftScope: row.draftId,
              revision: 0,
            },
          });
          await pinEventEvidence(tx, projectId, id, chapter.id, row.pinnedRevision, item);
        }
        eventIds.set(item.key, id);
      } else {
        const target = targetOf(item);
        const event = target ? await tx.storyEvent.findFirst({ where: { id: target, projectId } }) : null;
        if (!event) throw rejected(`"${item.title}" does not match a story event.`);
        const expected = item.match.candidates.find((candidate) => candidate.id === event.id)?.revision;
        if (typeof expected === "number" && expected !== event.revision) {
          throw rejected(`"${item.title}" changed after this analysis. Review it again. Nothing was written.`);
        }
        if (action === "edit") {
          await tx.storyEvent.update({
            where: { id: event.id },
            data: {
              title: (decisions[item.key]?.title || item.title).slice(0, 200),
              summary: (decisions[item.key]?.note || item.note).slice(0, 4000),
              revision: { increment: 1 },
            },
          });
        }
        await pinEventEvidence(tx, projectId, event.id, chapter.id, row.pinnedRevision, item);
        eventIds.set(item.key, event.id);
      }
      already.add(item.key);
    }

    const eventIdForTitle = async (title: string, suggestionKey?: string) => {
      if (suggestionKey && eventIds.has(suggestionKey)) return eventIds.get(suggestionKey)!;
      const createdKey = [...eventIds.entries()].find(([key]) => byKey.get(key)?.title.toLowerCase() === title.toLowerCase())?.[1];
      if (createdKey) return createdKey;
      const found = await tx.storyEvent.findMany({ where: { projectId, title }, select: { id: true } });
      if (found.length > 1) throw rejected(`"${title}" matches more than one event. Choose which one on that event's suggestion. Nothing was written.`);
      return found[0]?.id ?? null;
    };

    for (const item of proposal.suggestions) {
      const action = chosen(decisions, item.key);
      if (!isApply(action) || already.has(item.key) || !item.passage) continue;
      if (item.kind === "character_presence" || item.kind === "character_learning") {
        const subjectId = item.kind === "character_learning"
          ? recordIds.get(item.dependsOnKeys[0] ?? "") ?? targetOf(item)
          : recordIds.get(item.key);
        if (!subjectId) throw rejected(`"${item.title}" has no character to attach this reading to.`);
        const statement = item.kind === "character_presence"
          ? `Appears in "${chapter.title}".`
          : (decisions[item.key]?.note || item.note || item.title).slice(0, 2000);
        await ensureFactEvidence(tx, projectId, runId, item.key, subjectId, statement, chapter.id, row.pinnedRevision, item, null, action);
        already.add(item.key);
      } else if (item.kind === "reference_evidence") {
        const factTarget = decisions[item.key]?.targetId || (item.match.status === "unique" ? item.match.candidates[0]?.id ?? null : null);
        await ensureFactEvidence(
          tx,
          projectId,
          runId,
          item.key,
          action === "create" ? factTarget : null,
          (decisions[item.key]?.note || item.title).slice(0, 2000),
          chapter.id,
          row.pinnedRevision,
          item,
          action === "create" ? null : factTarget,
          action,
        );
        already.add(item.key);
      } else if (item.kind === "location") {
        const locationId = recordIds.get(item.key);
        if (!locationId) throw rejected(`"${item.title}" has no place to assign.`);
        const existing = await tx.sceneLocation.findFirst({ where: { projectId, manuscriptRecordId: chapter.id, locationRecordId: locationId } });
        if (!existing) {
          const primary = await tx.sceneLocation.findFirst({ where: { projectId, manuscriptRecordId: chapter.id, isPrimary: true } });
          await tx.sceneLocation.create({
            data: { id: stableId("scl", runId, item.key), projectId, manuscriptRecordId: chapter.id, locationRecordId: locationId, isPrimary: !primary, revision: 0 },
          });
        }
        already.add(item.key);
      } else if (item.kind === "reader_revelation") {
        const eventId = await eventIdForTitle(item.title, item.dependsOnKeys[0]);
        if (!eventId) throw rejected(`"${item.title}" has no event to reveal.`);
        const existing = await tx.storyEventScene.findFirst({ where: { eventId, manuscriptRecordId: chapter.id } });
        if (!existing) {
          await tx.storyEventScene.create({ data: { id: stableId("evs", runId, item.key), eventId, projectId, manuscriptRecordId: chapter.id } });
        }
        already.add(item.key);
      } else if (item.kind === "plot_beat") {
        await ensureBeat(tx, projectId, runId, item, decisions, chapter.id, action);
        already.add(item.key);
      } else if (item.kind === "chronology") {
        if (!item.explicitOrder) throw rejected("Chronology was proposed without an explicit order in the text.");
        const earlierId = await eventIdForTitle(item.earlierTitle);
        const laterId = await eventIdForTitle(item.laterTitle);
        if (!earlierId || !laterId) throw rejected("Both events have to be kept before their order can be recorded.");
        const edges = await tx.storyEventOrder.findMany({ where: { projectId }, select: { earlierEventId: true, laterEventId: true } });
        const graph: OrderEdge[] = edges.map((edge) => ({ earlierId: edge.earlierEventId, laterId: edge.laterEventId }));
        if (orderWouldCycle(graph, earlierId, laterId)) throw rejected("That order would contradict the constraints already recorded.");
        const existing = await tx.storyEventOrder.findFirst({ where: { projectId, earlierEventId: earlierId, laterEventId: laterId } });
        if (!existing) {
          await tx.storyEventOrder.create({
            data: { id: stableId("evo", runId, item.key), projectId, earlierEventId: earlierId, laterEventId: laterId },
          });
        }
        already.add(item.key);
      }
    }

    const appliedKeys = [...already];
    const fresh = appliedKeys.filter((key) => !previously.has(key));
    await tx.chapterAnalysisRun.update({
      where: { id: runId },
      data: { status: "applied", decisionsJson: JSON.stringify(decisions), appliedKeysJson: JSON.stringify(appliedKeys), completedAt: new Date() },
    });
    await writeAudit(tx, {
      projectId,
      action: "chapter_analysis.apply",
      actor: UI_ACTOR,
      summary: `Applied chapter analysis suggestions for "${chapter.title}"`,
      details: { runId, chapterRecordId: chapter.id, pinnedRevision: row.pinnedRevision, appliedKeyCount: appliedKeys.length },
    });
    if (fresh.length === 0) return { status: "already_applied", appliedKeys };
    return { status: "applied", appliedKeys, created: fresh.length };
  });
}

async function pinEventEvidence(tx: Tx, projectId: string, eventId: string, chapterId: string, revisionNumber: number, item: AnalysisSuggestion) {
  if (!item.passage) return;
  const existing = await tx.storyEventEvidence.findFirst({
    where: { eventId, sourceRecordId: chapterId, passageStart: item.passage.start, passageEnd: item.passage.end },
  });
  if (existing) return;
  const kind = await evidenceKindForSource(tx, projectId, chapterId);
  await tx.storyEventEvidence.create({
    data: {
      id: stableId("eve", eventId, item.key),
      eventId,
      projectId,
      sourceRecordId: chapterId,
      revisionNumber,
      passageStart: item.passage.start,
      passageEnd: item.passage.end,
      passageExcerpt: item.passage.excerpt,
      contentHash: sha256(item.passage.excerpt),
      evidenceKind: kind,
      needsRecheck: false,
    },
  });
}

async function ensureFactEvidence(
  tx: Tx,
  projectId: string,
  runId: string,
  key: string,
  subjectId: string | null,
  statement: string,
  chapterId: string,
  revisionNumber: number,
  item: AnalysisSuggestion,
  factTarget: string | null,
  action: AnalysisAction,
) {
  if (!item.passage) throw rejected("A fact needs a passage.");
  let factId: string;
  if (item.kind === "reference_evidence" && action !== "create") {
    if (!factTarget) throw rejected(`"${item.title}" has no fact to attach evidence to.`);
    const fact = await tx.establishedFact.findFirst({ where: { id: factTarget, projectId } });
    if (!fact) throw rejected("That fact is not in this project.");
    const expected = item.match.candidates.find((candidate) => candidate.id === fact.id)?.revision;
    if (typeof expected === "number" && expected !== fact.updatedAt.getTime()) {
      throw rejected(`"${item.title}" changed after this analysis. Review it again. Nothing was written.`);
    }
    if (action === "edit") {
      if (fact.status === "accepted") throw rejected("An accepted fact keeps its statement. Reuse it to add a passage.");
      await tx.establishedFact.update({ where: { id: fact.id }, data: { statement } });
    }
    factId = fact.id;
  } else {
    if (!subjectId) throw rejected(`"${item.title}" needs a character this fact is about.`);
    factId = stableId("fct", runId, key);
    const existing = await tx.establishedFact.findFirst({ where: { id: factId } });
    if (!existing) {
      await tx.establishedFact.create({
        data: { id: factId, projectId, subjectRecordId: subjectId, statement, status: "pending", evidenceKind: "zero_draft" },
      });
    }
  }
  const duplicate = await tx.factEvidence.findFirst({
    where: { factId, sourceRecordId: chapterId, passageStart: item.passage.start, passageEnd: item.passage.end },
  });
  if (duplicate) return;
  const kind = await evidenceKindForSource(tx, projectId, chapterId);
  await tx.factEvidence.create({
    data: {
      id: stableId("fev", runId, key),
      factId,
      projectId,
      sourceRecordId: chapterId,
      revisionNumber,
      passageStart: item.passage.start,
      passageEnd: item.passage.end,
      passageExcerpt: item.passage.excerpt,
      contentHash: sha256(item.passage.excerpt),
      evidenceKind: kind,
      needsRecheck: false,
    },
  });
}

async function ensureBeat(
  tx: Tx,
  projectId: string,
  runId: string,
  item: AnalysisSuggestion,
  decisions: AnalysisDecisions,
  chapterId: string,
  action: AnalysisAction,
) {
  const gridId = stableId("wvg", runId, "grid");
  let grid = await tx.weaveGrid.findFirst({ where: { projectId, id: gridId } });
  if (!grid) {
    const existing = await tx.weaveGrid.findFirst({ where: { projectId, viewKind: "zero_draft_map" }, orderBy: { createdAt: "asc" } });
    if (existing && action !== "create") grid = existing;
  }
  if (!grid) {
    await tx.weaveGrid.create({ data: { id: gridId, projectId, title: "Chapter analysis", viewKind: "zero_draft_map", layoutMode: "plot_grid" } });
    grid = await tx.weaveGrid.findFirstOrThrow({ where: { id: gridId } });
  }
  const threadId = stableId("wth", runId, "thread");
  const thread = await tx.weaveThread.findFirst({ where: { id: threadId } });
  if (!thread) {
    const anyThread = await tx.weaveThread.findFirst({ where: { gridId: grid.id, projectId }, orderBy: { position: "asc" } });
    if (!anyThread) {
      await tx.weaveThread.create({ data: { id: threadId, gridId: grid.id, projectId, title: "This chapter", position: 0 } });
    }
  }
  const linkedThread = (await tx.weaveThread.findFirst({ where: { gridId: grid.id, projectId }, orderBy: { position: "asc" } }))?.id ?? null;
  const title = (decisions[item.key]?.title || item.title).slice(0, 200);
  const body = `${decisions[item.key]?.note || item.note}${item.passage ? `\n\nSource: ${item.passage.excerpt}` : ""}`.trim();
  if (action !== "create") {
    const target = decisions[item.key]?.targetId || (item.match.status === "unique" ? item.match.candidates[0]?.id : null);
    const beat = target ? await tx.weaveBeat.findFirst({ where: { id: target, projectId } }) : null;
    if (!beat) throw rejected(`"${item.title}" does not match a plot beat.`);
    const expected = item.match.candidates.find((candidate) => candidate.id === beat.id)?.revision;
    if (typeof expected === "number" && expected !== beatStamp(beat)) {
      throw rejected(`"${item.title}" changed after this analysis. Review it again. Nothing was written.`);
    }
    if (action === "reuse") {
      await tx.weaveBeat.update({ where: { id: beat.id }, data: { manuscriptRecordId: chapterId } });
      return;
    }
    await tx.weaveBeat.update({ where: { id: beat.id }, data: { title, body, manuscriptRecordId: chapterId } });
    return;
  }
  const id = stableId("wvb", runId, item.key);
  const existing = await tx.weaveBeat.findFirst({ where: { id } });
  if (existing) return;
  await tx.weaveBeat.create({
    data: {
      id,
      gridId: grid.id,
      projectId,
      title,
      body,
      decision: "",
      manuscriptRecordId: chapterId,
      threadId: linkedThread,
      cellOrder: 0,
      x: 40,
      y: 40,
      zIndex: 1,
    },
  });
}
