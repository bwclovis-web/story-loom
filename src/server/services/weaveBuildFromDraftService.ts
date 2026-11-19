import { createHash } from "node:crypto";
import { checkSize, describeSizeProblem } from "@/assistant/prompt";
import { ProviderError, type AssistantProvider, type ProviderUsage } from "@/assistant/provider";
import { newId, type IdPrefix } from "@/domain/ids";
import { errorIssue } from "@/domain/issues";
import { RECORD_TYPE_LABELS, isManuscriptType } from "@/domain/recordTypes";
import {
  parseWeaveBuildOutput,
  WEAVE_BUILD_OUTPUT_JSON_SCHEMA,
  WEAVE_BUILD_SCHEMA_NAME,
  type WeaveBuildDraft,
  type WeaveBuildProposal,
  type WeaveBuildProposalBeat,
  type WeaveBuildProposalRow,
} from "@/weave/buildFromDraftOutput";
import { buildWeaveBuildRequest } from "@/weave/buildFromDraftPrompt";
import type { Db, DbOrTx, Tx } from "../db";
import {
  AssistantError,
  checkRequestLimits,
  estimatedUsage,
  type AssistantRuntime,
} from "./assistantService";
import { writeAudit } from "./auditService";
import { MutationRejectedError, NotFoundError } from "./errors";
import { LIVE_RECORD } from "./trashFilters";
import {
  getWeaveGrid,
  isWeaveDecision,
  isWeaveViewKind,
  WEAVE_VIEW_LABELS,
  type WeaveGridView,
  type WeaveViewKind,
} from "./weaveService";

/*
 * Build Weave plot-grid suggestions from a manuscript draft via the assistant.
 * Never calls mutationService / never writes Record.body. Apply creates Weave
 * threads and beats only, with stale source checks and retry-safe IDs.
 */

const UI_ACTOR = "author";

export type WeaveBuildStatus = "preparing" | "proposed" | "applying" | "applied" | "failed" | "cancelled";

export type SuggestionDecision = "accept" | "skip" | "pending";

export interface WeaveBuildDecisions {
  [key: string]: {
    decision: SuggestionDecision;
    title?: string;
    body?: string;
    summary?: string;
    purposeGoal?: string | null;
    purposeChange?: string | null;
    purposeForward?: string | null;
    matchThreadId?: string | null;
    matchBeatId?: string | null;
  };
}

export interface WeaveBuildRunView {
  id: string;
  projectId: string;
  draftId: string | null;
  gridId: string | null;
  gridTitle: string;
  viewKind: WeaveViewKind;
  chapterFromId: string | null;
  chapterToId: string | null;
  status: WeaveBuildStatus;
  errorCode: string | null;
  errorMessage: string | null;
  sourceHash: string;
  contentHash: string;
  proposal: WeaveBuildProposal | null;
  decisions: WeaveBuildDecisions;
  appliedKeys: string[];
  requestChars: number;
  model: string | null;
  usage: (ProviderUsage & { estimated: boolean }) | null;
  createdAt: string;
  completedAt: string | null;
  existingGrid: WeaveGridView | null;
}

export interface PrepareWeaveBuildInput {
  projectId: string;
  draftId: string | null;
  /** Existing grid to fill, or null to create on apply. */
  gridId: string | null;
  gridTitle: string;
  viewKind: string;
  chapterFromId: string | null;
  chapterToId: string | null;
  /**
   * When building an author-rewrite plan, analyze these pinned Zero-draft
   * revision links (fromRecordId → source). Empty = use the selected draft's
   * own manuscript pages at their current revisions.
   */
  rewritePins?: Array<{ toRecordId: string; toRevisionNumber: number }>;
}

