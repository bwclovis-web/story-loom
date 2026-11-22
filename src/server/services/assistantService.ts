import { createHash, randomBytes } from "node:crypto";
import { estimateTokens, type AssistantLimits } from "@/assistant/config";
import {
  buildRequest,
  checkSize,
  chooseBoundary,
  describeSizeProblem,
  type ContextDocument,
  type ContextKind,
  type PriorMessage,
  type SizeProblem,
  type TurnMode,
} from "@/assistant/prompt";
import { PROPOSAL_OUTPUT_JSON_SCHEMA } from "@/assistant/proposalOutput";
import {
  emptyRetrievalMeta,
  parseRetrievalMeta,
  type RetrievalContextState,
  type RetrievalMeta,
} from "@/assistant/retrievalMeta";
import { ASSISTANT_TOOLS, type RetrievalScope } from "@/assistant/tools";
import {
  ProviderError,
  type AssistantProvider,
  type ProviderRequest,
  type ProviderToolItem,
  type ProviderUsage,
} from "@/assistant/provider";
import {
  developmentIsEmpty,
  readCharacterDevelopment,
  renderCharacterContextSlice,
} from "@/domain/characterDevelopment";
import { newId } from "@/domain/ids";
import { parseJsonObject } from "@/domain/json";
import { contentClassOf, isRecordType, type ContentClass, type RecordType } from "@/domain/recordTypes";
import { isAuthorityStatus, type AuthorityStatus } from "@/domain/statuses";
import { hasSectionStatus, listSections, outermostSections, sectionPath, type DocSection } from "@/writing/sections";
import type { Db, DbOrTx } from "../db";
import { writeAudit } from "./auditService";
import { loadFocusManuscript, narrativePointForManuscript } from "./characterWritingContextService";
import { LIVE_PROJECT } from "./trashFilters";
import { applyAuthorInstructionLens, getPromptPreset, normalizeAuthorInstructionText } from "./promptPresetService";

import { clampRecentBudget, DEFAULT_RECENT_BUDGET } from "@/assistant/recentBudget";

const UI_ACTOR = "author";

export { budgetRecentMessageIds, clampRecentBudget } from "@/assistant/recentBudget";

/*
 * Assistant conversations. This service never writes records or revisions;
 * it reads the author's explicit selection, sends it through an
 * AssistantProvider, and stores the exchange with the revisions used.
 * Change proposals (mode "proposal") are assembled and applied by
 * assistantProposalService through the change-package pipeline.
 */

export const PROPOSAL_SCHEMA_CHARS = JSON.stringify(PROPOSAL_OUTPUT_JSON_SCHEMA).length;

export type AssistantErrorCode =
  | "NOT_CONFIGURED"
  | "NOT_FOUND"
  | "INVALID_REQUEST"
  | "STALE_SELECTION"
  | "TOO_LARGE"
  | "BUSY"
  | "RATE_LIMITED"
  | "USAGE_CAP";

export class AssistantError extends Error {
  constructor(
    readonly code: AssistantErrorCode,
    message: string,
    readonly size?: SizeProblem,
  ) {
    super(message);
    this.name = "AssistantError";
  }
}

export const DEFAULT_CONVERSATION_TITLE = "New conversation";
export const MAX_REFERENCES_PER_REQUEST = 50;

export type MessageStatus = "complete" | "streaming" | "incomplete" | "cancelled" | "failed";

export interface ReferenceSelection {
  recordId: string;
  revision: number;
  /** Heading ids of the sections to include instead of the whole document. */
  sections?: string[];
}

export interface ManuscriptSelection {
  recordId: string;
  revision: number;
  passage?: { start: number; end: number };
}

export interface TurnSelection {
  references: ReferenceSelection[];
  manuscript: ManuscriptSelection | null;
  includeMessageIds: string[];
  /** Records the author excluded from tool retrieval (manual Include still wins if also selected). */
  excludeRecordIds?: string[];
}

/** Write → Assistant handoff: open record, draft, selection, optional unsaved prose. */
export interface WriteHandoff {
  recordId: string;
  draftId?: string | null;
  passage?: { start: number; end: number };
  /** Explicit: when true and unsavedBody is set, include that editor text as a labeled source. */
  includeUnsavedProse: boolean;
  unsavedBody?: string | null;
}

export type TurnInput =
  | {
      kind: "ask";
      projectId: string;
      conversationId: string;
      question: string;
      selection: TurnSelection;
      mode?: TurnMode;
      /** chapter | book | series; tools stay inside this scope. Default book. */
      retrievalScope?: RetrievalScope;
      write?: WriteHandoff | null;
      /** When false, discussion has no tools (manual sources only). Default true for chat. */
      enableTools?: boolean;
      /** Optional saved preset or custom lens for this turn. */
      authorInstructionText?: string | null;
      promptPresetId?: string | null;
    }
  | { kind: "retry"; projectId: string; conversationId: string; messageId: string };

export interface AssistantRuntime {
  configured: boolean;
  model: string | null;
  limits: AssistantLimits;
}

export interface PreparedTurn {
  mode: TurnMode;
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  request: ProviderRequest;
  requestChars: number;
  projectId: string;
  retrieval: RetrievalContextState | null;
  maxToolCalls: number;
  maxToolRounds: number;
}

export interface ContextItemView {
  recordId: string;
  title: string;
  kind: ContextKind;
  revisionNumber: number;
  currentRevision: number;
  olderVersion: boolean;
  passageStart: number | null;
  passageEnd: number | null;
  charCount: number;
}

export interface MessageView {
  id: string;
  role: "user" | "assistant";
  mode: TurnMode;
  content: string;
  status: MessageStatus;
  replyToId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  usageEstimated: boolean;
  includedMessageIds: string[];
  requestChars: number | null;
  createdAt: string;
  contextItems: ContextItemView[];
  basedOnOlderVersions: boolean;
  retrieval: RetrievalMeta | null;
}

