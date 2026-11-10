import { canonChanges, type CanonChange } from "@/assistant/canon";
import { findFieldTextDisagreements } from "@/assistant/fieldText";
import {
  draftToPackage,
  parseProposalDraft,
  PROPOSAL_OUTPUT_JSON_SCHEMA,
  PROPOSAL_SCHEMA_NAME,
} from "@/assistant/proposalOutput";
import { ProviderError, type AssistantProvider, type ProviderUsage } from "@/assistant/provider";
import { parseProposalSourceLabel, proposalSourceLabel } from "@/assistant/sourceLabel";
import { parseChangePackage } from "@/changePackage/parse";
import type { ChangePackageV1 } from "@/changePackage/schema.v1";
import { newId } from "@/domain/ids";
import { errorIssue } from "@/domain/issues";
import type { Db, DbOrTx, Tx } from "../db";
import { AssistantError, estimatedUsage, type MessageStatus, type PreparedTurn } from "./assistantService";
import {
  applyChangePackage,
  packageContext,
  previewChangePackage,
  toMutations,
  type ApplyOutcome,
  type PackageApplyResult,
  type PackagePreview,
} from "./changePackageService";
import { planMutations } from "./mutationService";

/*
 * Assistant change proposals. The model only drafts operations; this module
 * assigns the package ID, workspace, project, scope, expected revisions and
 * approval, validates with the full package schema, and applies through
 * applyChangePackage, the same path as a manually imported package. It never
 * writes records itself.
 */

export interface ProposalView {
  id: string;
  messageId: string;
  packageId: string;
  contentHash: string;
  status: "proposed" | "applied";
  operationCount: number;
  createdAt: string;
  appliedAt: string | null;
  /** The stored package (marked "proposed"), for copying or manual import. */
  packageJson: string;
  /** Exactly what Apply would submit, checked against the current records. Null once applied. */
  preview: PackagePreview | null;
  result: PackageApplyResult | null;
  canonChanges: CanonChange[];
}

export type ProposalBuild =
  | { kind: "proposal"; pkg: ChangePackageV1; contentHash: string }
  | { kind: "no_changes"; summary: string }
  | { kind: "invalid"; code: "malformed_output" | "invalid_proposal"; problems: string[] };

export interface ProposalBuildInput {
  projectId: string;
  workspaceId: string;
  proposalId: string;
  conversationId: string;
  conversationTitle: string;
  /** Revision of every record sent with the request. */
  sentRevisions: ReadonlyMap<string, number>;
  /** Records sent only as some of their sections. */
  partialRecords?: ReadonlySet<string>;
  outputText: string;
}

function issueText(issues: { path?: string; message: string }[]): string[] {
  return issues.slice(0, 10).map((i) => (i.path ? `${i.path}: ${i.message}` : i.message));
}

/** Turns the model's structured output into a validated, proposed change package. Never writes. */
export async function buildProposalPackage(db: DbOrTx, input: ProposalBuildInput): Promise<ProposalBuild> {
  const parsedDraft = parseProposalDraft(input.outputText);
  if (!parsedDraft.ok) return { kind: "invalid", code: "malformed_output", problems: parsedDraft.problems };
  const draft = parsedDraft.draft;
  if (draft.operations.length === 0) {
    return { kind: "no_changes", summary: draft.summary.trim() || "No record changes were proposed." };
  }

  const converted = draftToPackage(draft, {
    packageId: newId("pkg"),
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    conversationLabel: proposalSourceLabel(input.proposalId, input.conversationTitle, input.conversationId),
    sentRevisions: input.sentRevisions,
    partialRecords: input.partialRecords,
    newRecordId: () => newId("rec"),
  });
  if (!converted.ok) return { kind: "invalid", code: "invalid_proposal", problems: converted.problems };

  const first = parseChangePackage(converted.pkg);
  if (!first.ok) return { kind: "invalid", code: "invalid_proposal", problems: issueText(first.issues) };

  const plan = await planMutations(db, packageContext(first.pkg), toMutations(first.pkg));
  const flagged = plan.planned.flatMap((p) =>
    findFieldTextDisagreements(p.before, p.after).map((f) => ({
      recordId: p.recordId,
      note: `Possible field/text disagreement (found by the app): ${f.message}`,
    })),
  );
  const reported = converted.disagreements.map((d) => ({
    recordId: d.recordId,
    note: `Possible field/text disagreement (noted by the assistant), field "${d.field}": ${d.note.trim()}`,
  }));

  const final = parseChangePackage({ ...first.pkg, relatedRecords: [...first.pkg.relatedRecords, ...flagged, ...reported] });
  if (!final.ok) return { kind: "invalid", code: "invalid_proposal", problems: issueText(final.issues) };
  return { kind: "proposal", pkg: final.pkg, contentHash: final.contentHash };
}