export interface PreparedWeaveBuild {
  runId: string;
  requestChars: number;
  request: {
    model: string;
    instructions: string;
    input: ReturnType<typeof buildWeaveBuildRequest>["input"];
    maxOutputTokens: number;
    timeoutMs: number;
  };
  sourceHash: string;
  sentRevisions: Record<string, number>;
  recordBodies: Map<string, { revisionNumber: number; body: string }>;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function rejected(message: string): MutationRejectedError {
  return new MutationRejectedError([errorIssue("INVALID_REFERENCE", message)]);
}

function stableId(prefix: Extract<IdPrefix, "wvb" | "wth">, runId: string, key: string): string {
  const h = createHash("sha256").update(`${runId}\0${key}`, "utf8").digest("hex").slice(0, 26);
  return `${prefix}_${h}`;
}

function parseJsonObject<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function locateExcerpt(body: string, excerpt: string): { start: number; end: number; excerpt: string } | null {
  const needle = excerpt.trim();
  if (!needle) return null;
  const start = body.indexOf(needle);
  if (start < 0) return null;
  return { start, end: start + needle.length, excerpt: needle };
}

async function loadDraftChapters(
  db: DbOrTx,
  projectId: string,
  draftId: string | null,
): Promise<Array<{ id: string; title: string; type: string; position: number | null; createdAt: Date; parentRecordId: string | null }>> {
  const rows = await db.record.findMany({
    where: {
      projectId,
      ...LIVE_RECORD,
      type: { in: ["manuscript_chapter", "manuscript_scene"] },
      ...(draftId ? { draftId } : { draftId: null }),
    },
    select: { id: true, title: true, type: true, position: true, createdAt: true, parentRecordId: true },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  return rows;
}

function filterChapterRange<T extends { id: string; type: string; parentRecordId: string | null }>(
  rows: T[],
  chapterFromId: string | null,
  chapterToId: string | null,
): T[] {
  const chapters = rows.filter((r) => r.type === "manuscript_chapter");
  if (!chapters.length) return rows;
  let fromIdx = 0;
  let toIdx = chapters.length - 1;
  if (chapterFromId) {
    const i = chapters.findIndex((c) => c.id === chapterFromId);
    if (i >= 0) fromIdx = i;
  }
  if (chapterToId) {
    const i = chapters.findIndex((c) => c.id === chapterToId);
    if (i >= 0) toIdx = i;
  }
  if (fromIdx > toIdx) [fromIdx, toIdx] = [toIdx, fromIdx];
  const allowedChapters = new Set(chapters.slice(fromIdx, toIdx + 1).map((c) => c.id));
  return rows.filter((r) => {
    if (r.type === "manuscript_chapter") return allowedChapters.has(r.id);
    return r.parentRecordId != null && allowedChapters.has(r.parentRecordId);
  });
}

export async function prepareWeaveBuild(
  db: Db,
  runtime: AssistantRuntime,
  input: PrepareWeaveBuildInput,
  now = new Date(),
): Promise<PreparedWeaveBuild> {
  if (!runtime.configured || !runtime.model) {
    throw new AssistantError("NOT_CONFIGURED", "Build grid from draft uses the assistant, which is not set up. See How to use, \"Assistant setup\".");
  }
  if (!isWeaveViewKind(input.viewKind)) {
    throw new AssistantError("INVALID_REQUEST", "Unknown Weave view kind.");
  }
  const project = await db.project.findFirst({
    where: { id: input.projectId, trashedAt: null },
    select: { id: true, workspaceId: true, title: true },
  });
  if (!project) throw new AssistantError("NOT_FOUND", "That project was not found.");

  let draftLabel = "Legacy manuscript";
  if (input.draftId) {
    const draft = await db.manuscriptDraft.findFirst({ where: { id: input.draftId, projectId: input.projectId } });
    if (!draft) throw new AssistantError("NOT_FOUND", "That manuscript draft was not found.");
    draftLabel = draft.label;
  }

  if (input.gridId) {
    const grid = await db.weaveGrid.findFirst({ where: { id: input.gridId, projectId: input.projectId } });
    if (!grid) throw new AssistantError("NOT_FOUND", "That Weave grid was not found.");
  }

  const pins = input.rewritePins ?? [];
  type Src = { id: string; title: string; type: string; revisionNumber: number; body: string };
  const sources: Src[] = [];

  if (pins.length) {
    for (const pin of pins) {
      const record = await db.record.findFirst({
        where: { id: pin.toRecordId, projectId: input.projectId, ...LIVE_RECORD },
        select: { id: true, title: true, type: true },
      });
      if (!record || !isManuscriptType(record.type) || record.type === "scene_note") continue;
      const rev = await db.revision.findUnique({
        where: { recordId_revisionNumber: { recordId: record.id, revisionNumber: pin.toRevisionNumber } },
      });
      if (!rev) {
        throw new AssistantError(
          "STALE_SELECTION",
          `"${record.title}" no longer has pinned revision ${pin.toRevisionNumber}. Re-pin the source, then try again.`,
        );
      }
      sources.push({
        id: record.id,
        title: record.title,
        type: record.type,
        revisionNumber: pin.toRevisionNumber,
        body: rev.body.replace(/\r\n/g, "\n"),
      });
    }
  } else {
    const nav = filterChapterRange(
      await loadDraftChapters(db, input.projectId, input.draftId),
      input.chapterFromId,
      input.chapterToId,
    );
    for (const row of nav) {
      const live = await db.record.findFirst({
        where: { id: row.id, projectId: input.projectId, ...LIVE_RECORD },
        select: { id: true, title: true, type: true, currentRevision: true },
      });
      if (!live) continue;
      const rev = await db.revision.findUnique({
        where: { recordId_revisionNumber: { recordId: live.id, revisionNumber: live.currentRevision } },
      });
      if (!rev) continue;
      sources.push({
        id: live.id,
        title: live.title,
        type: live.type,
        revisionNumber: live.currentRevision,
        body: rev.body.replace(/\r\n/g, "\n"),
      });
    }
  }

  if (!sources.length) {
    throw new AssistantError(
      "INVALID_REQUEST",
      input.draftId
        ? "No manuscript chapters or scenes are in that draft range to analyze."
        : "This project uses manuscript drafts, so pick a draft (not legacy manuscript) before analyzing.",
    );
  }

  const built = buildWeaveBuildRequest({
    projectTitle: project.title,
    draftLabel,
    viewKindLabel: WEAVE_VIEW_LABELS[input.viewKind],
    records: sources.map((s) => ({
      id: s.id,
      title: s.title,
      typeLabel: RECORD_TYPE_LABELS[s.type as keyof typeof RECORD_TYPE_LABELS] ?? s.type,
      revisionNumber: s.revisionNumber,
      body: s.body,
    })),
  });

  const size = checkSize({ totalChars: built.totalChars, items: [] }, runtime.limits.maxInputChars);
  if (size) {
    throw new AssistantError("TOO_LARGE", describeSizeProblem(size), size);
  }
  await checkRequestLimits(db, runtime.limits, built.totalChars, now);

  const sentRevisions: Record<string, number> = {};
  const recordBodies = new Map<string, { revisionNumber: number; body: string }>();
  const hashParts: string[] = [];
  for (const s of sources) {
    sentRevisions[s.id] = s.revisionNumber;
    recordBodies.set(s.id, { revisionNumber: s.revisionNumber, body: s.body });
    hashParts.push(`${s.id}@${s.revisionNumber}\n${s.body}`);
  }
  const sourceHash = sha256(hashParts.join("\n---\n"));

  const runId = newId("wbr");
  await db.weaveBuildRun.create({
    data: {
      id: runId,
      workspaceId: project.workspaceId,
      projectId: input.projectId,
      draftId: input.draftId,
      gridId: input.gridId,
      gridTitle: input.gridTitle.trim(),
      viewKind: input.viewKind,
      chapterFromId: input.chapterFromId,
      chapterToId: input.chapterToId,
      status: "preparing",
      sourceHash,
      sentRevisionsJson: JSON.stringify(sentRevisions),
      requestChars: built.totalChars,
      model: runtime.model,
    },
  });

  return {
    runId,
    requestChars: built.totalChars,
    sourceHash,
    sentRevisions,
    recordBodies,
    request: {
      model: runtime.model,
      instructions: built.instructions,
      input: built.input,
      maxOutputTokens: Math.max(runtime.limits.maxOutputTokens, 4000),
      timeoutMs: runtime.limits.requestTimeoutSeconds * 1000,
    },
  };
}

function enrichProposal(
  draft: WeaveBuildDraft,
  allowedIds: Set<string>,
  recordBodies: Map<string, { revisionNumber: number; body: string }>,
): WeaveBuildProposal {
  const threadKeys = new Set(draft.threads.map((t) => t.key));
  const rows: WeaveBuildProposalRow[] = [];
  for (const row of draft.rows) {
    if (!allowedIds.has(row.manuscriptRecordId)) continue;
    const body = recordBodies.get(row.manuscriptRecordId)?.body ?? "";
    rows.push({
      ...row,
      proposedBoundaries: row.proposedBoundaries.map((b) => {
        const loc = locateExcerpt(body, b.excerpt);
        return { ...b, start: loc?.start ?? null, end: loc?.end ?? null };
      }),
    });
  }
  const beats: WeaveBuildProposalBeat[] = [];
  for (const beat of draft.beats) {
    if (!allowedIds.has(beat.manuscriptRecordId)) continue;
    if (!threadKeys.has(beat.threadKey)) continue;
    const meta = recordBodies.get(beat.manuscriptRecordId);
    const loc = meta ? locateExcerpt(meta.body, beat.sourceExcerpt) : null;
    beats.push({
      ...beat,
      decision: isWeaveDecision(beat.decision) || beat.decision === "" ? beat.decision : "",
      sourcePassage: loc && meta
        ? {
            recordId: beat.manuscriptRecordId,
            revisionNumber: meta.revisionNumber,
            start: loc.start,
            end: loc.end,
            excerpt: loc.excerpt,
          }
        : null,
    });
  }
  return {
    summary: draft.summary,
    threads: draft.threads.filter((t, i, arr) => arr.findIndex((x) => x.key === t.key) === i),
    rows,
    beats,
  };
}

export async function runWeaveBuild(
  db: Db,
  provider: AssistantProvider,
  prep: PreparedWeaveBuild,
  signal: AbortSignal,
): Promise<WeaveBuildRunView> {
  let status: WeaveBuildStatus = "failed";
  let errorCode: string | null = null;
  let errorMessage: string | null = null;
  let usage: ProviderUsage | undefined;
  let usageEstimated = false;
  let responseId: string | undefined;
  let proposal: WeaveBuildProposal | null = null;
  let contentHash = "";

  try {
    const result = await provider.structured(
      prep.request,
      { name: WEAVE_BUILD_SCHEMA_NAME, schema: WEAVE_BUILD_OUTPUT_JSON_SCHEMA },
      signal,
    );
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
      errorMessage = "The model declined to build a grid from this draft.";
    } else if (result.status === "incomplete") {
      errorCode = result.incompleteReason ?? "incomplete";
      errorMessage =
        result.incompleteReason === "max_output_tokens"
          ? "Build stopped at the output limit before it finished. Narrow the chapter range and try again."
          : `Build is incomplete (${result.incompleteReason ?? "no reason given"}).`;
    } else {
      const parsed = parseWeaveBuildOutput(result.text);
      if (!parsed.ok) {
        errorCode = "malformed_output";
        errorMessage = `The model's response did not match the Weave build format. ${parsed.problems.join(" ")}`;
      } else {
        proposal = enrichProposal(parsed.draft, new Set(Object.keys(prep.sentRevisions)), prep.recordBodies);
        contentHash = sha256(JSON.stringify(proposal));
        status = "proposed";
      }
    }
  } catch (error) {
    const e = error instanceof ProviderError ? error : new ProviderError("provider_failed", "The Weave build request failed unexpectedly.");
    const cancelled = e.code === "cancelled" || signal.aborted;
    status = cancelled ? "cancelled" : "failed";
    errorCode = cancelled ? "cancelled" : e.code;
    errorMessage = cancelled ? "Cancelled. No Weave suggestions were stored." : e.message;
    if (cancelled) {
      usage = estimatedUsage(prep.requestChars, 0);
      usageEstimated = true;
    }
  }

  const now = new Date();
  await db.weaveBuildRun.update({
    where: { id: prep.runId },
    data: {
      status,
      errorCode,
      errorMessage,
      contentHash,
      proposalJson: proposal ? JSON.stringify(proposal) : "",
      providerResponseId: responseId ?? null,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      totalTokens: usage?.totalTokens ?? null,
      usageEstimated,
      completedAt: status === "proposed" ? null : now,
    },
  });

  return getWeaveBuildRun(db, (await db.weaveBuildRun.findFirstOrThrow({ where: { id: prep.runId } })).projectId, prep.runId);
}

export async function getWeaveBuildRun(db: DbOrTx, projectId: string, runId: string): Promise<WeaveBuildRunView> {
  const row = await db.weaveBuildRun.findFirst({ where: { id: runId, projectId } });
  if (!row) throw new NotFoundError(`Weave build run ${runId} not found`);
  if (!isWeaveViewKind(row.viewKind)) throw rejected("Stored Weave build has an unknown view kind."); // throw for typed Error
  const proposal = row.proposalJson ? (parseJsonObject<WeaveBuildProposal | null>(row.proposalJson, null) as WeaveBuildProposal | null) : null;
  const existingGrid = row.gridId ? await getWeaveGrid(db, projectId, row.gridId).catch(() => null) : null;
  return {
    id: row.id,
    projectId: row.projectId,
    draftId: row.draftId,
    gridId: row.gridId,
    gridTitle: row.gridTitle,
    viewKind: row.viewKind,
    chapterFromId: row.chapterFromId,
    chapterToId: row.chapterToId,
    status: row.status as WeaveBuildStatus,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    sourceHash: row.sourceHash,
    contentHash: row.contentHash,
    proposal,
    decisions: parseJsonObject<WeaveBuildDecisions>(row.decisionsJson, {}),
    appliedKeys: parseJsonObject<string[]>(row.appliedKeysJson, []),
    requestChars: row.requestChars,
    model: row.model,
    usage:
      row.totalTokens != null
        ? {
            inputTokens: row.inputTokens ?? 0,
            outputTokens: row.outputTokens ?? 0,
            totalTokens: row.totalTokens,
            estimated: row.usageEstimated,
          }
        : null,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    existingGrid,
  };
}

export async function saveWeaveBuildDecisions(
  db: Db,
  projectId: string,
  runId: string,
  decisions: WeaveBuildDecisions,
  expectedContentHash: string,
): Promise<WeaveBuildRunView> {
  return db.$transaction(async (tx) => {
    const row = await tx.weaveBuildRun.findFirst({ where: { id: runId, projectId } });
    if (!row) throw new NotFoundError(`Weave build run ${runId} not found`);
    if (row.status !== "proposed" && row.status !== "applied") {
      throw rejected("This Weave build is not ready for decisions.");
    }
    if (row.contentHash !== expectedContentHash) {
      throw rejected("This Weave build changed since the page loaded. Reload and try again.");
    }
    await tx.weaveBuildRun.update({
      where: { id: runId },
      data: { decisionsJson: JSON.stringify(decisions) },
    });
    return getWeaveBuildRun(tx, projectId, runId);
  });
}

async function assertSourcesFresh(tx: Tx, projectId: string, sent: Record<string, number>): Promise<void> {
  for (const [recordId, revision] of Object.entries(sent)) {
    const live = await tx.record.findFirst({
      where: { id: recordId, projectId, ...LIVE_RECORD },
      select: { id: true, title: true, currentRevision: true },
    });
    if (!live) {
      throw rejected(`Source "${recordId}" is missing or in Trash. Reload the build from a current draft.`);
    }
    // Allow newer live revisions only when the pin still exists; for draft-body
    // analysis we require the exact sent revision still be current.
    if (live.currentRevision !== revision) {
      const pinnedStill = await tx.revision.findUnique({
        where: { recordId_revisionNumber: { recordId, revisionNumber: revision } },
      });
      if (!pinnedStill) {
        throw rejected(`"${live.title}" no longer has revision ${revision}. Re-run Build grid from draft.`);
      }
      // Soft stale: author can still apply planning notes from the exact sent text,
      // but we refuse if the revision row vanished. Prefer hard stale when current moved
      // and this run was based on "current" draft pages (no rewrite pins) — detected by
      // comparing to current: always refuse drift for safety.
      throw rejected(
        `"${live.title}" was saved again since this build (revision ${revision} is now ${live.currentRevision}). Re-run Build grid from draft.`,
      );
    }
  }
}

function purposeBody(row: WeaveBuildProposalRow, edit?: WeaveBuildDecisions[string]): string {
  const goal = edit?.purposeGoal !== undefined ? edit.purposeGoal : row.purposeGoal;
  const change = edit?.purposeChange !== undefined ? edit.purposeChange : row.purposeChange;
  const forward = edit?.purposeForward !== undefined ? edit.purposeForward : row.purposeForward;
  const summary = edit?.summary?.trim() || row.summary;
  const parts = [summary];
  if (goal) parts.push(`Goal: ${goal}`);
  if (change) parts.push(`Change: ${change}`);
  if (forward) parts.push(`Forward: ${forward}`);
  return parts.filter(Boolean).join("\n\n");
}

export type ApplyWeaveBuildResult =
  | { status: "applied"; gridId: string; appliedKeys: string[]; createdThreads: number; createdBeats: number; updatedBeats: number }
  | { status: "already_applied"; gridId: string; appliedKeys: string[] };

/**
 * Atomically apply accepted suggestions. Retry-safe: suggestion keys map to
 * stable Weave IDs; a second apply with the same keys creates nothing new.
 * Existing unmatched grid content is preserved.
 */
export async function applyWeaveBuild(
  db: Db,
  projectId: string,
  runId: string,
  expectedContentHash: string,
): Promise<ApplyWeaveBuildResult> {
  return db.$transaction(async (tx) => {
    const row = await tx.weaveBuildRun.findFirst({ where: { id: runId, projectId } });
    if (!row) throw new NotFoundError(`Weave build run ${runId} not found`);
    if (row.status !== "proposed" && row.status !== "applied") {
      throw rejected("This Weave build has no suggestions to apply.");
    }
    if (row.contentHash !== expectedContentHash) {
      throw rejected("This Weave build changed since the page loaded. Reload and try again.");
    }
    const proposal = parseJsonObject<WeaveBuildProposal | null>(row.proposalJson, null);
    if (!proposal) throw rejected("This Weave build has no proposal payload.");
    const decisions = parseJsonObject<WeaveBuildDecisions>(row.decisionsJson, {});
    const already = new Set(parseJsonObject<string[]>(row.appliedKeysJson, []));
    const sent = parseJsonObject<Record<string, number>>(row.sentRevisionsJson, {});
    await assertSourcesFresh(tx, projectId, sent);

    if (!isWeaveViewKind(row.viewKind)) throw rejected("Unknown Weave view kind.");

    let gridId = row.gridId;
    if (!gridId) {
      gridId = newId("wvg");
      const title = row.gridTitle.trim() || `${WEAVE_VIEW_LABELS[row.viewKind]} (from draft)`;
      await tx.weaveGrid.create({
        data: {
          id: gridId,
          projectId,
          title,
          viewKind: row.viewKind,
          layoutMode: "plot_grid",
        },
      });
      await writeAudit(tx, {
        projectId,
        action: "weave_grid.create",
        actor: UI_ACTOR,
        summary: `Created ${WEAVE_VIEW_LABELS[row.viewKind]} "${title}" from draft build`,
        details: { gridId, viewKind: row.viewKind, buildRunId: runId },
      });
    } else {
      await tx.weaveGrid.findFirstOrThrow({ where: { id: gridId, projectId } });
      await tx.weaveGrid.update({ where: { id: gridId }, data: { layoutMode: "plot_grid" } });
    }

    let createdThreads = 0;
    let createdBeats = 0;
    let updatedBeats = 0;
    const threadIdByKey = new Map<string, string>();
    const existingThreads = await tx.weaveThread.findMany({ where: { gridId, projectId }, orderBy: { position: "asc" } });
    let nextPos = existingThreads.length ? Math.max(...existingThreads.map((t) => t.position)) + 1 : 0;

    for (const thread of proposal.threads) {
      const edit = decisions[thread.key];
      const decision = edit?.decision ?? "pending";
      if (decision === "skip") continue;
      if (decision !== "accept") continue;
      if (already.has(thread.key)) {
        const stable = stableId("wth", runId, thread.key);
        const found = existingThreads.find((t) => t.id === stable) ?? (edit?.matchThreadId ? existingThreads.find((t) => t.id === edit.matchThreadId) : null);
        if (found) threadIdByKey.set(thread.key, found.id);
        continue;
      }
      if (edit?.matchThreadId) {
        const match = existingThreads.find((t) => t.id === edit.matchThreadId);
        if (!match) throw rejected(`Matched thread ${edit.matchThreadId} is not on this grid.`);
        threadIdByKey.set(thread.key, match.id);
        already.add(thread.key);
        continue;
      }
      const id = stableId("wth", runId, thread.key);
      const existing = await tx.weaveThread.findFirst({ where: { id } });
      if (existing) {
        threadIdByKey.set(thread.key, existing.id);
        already.add(thread.key);
        continue;
      }
      const title = (edit?.title?.trim() || thread.title).slice(0, 120) || "Thread";
      await tx.weaveThread.create({
        data: { id, gridId, projectId, title, position: nextPos++ },
      });
      threadIdByKey.set(thread.key, id);
      already.add(thread.key);
      createdThreads += 1;
    }

    // Auto-map skipped/pending threads that beats still reference if a match exists by title.
    for (const thread of proposal.threads) {
      if (threadIdByKey.has(thread.key)) continue;
      const byTitle = existingThreads.find((t) => t.title.toLowerCase() === thread.title.toLowerCase());
      if (byTitle) threadIdByKey.set(thread.key, byTitle.id);
    }

    for (const rowSug of proposal.rows) {
      const edit = decisions[rowSug.key];
      const decision = edit?.decision ?? "pending";
      if (decision !== "accept") continue;
      if (already.has(rowSug.key)) continue;
      const id = stableId("wvb", runId, rowSug.key);
      const title = (edit?.title?.trim() || `${rowSug.summary.slice(0, 80) || "Scene purpose"}`).trim() || "Scene purpose";
      const body = purposeBody(rowSug, edit);
      const existing = await tx.weaveBeat.findFirst({ where: { id } });
      if (existing) {
        already.add(rowSug.key);
        continue;
      }
      if (edit?.matchBeatId) {
        const match = await tx.weaveBeat.findFirst({ where: { id: edit.matchBeatId, gridId, projectId } });
        if (!match) throw rejected(`Matched beat ${edit.matchBeatId} is not on this grid.`);
        await tx.weaveBeat.update({
          where: { id: match.id },
          data: {
            title,
            body: body || match.body,
            manuscriptRecordId: rowSug.manuscriptRecordId,
          },
        });
        already.add(rowSug.key);
        updatedBeats += 1;
        continue;
      }
      const zIndex = (await tx.weaveBeat.aggregate({ where: { gridId }, _max: { zIndex: true } }))._max.zIndex ?? 0;
      await tx.weaveBeat.create({
        data: {
          id,
          gridId,
          projectId,
          title,
          body,
          decision: "",
          manuscriptRecordId: rowSug.manuscriptRecordId,
          threadId: null,
          cellOrder: 0,
          x: 40,
          y: 40 + createdBeats * 24,
          zIndex: zIndex + 1,
        },
      });
      already.add(rowSug.key);
      createdBeats += 1;
    }

    let cell = 0;
    for (const beat of proposal.beats) {
      const edit = decisions[beat.key];
      const decision = edit?.decision ?? "pending";
      if (decision !== "accept") continue;
      if (already.has(beat.key)) continue;
      const threadId = threadIdByKey.get(beat.threadKey) ?? null;
      const title = (edit?.title?.trim() || beat.title).slice(0, 200) || "Beat";
      const passageNote = beat.sourcePassage?.excerpt
        ? `\n\nSource: ${beat.sourcePassage.excerpt}`
        : beat.sourceExcerpt
          ? `\n\nSource: ${beat.sourceExcerpt}`
          : "";
      const body = `${(edit?.body ?? beat.body).trim()}${passageNote}`.trim();
      const weaveDecision = beat.decision && isWeaveDecision(beat.decision) ? beat.decision : "";

      if (edit?.matchBeatId) {
        const match = await tx.weaveBeat.findFirst({ where: { id: edit.matchBeatId, gridId, projectId } });
        if (!match) throw rejected(`Matched beat ${edit.matchBeatId} is not on this grid.`);
        await tx.weaveBeat.update({
          where: { id: match.id },
          data: {
            title,
            body: body || match.body,
            decision: weaveDecision || match.decision,
            manuscriptRecordId: beat.manuscriptRecordId,
            threadId: threadId ?? match.threadId,
          },
        });
        already.add(beat.key);
        updatedBeats += 1;
        continue;
      }

      const id = stableId("wvb", runId, beat.key);
      const existing = await tx.weaveBeat.findFirst({ where: { id } });
      if (existing) {
        already.add(beat.key);
        continue;
      }
      const zIndex = (await tx.weaveBeat.aggregate({ where: { gridId }, _max: { zIndex: true } }))._max.zIndex ?? 0;
      await tx.weaveBeat.create({
        data: {
          id,
          gridId,
          projectId,
          title,
          body,
          decision: weaveDecision,
          manuscriptRecordId: beat.manuscriptRecordId,
          threadId,
          cellOrder: cell++,
          x: 40 + (cell % 4) * 40,
          y: 40 + Math.floor(cell / 4) * 24,
          zIndex: zIndex + 1,
        },
      });
      already.add(beat.key);
      createdBeats += 1;
    }

    const appliedKeys = [...already];
    const acceptCount = Object.values(decisions).filter((d) => d.decision === "accept").length;
    const newlyApplied = acceptCount > 0 && createdThreads + createdBeats + updatedBeats === 0 && row.status === "applied";

    await tx.weaveBuildRun.update({
      where: { id: runId },
      data: {
        status: "applied",
        gridId,
        appliedKeysJson: JSON.stringify(appliedKeys),
        completedAt: new Date(),
      },
    });
    await tx.weaveGrid.update({ where: { id: gridId }, data: { updatedAt: new Date() } });
    await writeAudit(tx, {
      projectId,
      action: "weave_build.apply",
      actor: UI_ACTOR,
      summary: `Applied Weave build suggestions to grid`,
      details: {
        buildRunId: runId,
        gridId,
        createdThreads,
        createdBeats,
        updatedBeats,
        appliedKeyCount: appliedKeys.length,
      },
    });

    if (newlyApplied || (createdThreads === 0 && createdBeats === 0 && updatedBeats === 0 && row.status === "applied")) {
      return { status: "already_applied", gridId, appliedKeys };
    }
    return { status: "applied", gridId, appliedKeys, createdThreads, createdBeats, updatedBeats };
  });
}

export async function listWeaveBuildRuns(db: DbOrTx, projectId: string, limit = 20): Promise<Array<{ id: string; status: string; createdAt: string; gridId: string | null; gridTitle: string }>> {
  const rows = await db.weaveBuildRun.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, status: true, createdAt: true, gridId: true, gridTitle: true },
  });
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    gridId: r.gridId,
    gridTitle: r.gridTitle,
  }));
}