export interface ConversationView {
  id: string;
  workspaceId: string;
  projectId: string;
  title: string;
  summary: string;
  createdAt: string;
  messages: MessageView[];
}

export interface AssistantSettingsView {
  autoIncludeRecent: boolean;
  recentContextBudgetChars: number;
}

export const DEFAULT_ASSISTANT_SETTINGS: AssistantSettingsView = {
  autoIncludeRecent: false,
  recentContextBudgetChars: DEFAULT_RECENT_BUDGET,
};

export interface SelectableRecord {
  id: string;
  title: string;
  type: RecordType;
  contentClass: ContentClass;
  authorityStatus: AuthorityStatus;
  currentRevision: number;
  /** Manuscript draft id when the project has drafts; null for legacy or references. */
  draftId: string | null;
  /** Characters this record adds when selected whole. */
  chars: number;
  /** Reference documents only: sections by heading, for sending part of a long document. */
  sections: SelectableSection[];
}

export interface SelectableSection {
  id: string;
  parentId: string | null;
  level: number;
  title: string;
  statusTag: string | null;
  chars: number;
}

export interface UsageSummary {
  monthStart: string;
  monthTokens: number;
  monthEstimatedTokens: number;
  monthlyTokenCap: number;
  requestsLastHour: number;
  maxRequestsPerHour: number;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export interface CharacterReferenceOptions {
  title?: string;
  type?: string;
  /** Drafting keeps reader-only and spoiler knowledge out; editorial is the default. */
  mode?: "drafting" | "editorial" | "planning";
  allowFuturePlans?: boolean;
  bookProjectId?: string | null;
  point?: import("@/domain/characterDevelopment").NarrativePoint | null;
  edges?: import("@/world/storyOrder").OrderEdge[];
}

/** What a selected reference contributes: its body and a task-specific character slice or raw fields. */
export function referenceText(body: string, fieldsJson: string, opts?: CharacterReferenceOptions): string {
  const fields = parseJsonObject(fieldsJson);
  if (opts?.type === "character_dossier") {
    const read = readCharacterDevelopment(fields);
    if (!developmentIsEmpty(read.profile)) {
      const mode = opts.mode ?? "editorial";
      const allowFuture = opts.allowFuturePlans === true || mode === "planning";
      const slice = mode === "drafting" ? "dialogue" : allowFuture ? "spoiler" : "continuity";
      const holders =
        mode === "drafting"
          ? (["character", "both"] as const)
          : (["character", "reader", "both"] as const);
      return renderCharacterContextSlice({
        title: opts.title ?? "",
        body,
        profile: read.profile,
        slice,
        bookProjectId: opts.bookProjectId ?? opts.point?.bookProjectId ?? null,
        point: opts.point,
        edges: opts.edges,
        knowledgeHolders: holders,
        includePlannedKnowledge: allowFuture,
      });
    }
  }
  return Object.keys(fields).length ? `${body}\n\nStructured fields (JSON): ${JSON.stringify(fields)}` : body;
}

function monthStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/* ---------- conversations ---------- */

async function loadConversation(db: Db, projectId: string, conversationId: string) {
  const conv = await db.assistantConversation.findUnique({ where: { id: conversationId }, include: { project: true } });
  if (!conv || conv.projectId !== projectId || conv.workspaceId !== conv.project.workspaceId) {
    throw new AssistantError("NOT_FOUND", "That conversation does not belong to this project.");
  }
  return conv;
}

export async function createConversation(db: Db, projectId: string): Promise<{ id: string }> {
  const project = await db.project.findFirst({ where: { id: projectId, ...LIVE_PROJECT } });
  if (!project) throw new AssistantError("NOT_FOUND", "Project not found.");
  const id = newId("asc");
  await db.assistantConversation.create({
    data: { id, workspaceId: project.workspaceId, projectId, title: DEFAULT_CONVERSATION_TITLE },
  });
  return { id };
}

export async function listConversations(db: Db, projectId: string) {
  const rows = await db.assistantConversation.findMany({
    where: { projectId },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { messages: true } } },
  });
  return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt.toISOString(), messageCount: r._count.messages }));
}

export type ConversationListItem = Awaited<ReturnType<typeof listConversations>>[number];

export async function deleteConversation(db: Db, projectId: string, conversationId: string): Promise<void> {
  await loadConversation(db, projectId, conversationId);
  const running = await db.assistantMessage.count({ where: { conversationId, status: "streaming" } });
  if (running) throw new AssistantError("BUSY", "Cancel the running answer before deleting this conversation.");
  await db.assistantConversation.delete({ where: { id: conversationId } });
}

export async function getConversationSummary(db: DbOrTx, projectId: string, conversationId: string): Promise<string> {
  const conv = await loadConversation(db as Db, projectId, conversationId);
  return conv.summary;
}

export async function updateConversationSummary(
  db: Db,
  projectId: string,
  conversationId: string,
  summary: string,
): Promise<string> {
  const conv = await loadConversation(db, projectId, conversationId);
  const next = summary.normalize("NFC");
  await db.$transaction(async (tx) => {
    await tx.assistantConversation.update({ where: { id: conv.id }, data: { summary: next } });
    await writeAudit(tx, {
      projectId,
      action: "assistant.summary_update",
      actor: UI_ACTOR,
      summary: `Updated assistant conversation summary`,
      details: { conversationId: conv.id, chars: next.length },
    });
  });
  return next;
}

export async function getAssistantSettings(db: DbOrTx, projectId: string): Promise<AssistantSettingsView> {
  const row = await db.projectAssistantSettings.findUnique({ where: { projectId } });
  if (!row) return { ...DEFAULT_ASSISTANT_SETTINGS };
  return {
    autoIncludeRecent: row.autoIncludeRecent,
    recentContextBudgetChars: clampRecentBudget(row.recentContextBudgetChars),
  };
}