/** The package Apply submits: the stored proposal with approval set by the app, never by the model. */
export function approvedPackage(stored: ChangePackageV1, proposalId: string, contentHash: string): ChangePackageV1 {
  return {
    ...stored,
    approval: {
      status: "approved",
      statement: `Approved by the author with Apply on assistant proposal ${proposalId} (prepared content ${contentHash.slice(0, 16)}).`,
    },
  };
}

export interface ProposalTurnResult {
  status: MessageStatus;
  errorCode: string | null;
  errorMessage: string | null;
  proposalId: string | null;
}

/**
 * Asks the provider for a structured proposal and always stores the outcome.
 * Refused, incomplete and malformed responses never become proposals.
 */
export async function runProposalTurn(
  db: Db,
  provider: AssistantProvider,
  turn: PreparedTurn,
  signal: AbortSignal,
): Promise<ProposalTurnResult> {
  if (turn.mode !== "proposal") throw new Error("Not a proposal turn");
  const message = await db.assistantMessage.findUniqueOrThrow({
    where: { id: turn.assistantMessageId },
    include: { contextItems: true, conversation: { include: { project: true } } },
  });
  const conv = message.conversation;
  const sentRevisions = new Map(message.contextItems.map((c) => [c.recordId, c.revisionNumber]));
  const partialRecords = new Set(message.contextItems.filter((c) => c.kind === "section").map((c) => c.recordId));

  let status: MessageStatus = "failed";
  let errorCode: string | null = null;
  let errorMessage: string | null = null;
  let content = "";
  let usage: ProviderUsage | undefined;
  let usageEstimated = false;
  let responseId: string | undefined;
  let proposal: { id: string; pkg: ChangePackageV1; contentHash: string } | null = null;

  try {
    const result = await provider.structured(turn.request, { name: PROPOSAL_SCHEMA_NAME, schema: PROPOSAL_OUTPUT_JSON_SCHEMA }, signal);
    if (signal.aborted) throw new ProviderError("cancelled", "The request was cancelled.");
    responseId = result.responseId;
    const outputChars = result.status === "complete" ? result.text.length : result.status === "refused" ? result.refusal.length : 0;
    if (result.usage) usage = result.usage;
    else {
      usage = estimatedUsage(turn.requestChars, outputChars);
      usageEstimated = true;
    }

    if (result.status === "refused") {
      errorCode = "refused";
      content = result.refusal;
      errorMessage = "The model declined to prepare a change proposal. Nothing was prepared.";
    } else if (result.status === "incomplete") {
      status = "incomplete";
      errorCode = result.incompleteReason ?? "incomplete";
      errorMessage =
        result.incompleteReason === "max_output_tokens"
          ? "The proposal stopped at the output limit (ASSISTANT_MAX_OUTPUT_TOKENS) before it was complete. Nothing was prepared from the partial response."
          : `The proposal is incomplete (${result.incompleteReason ?? "no reason given"}). Nothing was prepared from the partial response.`;
    } else {
      const proposalId = newId("apr");
      const built = await buildProposalPackage(db, {
        projectId: conv.projectId,
        workspaceId: conv.project.workspaceId,
        proposalId,
        conversationId: conv.id,
        conversationTitle: conv.title,
        sentRevisions,
        partialRecords,
        outputText: result.text,
      });
      if (built.kind === "invalid") {
        errorCode = built.code;
        errorMessage =
          (built.code === "malformed_output"
            ? "The model's response did not match the proposal format, so nothing was prepared. "
            : "The model's proposal could not be used, so nothing was prepared. ") + built.problems.join(" ");
      } else if (built.kind === "no_changes") {
        status = "complete";
        content = `${built.summary}\n\nNo record changes were proposed.`;
      } else {
        status = "complete";
        content = built.pkg.summary;
        proposal = { id: proposalId, pkg: built.pkg, contentHash: built.contentHash };
      }
    }
  } catch (error) {
    const e = error instanceof ProviderError ? error : new ProviderError("provider_failed", "The assistant request failed unexpectedly.");
    const cancelled = e.code === "cancelled" || signal.aborted;
    status = cancelled ? "cancelled" : "failed";
    errorCode = cancelled ? "cancelled" : e.code;
    errorMessage = cancelled ? "Cancelled. Nothing was prepared." : e.message;
    if (cancelled) {
      usage = estimatedUsage(turn.requestChars, 0);
      usageEstimated = true;
    }
  }

  await db.$transaction(async (tx) => {
    await tx.assistantMessage.update({
      where: { id: turn.assistantMessageId },
      data: {
        content,
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
    if (proposal) {
      await tx.assistantProposal.create({
        data: {
          id: proposal.id,
          messageId: turn.assistantMessageId,
          workspaceId: conv.project.workspaceId,
          projectId: conv.projectId,
          packageId: proposal.pkg.packageId,
          packageJson: JSON.stringify(proposal.pkg),
          contentHash: proposal.contentHash,
          operationCount: proposal.pkg.operations.length,
        },
      });
    }
  });
  return { status, errorCode, errorMessage, proposalId: proposal?.id ?? null };
}

/* ---------- viewing and applying ---------- */

async function loadProposal(db: DbOrTx, projectId: string, proposalId: string) {
  const row = await db.assistantProposal.findUnique({
    where: { id: proposalId },
    include: { message: { include: { conversation: { include: { project: true } } } } },
  });
  const conv = row?.message.conversation;
  if (!row || !conv || row.projectId !== projectId || conv.projectId !== projectId || row.workspaceId !== conv.project.workspaceId) {
    throw new AssistantError("NOT_FOUND", "That proposal is not in this project.");
  }
  return row;
}

function storedPackage(row: { packageJson: string }): ChangePackageV1 {
  return JSON.parse(row.packageJson) as ChangePackageV1;
}

async function markApplied(db: DbOrTx, proposalId: string, appliedAt: Date) {
  await db.assistantProposal.updateMany({ where: { id: proposalId, status: "proposed" }, data: { status: "applied", appliedAt } });
}

export async function listProposalViews(db: Db, projectId: string, conversationId: string): Promise<Record<string, ProposalView>> {
  const rows = await db.assistantProposal.findMany({
    where: { projectId, message: { conversationId, conversation: { projectId } } },
    orderBy: { createdAt: "asc" },
  });
  const views: Record<string, ProposalView> = {};
  for (const row of rows) {
    const stored = storedPackage(row);
    let preview: PackagePreview | null = null;
    let result: PackageApplyResult | null = null;
    if (row.status === "applied") {
      const applied = await db.changePackage.findUnique({
        where: { projectId_packageId: { projectId, packageId: row.packageId } },
      });
      result = applied ? (JSON.parse(applied.resultJson) as PackageApplyResult) : null;
    } else {
      preview = await previewChangePackage(db, approvedPackage(stored, row.id, row.contentHash), { projectId });
      if (preview.status === "already_applied") {
        result = preview.previousResult;
        preview = null;
      }
    }
    views[row.messageId] = {
      id: row.id,
      messageId: row.messageId,
      packageId: row.packageId,
      contentHash: row.contentHash,
      status: result ? "applied" : "proposed",
      operationCount: row.operationCount,
      createdAt: row.createdAt.toISOString(),
      appliedAt: row.appliedAt?.toISOString() ?? result?.appliedAt ?? null,
      packageJson: JSON.stringify(stored, null, 2),
      preview,
      result,
      canonChanges: preview ? canonChanges(preview.operations) : [],
    };
  }
  return views;
}

export interface SourceConversation {
  id: string;
  title: string;
}

export interface ProposalReview {
  proposalId: string;
  packageId: string;
  contentHash: string;
  createdAt: string;
  conversation: SourceConversation;
  /** Exactly what Apply would submit, checked against the current records. "already_applied" once applied. */
  preview: PackagePreview;
}

/** One proposal for the review screen. Never writes. */
export async function getProposalReview(db: DbOrTx, projectId: string, proposalId: string): Promise<ProposalReview> {
  const row = await loadProposal(db, projectId, proposalId);
  const preview = await previewChangePackage(db, approvedPackage(storedPackage(row), row.id, row.contentHash), { projectId });
  return {
    proposalId: row.id,
    packageId: row.packageId,
    contentHash: row.contentHash,
    createdAt: row.createdAt.toISOString(),
    conversation: { id: row.message.conversation.id, title: row.message.conversation.title },
    preview,
  };
}

/**
 * The assistant conversation a package came from, when its source label is the
 * one this app writes and that conversation is in the same project.
 */
export async function findSourceConversation(db: DbOrTx, projectId: string, label: string | null | undefined): Promise<SourceConversation | null> {
  const parsed = parseProposalSourceLabel(label);
  if (!parsed) return null;
  const conv = await db.assistantConversation.findFirst({
    where: { id: parsed.conversationId, projectId },
    select: { id: true, title: true },
  });
  return conv ?? null;
}

export interface PendingRecordProposal {
  proposalId: string;
  conversationId: string;
  conversationTitle: string;
  createdAt: Date;
  /** Revision of this record the proposal was prepared against. */
  expectedRevision: number;
  /** What the proposal would change on this record: "title", "text", "structured fields", or "canon status → <status>". */
  changes: string[];
}

/**
 * Assistant proposals not yet applied that would change the given record.
 * Read-only: nothing here is saved content, and proposals whose package was
 * already applied (for example by importing it manually) are left out.
 */
export async function listPendingProposalsForRecord(db: DbOrTx, projectId: string, recordId: string): Promise<PendingRecordProposal[]> {
  const rows = await db.assistantProposal.findMany({
    where: { projectId, status: "proposed", message: { conversation: { projectId } } },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    include: { message: { select: { conversation: { select: { id: true, title: true } } } } },
  });
  const touching = rows.flatMap((row) => {
    let pkg: ChangePackageV1;
    try {
      pkg = storedPackage(row);
    } catch {
      return [];
    }
    const ops = (Array.isArray(pkg.operations) ? pkg.operations : []).filter(
      (op) => op.op !== "create_record" && op.recordId === recordId,
    );
    if (!ops.length) return [];
    const changes: string[] = [];
    for (const op of ops) {
      if (op.op === "update_record") {
        if (op.changes.title) changes.push("title");
        if (op.changes.body) changes.push("text");
        if (op.changes.fields) changes.push("structured fields");
        if (op.authorityStatus) changes.push(`canon status → ${op.authorityStatus}`);
      } else if (op.op === "set_authority_status") {
        changes.push(`canon status → ${op.status}`);
      }
    }
    const expected = ops.map((op) => (op.op === "create_record" ? 0 : op.expectedRevision));
    return [{ row, changes: [...new Set(changes)], expectedRevision: Math.min(...expected) }];
  });
  if (!touching.length) return [];
  const applied = await db.changePackage.findMany({
    where: { projectId, packageId: { in: touching.map((t) => t.row.packageId) } },
    select: { packageId: true },
  });
  const appliedIds = new Set(applied.map((a) => a.packageId));
  return touching
    .filter((t) => !appliedIds.has(t.row.packageId))
    .map((t) => ({
      proposalId: t.row.id,
      conversationId: t.row.message.conversation.id,
      conversationTitle: t.row.message.conversation.title,
      createdAt: t.row.createdAt,
      expectedRevision: t.expectedRevision,
      changes: t.changes,
    }));
}

export interface ApplyProposalInput {
  projectId: string;
  proposalId: string;
  /** Content hash of the proposal the author reviewed. */
  contentHash: string;
  /** Author confirmed the listed canon changes on the Apply form. */
  confirmCanon: boolean;
}

/**
 * Applies a prepared proposal after the author's explicit Apply. Revisions,
 * protection and scope are checked again by applyChangePackage; a second
 * Apply returns the stored result without changing anything.
 */
export async function applyProposal(
  db: Db,
  input: ApplyProposalInput,
  options: { beforeCommit?: (tx: Tx) => Promise<void> } = {},
): Promise<ApplyOutcome> {
  const row = await loadProposal(db, input.projectId, input.proposalId);
  if (row.contentHash !== input.contentHash) {
    return {
      status: "rejected",
      issues: [
        errorIssue("PROPOSAL_MISMATCH", "The approved content does not match the stored proposal. Reload the page and review the proposal again."),
      ],
    };
  }
  const pkg = approvedPackage(storedPackage(row), row.id, row.contentHash);
  const target = { projectId: input.projectId };

  const preview = await previewChangePackage(db, pkg, target);
  if (preview.status === "already_applied" && preview.previousResult) {
    await markApplied(db, row.id, new Date(preview.previousResult.appliedAt));
    return { status: "already_applied", result: preview.previousResult };
  }
  if (preview.canApply) {
    const canon = canonChanges(preview.operations);
    if (canon.length && !input.confirmCanon) {
      return {
        status: "rejected",
        issues: [
          errorIssue(
            "CANON_CONFIRMATION_REQUIRED",
            `This proposal changes canon (${canon.map((c) => `"${c.title}"`).join(", ")}). Confirm the canon changes to apply it.`,
          ),
        ],
      };
    }
  }

  const outcome = await applyChangePackage(db, pkg, target, {
    beforeCommit: async (tx) => {
      await markApplied(tx, row.id, new Date());
      if (options.beforeCommit) await options.beforeCommit(tx);
    },
  });
  if (outcome.status === "already_applied") await markApplied(db, row.id, new Date(outcome.result.appliedAt));
  return outcome;
}
