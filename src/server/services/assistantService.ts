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
import { ProviderError, type AssistantProvider, type ProviderRequest, type ProviderUsage } from "@/assistant/provider";
import { newId } from "@/domain/ids";
import { parseJsonObject } from "@/domain/json";
import { contentClassOf, isRecordType, type ContentClass, type RecordType } from "@/domain/recordTypes";
import { isAuthorityStatus, type AuthorityStatus } from "@/domain/statuses";
import { hasSectionStatus, listSections, outermostSections, sectionPath, type DocSection } from "@/writing/sections";
import type { Db } from "../db";
import { LIVE_PROJECT } from "./trashFilters";

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
}

export type TurnInput =
  | { kind: "ask"; projectId: string; conversationId: string; question: string; selection: TurnSelection; mode?: TurnMode }
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
}

export interface ConversationView {
  id: string;
  workspaceId: string;
  projectId: string;
  title: string;
  createdAt: string;
  messages: MessageView[];
}

export interface SelectableRecord {
  id: string;
  title: string;
  type: RecordType;
  contentClass: ContentClass;
  authorityStatus: AuthorityStatus;
  currentRevision: number;
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

/** What a selected reference contributes: its body and, if any, its structured fields. */
export function referenceText(body: string, fieldsJson: string): string {
  const fields = parseJsonObject(fieldsJson);
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

export async function deleteConversation(db: Db, projectId: string, conversationId: string): Promise<void> {
  await loadConversation(db, projectId, conversationId);
  const running = await db.assistantMessage.count({ where: { conversationId, status: "streaming" } });
  if (running) throw new AssistantError("BUSY", "Cancel the running answer before deleting this conversation.");
  await db.assistantConversation.delete({ where: { id: conversationId } });
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
        chars: contentClass === "reference" ? referenceText(r.body, r.fields).length : r.body.length,
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

async function loadDocuments(db: Db, projectId: string, refs: ItemRef[], requireCurrent: boolean): Promise<ContextDocument[]> {
  const whole = refs.filter((r) => r.kind !== "section").map((r) => r.recordId);
  const sectioned = new Set(refs.filter((r) => r.kind === "section").map((r) => r.recordId));
  if (new Set(whole).size !== whole.length || whole.some((id) => sectioned.has(id))) {
    throw new AssistantError("INVALID_REQUEST", "Each record can be included only once: whole, or as chosen sections.");
  }
  const ids = [...new Set(refs.map((r) => r.recordId))];
  const records = await db.record.findMany({ where: { id: { in: ids }, projectId, trashedAt: null } });
  const byId = new Map(records.map((r) => [r.id, r]));

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
    let text = ref.kind === "reference" ? referenceText(revision.body, revision.fields) : revision.body;
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

/** Assistant answers and proofreading runs share the same hourly limit and monthly cap. */
export async function usageSummary(db: Db, limits: AssistantLimits, now = new Date()): Promise<UsageSummary> {
  const monthStart = monthStartUtc(now);
  const hourAgo = new Date(now.getTime() - 3_600_000);
  const [all, estimated, requests, proofAll, proofEstimated, proofRequests] = await Promise.all([
    db.assistantMessage.aggregate({ _sum: { totalTokens: true }, where: { role: "assistant", createdAt: { gte: monthStart } } }),
    db.assistantMessage.aggregate({
      _sum: { totalTokens: true },
      where: { role: "assistant", usageEstimated: true, createdAt: { gte: monthStart } },
    }),
    db.assistantMessage.count({ where: { role: "assistant", createdAt: { gte: hourAgo } } }),
    db.proofreadRun.aggregate({ _sum: { totalTokens: true }, where: { createdAt: { gte: monthStart } } }),
    db.proofreadRun.aggregate({ _sum: { totalTokens: true }, where: { usageEstimated: true, createdAt: { gte: monthStart } } }),
    db.proofreadRun.count({ where: { createdAt: { gte: hourAgo } } }),
  ]);
  return {
    monthStart: monthStart.toISOString(),
    monthTokens: (all._sum.totalTokens ?? 0) + (proofAll._sum.totalTokens ?? 0),
    monthEstimatedTokens: (estimated._sum.totalTokens ?? 0) + (proofEstimated._sum.totalTokens ?? 0),
    monthlyTokenCap: limits.monthlyTokenCap,
    requestsLastHour: requests + proofRequests,
    maxRequestsPerHour: limits.maxRequestsPerHour,
  };
}

/** Refuses a request that would pass the hourly request limit or the monthly token cap. */
export async function checkRequestLimits(db: Db, limits: AssistantLimits, requestChars: number, now = new Date()): Promise<void> {
  const usage = await usageSummary(db, limits, now);
  if (usage.requestsLastHour >= limits.maxRequestsPerHour) {
    throw new AssistantError(
      "RATE_LIMITED",
      `This app allows ${limits.maxRequestsPerHour} assistant requests per hour, and that many were started in the last hour. Try again later.`,
    );
  }
  const projected = estimateTokens(requestChars) + limits.maxOutputTokens;
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

  if (input.kind === "ask") {
    mode = input.mode ?? "chat";
    question = input.question.trim();
    if (!question) {
      throw new AssistantError("INVALID_REQUEST", mode === "proposal" ? "Describe the changes to prepare first." : "Type a question first.");
    }
    const { references, manuscript, includeMessageIds } = input.selection;
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

  const documents = await loadDocuments(db, input.projectId, refs, input.kind === "ask");
  const prior = await loadPriorMessages(db, conv.id, includeIds, existingUserMessage?.createdAt);
  const boundary = chooseBoundary(
    [...documents.map((d) => d.text), ...prior.map((p) => p.content), question],
    () => randomBytes(6).toString("hex"),
  );
  const built = buildRequest({ documents, priorMessages: prior, question, boundary, mode, schemaChars: PROPOSAL_SCHEMA_CHARS });

  const size = checkSize(built, limits.maxInputChars);
  if (size) throw new AssistantError("TOO_LARGE", describeSizeProblem(size), size);

  await checkRequestLimits(db, limits, built.totalChars, now);

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

export function estimatedUsage(requestChars: number, outputChars: number): ProviderUsage {
  const inputTokens = estimateTokens(requestChars);
  const outputTokens = estimateTokens(outputChars);
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}

/**
 * Streams one answer and always stores the outcome: complete, incomplete
 * (output limit), cancelled (with the partial text) or failed.
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

  try {
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
      completedAt: new Date(),
    },
  });
  return { status, errorCode, errorMessage };
}