export async function updateAssistantSettings(
  db: Db,
  projectId: string,
  input: { autoIncludeRecent: boolean; recentContextBudgetChars: number },
): Promise<AssistantSettingsView> {
  const project = await db.project.findFirst({ where: { id: projectId, ...LIVE_PROJECT } });
  if (!project) throw new AssistantError("NOT_FOUND", "Project not found.");
  const budget = clampRecentBudget(input.recentContextBudgetChars);
  const autoIncludeRecent = input.autoIncludeRecent === true;
  await db.$transaction(async (tx) => {
    const existing = await tx.projectAssistantSettings.findUnique({ where: { projectId } });
    if (existing) {
      await tx.projectAssistantSettings.update({
        where: { projectId },
        data: { autoIncludeRecent, recentContextBudgetChars: budget },
      });
    } else {
      await tx.projectAssistantSettings.create({
        data: {
          id: newId("pas"),
          projectId,
          autoIncludeRecent,
          recentContextBudgetChars: budget,
        },
      });
    }
    await writeAudit(tx, {
      projectId,
      action: "assistant.settings_update",
      actor: UI_ACTOR,
      summary: `Updated assistant preferences`,
      details: { autoIncludeRecent, recentContextBudgetChars: budget },
    });
  });
  return { autoIncludeRecent, recentContextBudgetChars: budget };
}

/** Marks answers left "streaming" by a stopped app as failed, so they can be retried. */
async function markInterrupted(db: Db, limits: AssistantLimits, now: Date): Promise<void> {
  const before = new Date(now.getTime() - (limits.requestTimeoutSeconds + 60) * 1000);
  await db.assistantMessage.updateMany({
    where: { status: "streaming", createdAt: { lt: before } },
    data: {
      status: "failed",
      errorCode: "interrupted",
      errorMessage: "The app stopped before this answer finished.",
      completedAt: now,
    },
  });
}

export async function getConversationView(
  db: Db,
  projectId: string,
  conversationId: string,
  limits: AssistantLimits,
  now = new Date(),
): Promise<ConversationView> {
  await markInterrupted(db, limits, now);
  const conv = await loadConversation(db, projectId, conversationId);
  const messages = await db.assistantMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    include: { contextItems: { include: { record: { select: { title: true, currentRevision: true } } } } },
  });
  return {
    id: conv.id,
    workspaceId: conv.workspaceId,
    projectId: conv.projectId,
    title: conv.title,
    summary: conv.summary,
    createdAt: conv.createdAt.toISOString(),
    messages: messages.map((m) => {
      const contextItems: ContextItemView[] = m.contextItems.map((c) => ({
        recordId: c.recordId,
        title: c.record.title,
        kind: c.kind as ContextKind,
        revisionNumber: c.revisionNumber,
        currentRevision: c.record.currentRevision,
        olderVersion: c.record.currentRevision > c.revisionNumber,
        passageStart: c.passageStart,
        passageEnd: c.passageEnd,
        charCount: c.charCount,
      }));
      return {
        id: m.id,
        role: m.role as "user" | "assistant",
        mode: m.mode === "proposal" ? "proposal" : "chat",
        content: m.content,
        status: m.status as MessageStatus,
        replyToId: m.replyToId,
        errorCode: m.errorCode,
        errorMessage: m.errorMessage,
        model: m.model,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        totalTokens: m.totalTokens,
        usageEstimated: m.usageEstimated,
        includedMessageIds: JSON.parse(m.includedMessageIds) as string[],
        requestChars: m.requestChars,
        createdAt: m.createdAt.toISOString(),
        contextItems,
        basedOnOlderVersions: contextItems.some((c) => c.olderVersion),
        retrieval: parseRetrievalMeta(m.retrievalJson),
      };
    }),
  };
}

/* ---------- selection ---------- */

export async function listSelectableRecords(db: Db, projectId: string): Promise<SelectableRecord[]> {
  const rows = await db.record.findMany({ where: { projectId, trashedAt: null }, orderBy: [{ type: "asc" }, { title: "asc" }] });
  return rows.flatMap((r) => {
    if (!isRecordType(r.type) || !isAuthorityStatus(r.authorityStatus)) return [];
    const contentClass = contentClassOf(r.type);
    return [
      {
        id: r.id,
        title: r.title,
        type: r.type,
        contentClass,
        authorityStatus: r.authorityStatus,
        currentRevision: r.currentRevision,
        draftId: r.draftId,
        chars:
          contentClass === "reference"
            ? referenceText(r.body, r.fields, { title: r.title, type: r.type }).length
            : r.body.length,
        sections:
          contentClass === "reference"
            ? listSections(r.body).map((s) => ({
                id: s.id,
                parentId: s.parentId,
                level: s.level,
                title: s.title,
                statusTag: s.statusTag,
                chars: s.end - s.start,
              }))
            : [],
      },
    ];
  });
}

export async function getManuscriptText(db: Db, projectId: string, recordId: string) {
  const row = await db.record.findFirst({ where: { id: recordId, projectId, trashedAt: null } });
  if (!row || !isRecordType(row.type) || contentClassOf(row.type) !== "manuscript") {
    throw new AssistantError("NOT_FOUND", "That manuscript chapter is not in this project.");
  }
  return { recordId: row.id, title: row.title, revision: row.currentRevision, body: row.body };
}

interface ItemRef {
  recordId: string;
  revision: number;
  kind: ContextKind;
  /** Kind "passage", or kind "section" when retrying (the stored offsets). */
  passage?: { start: number; end: number };
  /** Kind "section" when asking: heading ids chosen by the author. */
  sectionIds?: string[];
}

function sectionDocuments(base: Omit<ContextDocument, "kind" | "text">, ref: ItemRef, body: string): ContextDocument[] {
  const all = listSections(body);
  let chosen: DocSection[];
  if (ref.sectionIds) {
    const missing = ref.sectionIds.filter((id) => !all.some((s) => s.id === id));
    if (missing.length || !ref.sectionIds.length) {
      throw new AssistantError("INVALID_REQUEST", `A selected section of "${base.title}" is not in revision ${base.revision}. Choose its sections again.`);
    }
    chosen = outermostSections(all, ref.sectionIds);
  } else {
    const p = ref.passage;
    const match = p ? all.find((s) => s.start === p.start && s.end === p.end) : undefined;
    if (!match) throw new AssistantError("INVALID_REQUEST", `A section of "${base.title}" can no longer be found. Choose its sections again.`);
    chosen = [match];
  }
  return chosen.map((s) => ({
    ...base,
    kind: "section" as const,
    text: body.slice(s.start, s.end),
    passage: { start: s.start, end: s.end },
    section: { path: sectionPath(all, s.id).map((h) => h.title), statusTag: s.statusTag },
  }));
}

/** Whole reference records at pinned revisions, for selection assist beside the manuscript. */
export async function loadAuthorReferenceDocuments(
  db: Db,
  projectId: string,
  refs: { recordId: string; revision: number }[],
  options: { mode?: CharacterReferenceOptions["mode"]; focusRecordId?: string | null; allowFuturePlans?: boolean } = {},
): Promise<ContextDocument[]> {
  if (!refs.length) return [];
  return loadDocuments(
    db,
    projectId,
    refs.map((r) => ({ recordId: r.recordId, revision: r.revision, kind: "reference" as const })),
    true,
    options,
  );
}

async function loadDocuments(
  db: Db,
  projectId: string,
  refs: ItemRef[],
  requireCurrent: boolean,
  options: { mode?: CharacterReferenceOptions["mode"]; focusRecordId?: string | null; allowFuturePlans?: boolean } = {},
): Promise<ContextDocument[]> {
  const whole = refs.filter((r) => r.kind !== "section").map((r) => r.recordId);
  const sectioned = new Set(refs.filter((r) => r.kind === "section").map((r) => r.recordId));
  if (new Set(whole).size !== whole.length || whole.some((id) => sectioned.has(id))) {
    throw new AssistantError("INVALID_REQUEST", "Each record can be included only once: whole, or as chosen sections.");
  }
  const ids = [...new Set(refs.map((r) => r.recordId))];
  const records = await db.record.findMany({ where: { id: { in: ids }, projectId, trashedAt: null } });
  const byId = new Map(records.map((r) => [r.id, r]));
  const focus = await loadFocusManuscript(db, projectId, options.focusRecordId);
  const { point, edges } = await narrativePointForManuscript(db, projectId, focus);

  const docs: ContextDocument[] = [];
  for (const ref of refs) {
    const record = byId.get(ref.recordId);
    if (!record || !isRecordType(record.type)) {
      throw new AssistantError("INVALID_REQUEST", `Record ${ref.recordId} is not in this project.`);
    }
    const expected: ContentClass = ref.kind === "reference" || ref.kind === "section" ? "reference" : "manuscript";
    if (contentClassOf(record.type) !== expected) {
      throw new AssistantError(
        "INVALID_REQUEST",
        expected === "reference"
          ? `"${record.title}" is a manuscript chapter. Choose it under Manuscript instead.`
          : `"${record.title}" is not a manuscript chapter.`,
      );
    }
    if (requireCurrent && record.currentRevision !== ref.revision) {
      throw new AssistantError(
        "STALE_SELECTION",
        `"${record.title}" changed since you selected it (revision ${ref.revision} is now ${record.currentRevision}). Review the selection and send again.`,
      );
    }
    const revision = await db.revision.findUnique({
      where: { recordId_revisionNumber: { recordId: record.id, revisionNumber: ref.revision } },
    });
    if (!revision || !isAuthorityStatus(revision.authorityStatus)) {
      throw new AssistantError("INVALID_REQUEST", `Revision ${ref.revision} of "${record.title}" does not exist.`);
    }

    const statusMarkedInText = expected === "reference" && hasSectionStatus(revision.body) ? true : undefined;
    if (ref.kind === "section") {
      const base = {
        recordId: record.id,
        title: revision.title,
        type: record.type,
        authorityStatus: revision.authorityStatus,
        revision: revision.revisionNumber,
        statusMarkedInText,
      };
      docs.push(...sectionDocuments(base, ref, revision.body));
      continue;
    }
    let text =
      ref.kind === "reference"
        ? referenceText(revision.body, revision.fields, {
            title: revision.title,
            type: record.type,
            mode: options.mode ?? "editorial",
            allowFuturePlans: options.allowFuturePlans,
            bookProjectId: point.bookProjectId ?? projectId,
            point,
            edges,
          })
        : revision.body;
    if (ref.kind === "passage") {
      const p = ref.passage;
      if (!p || !Number.isInteger(p.start) || !Number.isInteger(p.end) || p.start < 0 || p.end > revision.body.length || p.start >= p.end) {
        throw new AssistantError("INVALID_REQUEST", "The selected passage is not inside the chapter text. Select it again.");
      }
      text = revision.body.slice(p.start, p.end);
    }
    docs.push({
      recordId: record.id,
      title: revision.title,
      type: record.type,
      authorityStatus: revision.authorityStatus,
      revision: revision.revisionNumber,
      kind: ref.kind,
      text,
      passage: ref.kind === "passage" ? ref.passage : undefined,
      statusMarkedInText,
    });
  }
  return docs;
}

async function loadPriorMessages(db: Db, conversationId: string, ids: string[], before?: Date): Promise<PriorMessage[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const rows = await db.assistantMessage.findMany({ where: { id: { in: unique }, conversationId }, orderBy: { createdAt: "asc" } });
  if (rows.length !== unique.length) {
    throw new AssistantError("INVALID_REQUEST", "Earlier messages can only come from this conversation.");
  }
  for (const r of rows) {
    if (r.role === "assistant" && r.status !== "complete" && r.status !== "incomplete") {
      throw new AssistantError("INVALID_REQUEST", "Failed, cancelled or unfinished answers cannot be included.");
    }
    if (before && r.createdAt >= before) {
      throw new AssistantError("INVALID_REQUEST", "Only messages from before this question can be included.");
    }
  }
  return rows.map((r) => ({ id: r.id, role: r.role as "user" | "assistant", content: r.content }));
}

/* ---------- limits ---------- */

/** Assistant answers, proofreading, and chapter analysis share the hourly limit and monthly cap. */
export async function usageSummary(db: Db, limits: AssistantLimits, now = new Date()): Promise<UsageSummary> {
  const monthStart = monthStartUtc(now);
  const hourAgo = new Date(now.getTime() - 3_600_000);
  const [
    all,
    estimated,
    requests,
    proofAll,
    proofEstimated,
    proofRequests,
    analysisAll,
    analysisEstimated,
    analysisRequests,
    characterAll,
    characterEstimated,
    characterRequests,
  ] = await Promise.all([
    db.assistantMessage.aggregate({ _sum: { totalTokens: true }, where: { role: "assistant", createdAt: { gte: monthStart } } }),
    db.assistantMessage.aggregate({
      _sum: { totalTokens: true },
      where: { role: "assistant", usageEstimated: true, createdAt: { gte: monthStart } },
    }),
    db.assistantMessage.count({ where: { role: "assistant", createdAt: { gte: hourAgo } } }),
    db.proofreadRun.aggregate({ _sum: { totalTokens: true }, where: { createdAt: { gte: monthStart } } }),
    db.proofreadRun.aggregate({ _sum: { totalTokens: true }, where: { usageEstimated: true, createdAt: { gte: monthStart } } }),
    db.proofreadRun.count({ where: { createdAt: { gte: hourAgo } } }),
    db.chapterAnalysisRun.aggregate({ _sum: { totalTokens: true }, where: { createdAt: { gte: monthStart } } }),
    db.chapterAnalysisRun.aggregate({
      _sum: { totalTokens: true },
      where: { usageEstimated: true, createdAt: { gte: monthStart } },
    }),
    db.chapterAnalysisRun.count({ where: { createdAt: { gte: hourAgo } } }),
    db.characterAnalysisRun.aggregate({ _sum: { totalTokens: true }, where: { createdAt: { gte: monthStart } } }),
    db.characterAnalysisRun.aggregate({
      _sum: { totalTokens: true },
      where: { usageEstimated: true, createdAt: { gte: monthStart } },
    }),
    db.characterAnalysisRun.count({ where: { createdAt: { gte: hourAgo } } }),
  ]);
  return {
    monthStart: monthStart.toISOString(),
    monthTokens:
      (all._sum.totalTokens ?? 0) +
      (proofAll._sum.totalTokens ?? 0) +
      (analysisAll._sum.totalTokens ?? 0) +
      (characterAll._sum.totalTokens ?? 0),
    monthEstimatedTokens:
      (estimated._sum.totalTokens ?? 0) +
      (proofEstimated._sum.totalTokens ?? 0) +
      (analysisEstimated._sum.totalTokens ?? 0) +
      (characterEstimated._sum.totalTokens ?? 0),
    monthlyTokenCap: limits.monthlyTokenCap,
    requestsLastHour: requests + proofRequests + analysisRequests + characterRequests,
    maxRequestsPerHour: limits.maxRequestsPerHour,
  };
}

/** Refuses a request that would pass the hourly request limit or the monthly token cap. */
export async function checkRequestLimits(
  db: Db,
  limits: AssistantLimits,
  requestChars: number,
  now = new Date(),
  outputTokenAllowance = limits.maxOutputTokens,
): Promise<void> {
  const usage = await usageSummary(db, limits, now);
  if (usage.requestsLastHour >= limits.maxRequestsPerHour) {
    throw new AssistantError(
      "RATE_LIMITED",
      `This app allows ${limits.maxRequestsPerHour} assistant requests per hour, and that many were started in the last hour. Try again later.`,
    );
  }
  const projected = estimateTokens(requestChars) + outputTokenAllowance;
  if (usage.monthTokens + projected > limits.monthlyTokenCap) {
    throw new AssistantError(
      "USAGE_CAP",
      `This request could use up to about ${projected.toLocaleString("en-US")} tokens (estimate). ` +
        `${usage.monthTokens.toLocaleString("en-US")} of this app's ${limits.monthlyTokenCap.toLocaleString("en-US")}-token monthly cap are already used. ` +
        "Send less material, wait for next month, or raise ASSISTANT_MONTHLY_TOKEN_CAP.",
    );
  }
}

/* ---------- turns ---------- */

export async function prepareTurn(db: Db, runtime: AssistantRuntime, input: TurnInput, now = new Date()): Promise<PreparedTurn> {
  if (!runtime.configured || !runtime.model) {
    throw new AssistantError("NOT_CONFIGURED", "The assistant is not set up. See How to use, \"Assistant setup\".");
  }
  const { limits } = runtime;
  const conv = await loadConversation(db, input.projectId, input.conversationId);

  await markInterrupted(db, limits, now);
  if (await db.assistantMessage.count({ where: { conversationId: conv.id, status: "streaming" } })) {
    throw new AssistantError("BUSY", "An answer is still running in this conversation. Wait for it or cancel it.");
  }

  let question: string;
  let refs: ItemRef[];
  let includeIds: string[];
  let mode: TurnMode;
  let existingUserMessage: { id: string; createdAt: Date } | null = null;

  let writeHandoff: WriteHandoff | null = null;
  let retrievalScope: RetrievalScope = "book";
  let enableTools = false;
  let excludeIds: string[] = [];

  if (input.kind === "ask") {
    mode = input.mode ?? "chat";
    question = input.question.trim();
    if (!question) {
      throw new AssistantError("INVALID_REQUEST", mode === "proposal" ? "Describe the changes to prepare first." : "Type a question first.");
    }
    const { references, manuscript, includeMessageIds } = input.selection;
    excludeIds = [...new Set(input.selection.excludeRecordIds ?? [])];
    if (references.length > MAX_REFERENCES_PER_REQUEST) {
      throw new AssistantError("INVALID_REQUEST", `Select at most ${MAX_REFERENCES_PER_REQUEST} reference records.`);
    }
    refs = references.map((r): ItemRef =>
      r.sections
        ? { recordId: r.recordId, revision: r.revision, kind: "section", sectionIds: r.sections }
        : { recordId: r.recordId, revision: r.revision, kind: "reference" },
    );
    if (manuscript) {
      refs.push({
        recordId: manuscript.recordId,
        revision: manuscript.revision,
        kind: manuscript.passage ? "passage" : "manuscript",
        passage: manuscript.passage,
      });
    }
    includeIds = includeMessageIds;
    writeHandoff = input.write ?? null;
    retrievalScope = input.retrievalScope ?? "book";
    enableTools = mode === "chat" && input.enableTools !== false && limits.maxToolCalls > 0 && limits.maxToolRounds > 0;
  } else {
    const failed = await db.assistantMessage.findFirst({
      where: { id: input.messageId, conversationId: conv.id, role: "assistant" },
      include: { contextItems: true },
    });
    if (!failed || !failed.replyToId) throw new AssistantError("NOT_FOUND", "That answer is not in this conversation.");
    if (failed.status !== "failed" && failed.status !== "cancelled") {
      throw new AssistantError("INVALID_REQUEST", "Only failed or cancelled answers can be retried.");
    }
    const userMessage = await db.assistantMessage.findFirst({ where: { id: failed.replyToId, conversationId: conv.id } });
    if (!userMessage) throw new AssistantError("NOT_FOUND", "The question for that answer is missing.");
    question = userMessage.content;
    mode = failed.mode === "proposal" ? "proposal" : "chat";
    existingUserMessage = { id: userMessage.id, createdAt: userMessage.createdAt };
    refs = failed.contextItems.map((c) => ({
      recordId: c.recordId,
      revision: c.revisionNumber,
      kind: c.kind as ContextKind,
      passage: c.passageStart !== null && c.passageEnd !== null ? { start: c.passageStart, end: c.passageEnd } : undefined,
    }));
    includeIds = JSON.parse(failed.includedMessageIds) as string[];
  }

  const characterMode =
    writeHandoff != null ? "drafting" : mode === "proposal" ? "editorial" : retrievalScope === "chapter" ? "drafting" : "editorial";
  const documents = await loadDocuments(db, input.projectId, refs, input.kind === "ask", {
    mode: characterMode,
    focusRecordId: writeHandoff?.recordId ?? (input.kind === "ask" ? input.selection.manuscript?.recordId : null),
    allowFuturePlans: false,
  });
  const sourceNotes: RetrievalMeta["sources"] = documents.map((d) => ({
    recordId: d.recordId,
    title: d.title,
    kind: d.kind,
    revision: d.revision,
    passageStart: d.passage?.start ?? null,
    passageEnd: d.passage?.end ?? null,
    origin: "manual" as const,
  }));

  if (input.kind === "ask" && writeHandoff?.includeUnsavedProse) {
    const body = writeHandoff.unsavedBody ?? "";
    if (!body.trim()) {
      throw new AssistantError("INVALID_REQUEST", "Include unsaved prose was requested, but no unsaved text was provided.");
    }
    const record = await db.record.findFirst({
      where: { id: writeHandoff.recordId, projectId: input.projectId, trashedAt: null },
    });
    if (!record || !isRecordType(record.type) || contentClassOf(record.type) !== "manuscript") {
      throw new AssistantError("INVALID_REQUEST", "Unsaved prose must belong to a manuscript chapter or scene in this project.");
    }
    const already = documents.some((d) => d.recordId === record.id);
    if (!already) {
      let text = body;
      let passage: { start: number; end: number } | undefined;
      if (writeHandoff.passage) {
        const p = writeHandoff.passage;
        if (p.start < 0 || p.end > body.length || p.start >= p.end) {
          throw new AssistantError("INVALID_REQUEST", "The selected unsaved passage is outside the editor text.");
        }
        text = body.slice(p.start, p.end);
        passage = p;
      }
      const unsavedDoc: ContextDocument = {
        recordId: record.id,
        title: `${record.title} (unsaved editor text)`,
        type: record.type,
        authorityStatus: isAuthorityStatus(record.authorityStatus) ? record.authorityStatus : "draft",
        revision: record.currentRevision,
        kind: passage ? "passage" : "manuscript",
        text,
        passage,
      };
      documents.push(unsavedDoc);
      sourceNotes.push({
        recordId: unsavedDoc.recordId,
        title: unsavedDoc.title,
        kind: unsavedDoc.kind,
        revision: unsavedDoc.revision,
        passageStart: passage?.start ?? null,
        passageEnd: passage?.end ?? null,
        origin: "unsaved",
        evidenceLabel: "Unsaved editor prose (not yet a saved revision)",
      });
    }
  }

  const prior = await loadPriorMessages(db, conv.id, includeIds, existingUserMessage?.createdAt);
  const conversationSummary = conv.summary?.trim() ? conv.summary : "";
  const focusForScope =
    writeHandoff?.recordId ??
    (input.kind === "ask" ? (input.selection.manuscript?.recordId ?? null) : null);
  const scopeLine =
    mode === "chat" && enableTools
      ? `Retrieval scope for tools: ${retrievalScope}. Focus record: ${focusForScope ?? "none"}. Draft: ${writeHandoff?.draftId ?? "legacy/default"}.`
      : "";
  const boundary = chooseBoundary(
    [...documents.map((d) => d.text), ...prior.map((p) => p.content), question, conversationSummary, scopeLine],
    () => randomBytes(6).toString("hex"),
  );
  const built = buildRequest({
    documents,
    priorMessages: prior,
    question,
    boundary,
    mode,
    schemaChars: PROPOSAL_SCHEMA_CHARS,
    conversationSummary: conversationSummary || undefined,
  });
  if (scopeLine) {
    built.instructions = `${built.instructions}\n${scopeLine}`;
    built.totalChars += scopeLine.length + 1;
  }

  if (input.kind === "ask") {
    let authorInstructionText = normalizeAuthorInstructionText(input.authorInstructionText);
    if (input.promptPresetId) {
      const preset = await getPromptPreset(db, input.projectId, input.promptPresetId);
      if (preset.surface !== "chat") {
        throw new AssistantError("INVALID_REQUEST", "That preset is for a different assistant surface. Choose a chat preset.");
      }
      if (!authorInstructionText) authorInstructionText = preset.instructionText;
    }
    applyAuthorInstructionLens(built, authorInstructionText);
  }

  const size = checkSize(built, limits.maxInputChars);
  if (size) throw new AssistantError("TOO_LARGE", describeSizeProblem(size), size);

  await checkRequestLimits(db, limits, built.totalChars, now);

  const retrievalMeta = emptyRetrievalMeta(retrievalScope);
  retrievalMeta.excludedRecordIds = excludeIds;
  retrievalMeta.unsavedProseIncluded = sourceNotes.some((s) => s.origin === "unsaved");
  retrievalMeta.sources = sourceNotes;

  const focusRecordId =
    writeHandoff?.recordId ??
    (input.kind === "ask" ? (input.selection.manuscript?.recordId ?? null) : null);
  const draftId = writeHandoff?.draftId ?? null;
  const retrieval: RetrievalContextState | null = enableTools
    ? {
        projectId: input.projectId,
        scope: retrievalScope,
        focusRecordId,
        draftId,
        excludeRecordIds: new Set(excludeIds),
        maxResultChars: limits.maxToolResultChars,
        meta: retrievalMeta,
      }
    : null;

  const userMessageId = existingUserMessage?.id ?? newId("asm");
  const assistantMessageId = newId("asm");
  await db.$transaction(async (tx) => {
    if (!existingUserMessage) {
      await tx.assistantMessage.create({
        data: {
          id: userMessageId,
          conversationId: conv.id,
          role: "user",
          mode,
          content: question,
          status: "complete",
          createdAt: now,
          completedAt: now,
        },
      });
    }
    await tx.assistantMessage.create({
      data: {
        id: assistantMessageId,
        conversationId: conv.id,
        role: "assistant",
        mode,
        content: "",
        replyToId: userMessageId,
        status: "streaming",
        model: runtime.model,
        includedMessageIds: JSON.stringify(prior.map((p) => p.id)),
        requestChars: built.totalChars,
        retrievalJson: JSON.stringify(retrievalMeta),
        createdAt: new Date(now.getTime() + 1),
        contextItems: {
          create: documents.map((d) => ({
            id: newId("aci"),
            recordId: d.recordId,
            revisionNumber: d.revision,
            kind: d.kind,
            passageStart: d.passage?.start ?? null,
            passageEnd: d.passage?.end ?? null,
            charCount: d.text.length,
            contentHash: sha256(d.text),
          })),
        },
      },
    });
    const firstLine = question.split("\n")[0].trim();
    await tx.assistantConversation.update({
      where: { id: conv.id },
      data: {
        updatedAt: now,
        ...(conv.title === DEFAULT_CONVERSATION_TITLE && input.kind === "ask"
          ? { title: firstLine.length > 60 ? `${firstLine.slice(0, 57)}...` : firstLine }
          : {}),
      },
    });
  });

  return {
    mode,
    conversationId: conv.id,
    userMessageId,
    assistantMessageId,
    projectId: input.projectId,
    requestChars: built.totalChars,
    retrieval,
    maxToolCalls: limits.maxToolCalls,
    maxToolRounds: limits.maxToolRounds,
    request: {
      model: runtime.model!,
      instructions: built.instructions,
      input: built.input,
      maxOutputTokens: limits.maxOutputTokens,
      timeoutMs: limits.requestTimeoutSeconds * 1000,
      ...(enableTools ? { tools: ASSISTANT_TOOLS, toolChoice: "auto" as const } : {}),
    },
  };
}

export function estimatedUsage(requestChars: number, outputChars: number): ProviderUsage {
  const inputTokens = estimateTokens(requestChars);
  const outputTokens = estimateTokens(outputChars);
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}

function addUsage(a: ProviderUsage | undefined, b: ProviderUsage | undefined): ProviderUsage | undefined {
  if (!a) return b;
  if (!b) return a;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

/**
 * Streams one answer (optionally with a bounded read-only tool loop) and always
 * stores the outcome: complete, incomplete, cancelled (with partial text) or failed.
 */
export async function runTurn(
  db: Db,
  provider: AssistantProvider,
  turn: PreparedTurn,
  signal: AbortSignal,
  onDelta: (text: string) => void = () => {},
): Promise<{ status: MessageStatus; errorCode: string | null; errorMessage: string | null }> {
  if (turn.mode !== "chat") throw new Error("Proposal turns are run by assistantProposalService.runProposalTurn");
  let text = "";
  let status: MessageStatus = "failed";
  let errorCode: string | null = null;
  let errorMessage: string | null = null;
  let usage: ProviderUsage | undefined;
  let usageEstimated = false;
  let responseId: string | undefined;
  const started = Date.now();
  const toolDocs: ContextDocument[] = [];
  const retrieval = turn.retrieval;

  try {
    if (retrieval && provider.complete && turn.request.tools?.length) {
      let request = turn.request;
      let rounds = 0;
      const maxToolRounds = turn.maxToolRounds;
      const maxToolCalls = turn.maxToolCalls;

      while (true) {
        if (signal.aborted) throw new ProviderError("cancelled", "The request was cancelled.");
        if (Date.now() - started > request.timeoutMs) {
          throw new ProviderError("timeout", "The assistant ran out of time while gathering evidence.");
        }
        if ((rounds >= maxToolRounds || retrieval.meta.toolCallCount >= maxToolCalls) && request.toolChoice !== "none") {
          request = { ...request, toolChoice: "none" };
        }
        const round = await provider.complete(request, signal);
        usage = addUsage(usage, round.usage);
        responseId = round.responseId ?? responseId;

        if (round.kind === "tool_calls") {
          rounds += 1;
          retrieval.meta.toolRoundCount = rounds;
          if (rounds > maxToolRounds || retrieval.meta.toolCallCount + round.calls.length > maxToolCalls) {
            retrieval.meta.omissions.push({
              label: "Further tool calls",
              reason: "Tool-call budget reached; answering with evidence gathered so far.",
            });
            const exhausted: ProviderToolItem[] = [
              ...(request.toolItems ?? []),
              ...round.calls.map((c) => ({
                type: "function_call" as const,
                call_id: c.callId,
                name: c.name,
                arguments: c.arguments,
              })),
              ...round.calls.map((c) => ({
                type: "function_call_output" as const,
                call_id: c.callId,
                output: JSON.stringify({ error: "tool_budget_exhausted" }),
              })),
            ];
            request = { ...request, toolChoice: "none", toolItems: exhausted };
            continue;
          }

          const nextTools: ProviderToolItem[] = [...(request.toolItems ?? [])];
          for (const call of round.calls) {
            retrieval.meta.toolCallCount += 1;
            nextTools.push({
              type: "function_call",
              call_id: call.callId,
              name: call.name,
              arguments: call.arguments,
            });
            const { executeAssistantTool } = await import("./assistantRetrievalService");
            const result = await executeAssistantTool(db, retrieval, call.name, call.arguments);
            for (const doc of result.documents) toolDocs.push(doc);
            nextTools.push({ type: "function_call_output", call_id: call.callId, output: result.output });
          }
          request = { ...request, toolItems: nextTools };
          continue;
        }

        text = round.text;
        status = round.status;
        if (round.status === "incomplete") {
          errorCode = round.incompleteReason ?? "incomplete";
          errorMessage =
            round.incompleteReason === "max_output_tokens"
              ? "The answer stopped at the output limit (ASSISTANT_MAX_OUTPUT_TOKENS)."
              : `The answer is incomplete (${round.incompleteReason ?? "no reason given"}).`;
        }
        if (!round.usage) {
          usage = estimatedUsage(turn.requestChars + toolDocs.reduce((n, d) => n + d.text.length, 0), text.length);
          usageEstimated = true;
        }
        onDelta(text);
        break;
      }
    } else {
      let done = false;
      for await (const event of provider.stream(turn.request, signal)) {
        if (signal.aborted) throw new ProviderError("cancelled", "The request was cancelled.");
        if (event.type === "delta") {
          text += event.text;
          onDelta(event.text);
          continue;
        }
        done = true;
        status = event.status;
        responseId = event.responseId;
        if (event.status === "incomplete") {
          errorCode = event.incompleteReason ?? "incomplete";
          errorMessage =
            event.incompleteReason === "max_output_tokens"
              ? "The answer stopped at the output limit (ASSISTANT_MAX_OUTPUT_TOKENS)."
              : `The answer is incomplete (${event.incompleteReason ?? "no reason given"}).`;
        }
        if (event.usage) usage = event.usage;
        else {
          usage = estimatedUsage(turn.requestChars, text.length);
          usageEstimated = true;
        }
        break;
      }
      if (!done) throw new ProviderError("provider_failed", "The response ended before it was complete.");
    }

    if (retrieval) {
      retrieval.meta.elapsedMs = Date.now() - started;
      const lower = text.toLowerCase();
      if (
        lower.includes("insufficient evidence") ||
        lower.includes("not enough evidence") ||
        lower.includes("cannot determine") ||
        (retrieval.meta.toolCallCount > 0 && retrieval.meta.sources.filter((s) => s.origin === "tool").length === 0)
      ) {
        retrieval.meta.insufficientEvidence = true;
      }
    }
  } catch (error) {
    const e = error instanceof ProviderError ? error : new ProviderError("provider_failed", "The assistant request failed unexpectedly.");
    const cancelled = e.code === "cancelled" || signal.aborted;
    status = cancelled ? "cancelled" : "failed";
    errorCode = cancelled ? "cancelled" : e.code;
    errorMessage = cancelled ? "Cancelled. The partial answer is kept." : e.message;
    if (cancelled || text) {
      usage = estimatedUsage(turn.requestChars, text.length);
      usageEstimated = true;
    }
    if (retrieval) retrieval.meta.elapsedMs = Date.now() - started;
  }

  if (toolDocs.length) {
    await db.assistantContextItem.createMany({
      data: toolDocs.map((d) => ({
        id: newId("aci"),
        messageId: turn.assistantMessageId,
        recordId: d.recordId,
        revisionNumber: d.revision,
        kind: d.kind,
        passageStart: d.passage?.start ?? null,
        passageEnd: d.passage?.end ?? null,
        charCount: d.text.length,
        contentHash: sha256(d.text),
      })),
    });
  }

  await db.assistantMessage.update({
    where: { id: turn.assistantMessageId },
    data: {
      content: text,
      status,
      errorCode,
      errorMessage,
      providerResponseId: responseId ?? null,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      totalTokens: usage?.totalTokens ?? null,
      usageEstimated,
      retrievalJson: retrieval ? JSON.stringify(retrieval.meta) : undefined,
      completedAt: new Date(),
    },
  });
  return { status, errorCode, errorMessage };
}
