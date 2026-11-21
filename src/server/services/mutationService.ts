import { compareBookOrder, orderAfterMove } from "@/domain/bookOrder";
import { newId } from "@/domain/ids";
import { errorIssue, warningIssue, type Issue } from "@/domain/issues";
import { stableStringify, type JsonObject } from "@/domain/json";
import { snapshotHash, snapshotOf, toRecordView, type RecordSnapshot, type RecordView } from "@/domain/records";
import {
  allowedParent,
  defaultProtectedFor,
  PARENT_TYPES,
  RECORD_TYPE_LABELS,
  requiresParent,
  type RecordType,
} from "@/domain/recordTypes";
import type { AuthorityStatus, MutationScope, SourceKind } from "@/domain/statuses";
import { mergeManuscriptBodies, splitManuscriptBody } from "@/writing/manuscriptStructure";
import type { Db, DbOrTx, Tx } from "../db";
import { writeAudit } from "./auditService";
import { MutationRejectedError, NotFoundError, StaleRevisionError } from "./errors";
import { checkCreateAllowed, checkWriteAllowed } from "./protection";
import {
  deleteFactsForRecordsInTx,
  markEvidenceNeedsRecheckForSourceInTx,
} from "./establishedFactService";
import {
  ANNOTATION_KIND,
  deleteAnnotationsForRecordsInTx,
  markAnnotationNeedsRecheckForSourceInTx,
} from "./manuscriptAnnotationService";
import { markStoryEvidenceNeedsRecheckForSourceInTx } from "./storyEventService";
import { clearWeaveForDeletedRecordsInTx } from "./weaveService";

/*
 * The only code path that writes Record and Revision rows. The UI, the
 * change-package importer, and any future API/MCP adapter all go through here.
 */

export interface CreateRecordMutation {
  kind: "create_record";
  /** Caller-chosen stable ID; generated when omitted. */
  recordId?: string;
  type: RecordType;
  title: string;
  body: string;
  fields: JsonObject;
  authorityStatus: AuthorityStatus;
  /** Request protection at creation. Cannot lower the type's default (manuscript is always protected). */
  protected?: boolean;
  /** Required for scenes and scene notes (see PARENT_TYPES); refused for every other type. */
  parentRecordId?: string | null;
  /** Optional manuscript draft. Structural only; not part of the revision snapshot. */
  draftId?: string | null;
  operationIndex?: number;
}

export interface UpdateRecordMutation {
  kind: "update_record";
  recordId: string;
  expectedRevision: number;
  changes: {
    title?: string;
    body?: string;
    fields?: { set?: JsonObject; unset?: string[] };
  };
  authorityStatus?: AuthorityStatus;
  operationIndex?: number;
}

export interface SetAuthorityStatusMutation {
  kind: "set_authority_status";
  recordId: string;
  expectedRevision: number;
  status: AuthorityStatus;
  supersededBy?: string | null;
  operationIndex?: number;
}

export type Mutation = CreateRecordMutation | UpdateRecordMutation | SetAuthorityStatusMutation;

export interface MutationSource {
  kind: SourceKind;
  conversationLabel?: string | null;
  url?: string | null;
  packageId?: string | null;
  originalFilename?: string | null;
}

export interface MutationContext {
  projectId: string;
  actor: string;
  source: MutationSource;
  scope: MutationScope;
  protectedOverrides: ReadonlySet<string>;
}

export interface PlannedMutation {
  index: number;
  mutation: Mutation;
  recordId: string;
  type: RecordType;
  protected: boolean;
  /** Set only on creation; existing records keep the parent they were created with. */
  parentRecordId: string | null;
  /** Set only on creation; existing records keep the draft they were created with. */
  draftId: string | null;
  before: RecordSnapshot | null;
  beforeRevision: number | null;
  after: RecordSnapshot;
  usesProtectedOverride: boolean;
}

export interface MutationPlan {
  issues: Issue[];
  planned: PlannedMutation[];
}

export interface MutationOutcome {
  index: number;
  kind: Mutation["kind"];
  recordId: string;
  type: RecordType;
  title: string;
  previousRevision: number | null;
  newRevision: number;
}

export interface AppliedBatch {
  sourceId: string;
  auditEntryId: string;
  outcomes: MutationOutcome[];
  planned: PlannedMutation[];
}

export interface AuditSpec {
  action: string;
  summary: string;
  packageId?: string | null;
}

function referencedIds(mutations: readonly Mutation[]): string[] {
  const ids = new Set<string>();
  for (const m of mutations) {
    if (m.kind === "create_record") {
      if (m.recordId) ids.add(m.recordId);
      if (m.parentRecordId) ids.add(m.parentRecordId);
    } else {
      ids.add(m.recordId);
    }
    if (m.kind === "set_authority_status" && m.supersededBy) ids.add(m.supersededBy);
  }
  return [...ids];
}

function checkParent(
  m: CreateRecordMutation,
  parentTypeOf: (id: string) => RecordType | undefined,
  at: { operationIndex: number; path: string },
): Issue[] {
  const label = RECORD_TYPE_LABELS[m.type];
  if (!requiresParent(m.type)) {
    return m.parentRecordId ? [errorIssue("INVALID_PARENT", `A ${label} does not belong to another record.`, at)] : [];
  }
  const allowed = PARENT_TYPES[m.type]!.map((t) => RECORD_TYPE_LABELS[t].toLowerCase()).join(" or ");
  if (!m.parentRecordId) {
    return [errorIssue("INVALID_PARENT", `A ${label} must be created inside a ${allowed}, from the Write page.`, at)];
  }
  const parentType = parentTypeOf(m.parentRecordId);
  if (!parentType) {
    return [errorIssue("INVALID_PARENT", `Parent record ${m.parentRecordId} does not exist in this project.`, at)];
  }
  if (!allowedParent(m.type, parentType)) {
    return [errorIssue("INVALID_PARENT", `A ${label} can only be inside a ${allowed}, not a ${RECORD_TYPE_LABELS[parentType]}.`, at)];
  }
  return [];
}

/**
 * Validates a batch against current state without writing. Collects every
 * issue rather than stopping at the first. Planned entries are included even
 * for mutations with issues, whenever a before/after can be computed.
 */
export async function planMutations(
  db: DbOrTx,
  ctx: MutationContext,
  mutations: readonly Mutation[],
): Promise<MutationPlan> {
  const issues: Issue[] = [];
  const planned: PlannedMutation[] = [];

  if (mutations.length === 0) {
    issues.push(errorIssue("EMPTY_BATCH", "No operations to apply."));
    return { issues, planned };
  }

  const project = await db.project.findUnique({
    where: { id: ctx.projectId },
    select: { trashedAt: true, workspace: { select: { trashedAt: true } } },
  });
  if (project && (project.trashedAt || project.workspace.trashedAt)) {
    issues.push(errorIssue("IN_TRASH", "This project is in the Trash. Restore it before changing its records."));
    return { issues, planned };
  }

  const rows = await db.record.findMany({ where: { id: { in: referencedIds(mutations) } } });
  const existing = new Map<string, RecordView>(rows.map((r) => [r.id, toRecordView(r)]));
  const trashed = new Set(rows.filter((r) => r.trashedAt && r.projectId === ctx.projectId).map((r) => r.id));
  const createdTypes = new Map<string, RecordType>();
  const targeted = new Set<string>();

  /** Records in the Trash count as absent, except for ID conflicts. */
  const inProject = (id: string) => {
    const rec = existing.get(id);
    return rec && rec.projectId === ctx.projectId && !trashed.has(id) ? rec : undefined;
  };
  /** Live records plus earlier creates in this batch (so scenes can parent to new chapters). */
  const parentTypeOf = (id: string): RecordType | undefined => inProject(id)?.type ?? createdTypes.get(id);
  const inTrash = (id: string, at: { operationIndex: number; path: string }) =>
    errorIssue("IN_TRASH", `Record ${id} is in the Trash. Restore it from the Trash first.`, { ...at, recordId: id });

  const draftIds = [
    ...new Set(mutations.flatMap((m) => (m.kind === "create_record" && m.draftId ? [m.draftId] : []))),
  ];
  const draftRows =
    draftIds.length === 0
      ? []
      : await db.manuscriptDraft.findMany({
          where: { id: { in: draftIds }, projectId: ctx.projectId },
          select: { id: true },
        });
  const draftsInProject = new Set(draftRows.map((d) => d.id));

  mutations.forEach((m, index) => {
    const opIndex = m.operationIndex ?? index;
    const at = (field?: string) => ({
      operationIndex: opIndex,
      path: field ? `operations.${opIndex}.${field}` : `operations.${opIndex}`,
    });

    if (m.kind === "create_record") {
      const recordId = m.recordId ?? newId("rec");
      if (m.recordId && existing.has(m.recordId)) {
        issues.push(
          errorIssue("RECORD_ID_CONFLICT", `Record ID ${m.recordId} already exists.`, {
            ...at("newRecordId"),
            recordId,
          }),
        );
      }
      if (targeted.has(recordId)) {
        issues.push(
          errorIssue("DUPLICATE_TARGET", `Record ${recordId} is targeted by more than one operation.`, {
            ...at(),
            recordId,
          }),
        );
      }
      targeted.add(recordId);
      createdTypes.set(recordId, m.type);
      issues.push(...checkCreateAllowed(m.type, ctx, at()));
      if (!m.title.trim()) {
        issues.push(errorIssue("INVALID_CHANGE", "Title must not be empty.", at("title")));
      }
      if (m.draftId && !draftsInProject.has(m.draftId)) {
        issues.push(errorIssue("INVALID_CHANGE", `Draft ${m.draftId} does not exist in this project.`, at("draftId")));
      }
      if (m.parentRecordId && trashed.has(m.parentRecordId)) {
        issues.push(inTrash(m.parentRecordId, at("parentRecordId")));
      } else {
        issues.push(...checkParent(m, parentTypeOf, at("parentRecordId")));
      }
      planned.push({
        index: opIndex,
        mutation: m,
        recordId,
        type: m.type,
        protected: m.protected === true || defaultProtectedFor(m.type),
        parentRecordId: m.parentRecordId ?? null,
        draftId: m.draftId ?? null,
        before: null,
        beforeRevision: null,
        after: {
          title: m.title,
          body: m.body,
          fields: m.fields,
          authorityStatus: m.authorityStatus,
          supersededByRecordId: null,
        },
        usesProtectedOverride: false,
      });
      return;
    }

    const record = inProject(m.recordId);
    if (!record && trashed.has(m.recordId)) {
      issues.push(inTrash(m.recordId, at("recordId")));
      return;
    }
    if (!record) {
      issues.push(
        errorIssue("RECORD_NOT_FOUND", `Record ${m.recordId} does not exist in this project.`, {
          ...at("recordId"),
          recordId: m.recordId,
        }),
      );
      return;
    }
    if (targeted.has(record.id)) {
      issues.push(
        errorIssue("DUPLICATE_TARGET", `Record ${record.id} is targeted by more than one operation.`, {
          ...at(),
          recordId: record.id,
        }),
      );
    }
    targeted.add(record.id);

    if (m.expectedRevision !== record.currentRevision) {
      issues.push(
        errorIssue(
          "STALE_REVISION",
          `Record ${record.id} is at revision ${record.currentRevision}, but the change expected revision ${m.expectedRevision}.`,
          { ...at("expectedRevision"), recordId: record.id },
        ),
      );
    }
    issues.push(...checkWriteAllowed(record, ctx, at()));

    const before = snapshotOf(record);
    const after: RecordSnapshot = { ...before, fields: { ...before.fields } };

    if (m.kind === "update_record") {
      const { title, body, fields } = m.changes;
      if (title === undefined && body === undefined && !fields && m.authorityStatus === undefined) {
        issues.push(errorIssue("INVALID_CHANGE", "Update contains no changes.", { ...at("changes"), recordId: record.id }));
      }
      if (title !== undefined) {
        if (!title.trim()) {
          issues.push(errorIssue("INVALID_CHANGE", "Title must not be empty.", { ...at("changes.title"), recordId: record.id }));
        }
        after.title = title;
      }
      if (body !== undefined) after.body = body;
      if (fields) {
        const set = fields.set ?? {};
        const unset = fields.unset ?? [];
        for (const key of unset) {
          if (key in set) {
            issues.push(
              errorIssue("INVALID_CHANGE", `Field "${key}" is both set and unset.`, {
                ...at("changes.fields"),
                recordId: record.id,
              }),
            );
          } else if (!(key in after.fields)) {
            issues.push(
              warningIssue("FIELD_NOT_PRESENT", `Field "${key}" is not present on ${record.id}; unset has no effect.`, {
                ...at("changes.fields.unset"),
                recordId: record.id,
              }),
            );
          }
          delete after.fields[key];
        }
        Object.assign(after.fields, set);
      }
      if (m.authorityStatus !== undefined) {
        after.authorityStatus = m.authorityStatus;
        if (m.authorityStatus !== "superseded") after.supersededByRecordId = null;
      }
    } else {
      after.authorityStatus = m.status;
      if (m.status === "superseded") {
        after.supersededByRecordId = m.supersededBy ?? null;
        if (m.supersededBy) {
          if (m.supersededBy === record.id) {
            issues.push(
              errorIssue("INVALID_REFERENCE", "A record cannot supersede itself.", {
                ...at("supersededBy"),
                recordId: record.id,
              }),
            );
          } else if (trashed.has(m.supersededBy)) {
            issues.push(inTrash(m.supersededBy, at("supersededBy")));
          } else if (!inProject(m.supersededBy) && !mutations.some((o) => o.kind === "create_record" && o.recordId === m.supersededBy)) {
            issues.push(
              errorIssue("INVALID_REFERENCE", `supersededBy ${m.supersededBy} does not exist in this project.`, {
                ...at("supersededBy"),
                recordId: record.id,
              }),
            );
          }
        }
      } else {
        if (m.supersededBy) {
          issues.push(
            errorIssue("INVALID_CHANGE", "supersededBy is only allowed when status is \"superseded\".", {
              ...at("supersededBy"),
              recordId: record.id,
            }),
          );
        }
        after.supersededByRecordId = null;
      }
    }

    if (snapshotHash(before) === snapshotHash(after)) {
      issues.push(
        errorIssue("NO_EFFECTIVE_CHANGE", `Operation would not change record ${record.id}.`, {
          ...at(),
          recordId: record.id,
        }),
      );
    }

    planned.push({
      index: opIndex,
      mutation: m,
      recordId: record.id,
      type: record.type,
      protected: record.protected,
      parentRecordId: record.parentRecordId,
      draftId: null,
      before,
      beforeRevision: record.currentRevision,
      after,
      usesProtectedOverride: record.protected && ctx.protectedOverrides.has(record.id),
    });
  });

  return { issues, planned };
}

async function writeRevision(tx: Tx, recordId: string, revisionNumber: number, snapshot: RecordSnapshot, sourceId: string) {
  await tx.revision.create({
    data: {
      id: newId("rev"),
      recordId,
      revisionNumber,
      title: snapshot.title,
      body: snapshot.body,
      fields: stableStringify(snapshot.fields),
      authorityStatus: snapshot.authorityStatus,
      supersededByRecordId: snapshot.supersededByRecordId,
      contentHash: snapshotHash(snapshot),
      sourceId,
    },
  });
}

/**
 * Re-plans inside the transaction (so guards and revision checks see the
 * committed state), then writes every mutation or throws to roll back.
 */
export async function applyMutationsInTx(
  tx: Tx,
  ctx: MutationContext,
  mutations: readonly Mutation[],
  audit: AuditSpec,
): Promise<AppliedBatch> {
  const plan = await planMutations(tx, ctx, mutations);
  if (plan.issues.some((i) => i.severity === "error")) {
    throw new MutationRejectedError(plan.issues);
  }

  const sourceId = newId("src");
  await tx.source.create({
    data: {
      id: sourceId,
      projectId: ctx.projectId,
      kind: ctx.source.kind,
      actor: ctx.actor,
      conversationLabel: ctx.source.conversationLabel ?? null,
      url: ctx.source.url ?? null,
      packageId: ctx.source.packageId ?? null,
      originalFilename: ctx.source.originalFilename ?? null,
    },
  });

  const outcomes: MutationOutcome[] = [];
  for (const p of plan.planned) {
    const data = {
      title: p.after.title,
      body: p.after.body,
      fields: stableStringify(p.after.fields),
      authorityStatus: p.after.authorityStatus,
      supersededByRecordId: p.after.supersededByRecordId,
    };
    let newRevision: number;
    if (p.beforeRevision === null) {
      newRevision = 1;
      await tx.record.create({
        data: {
          id: p.recordId,
          projectId: ctx.projectId,
          type: p.type,
          protected: p.protected,
          parentRecordId: p.parentRecordId,
          draftId: p.draftId,
          currentRevision: newRevision,
          ...data,
        },
      });
    } else {
      newRevision = p.beforeRevision + 1;
      const result = await tx.record.updateMany({
        where: { id: p.recordId, projectId: ctx.projectId, currentRevision: p.beforeRevision },
        data: { ...data, currentRevision: newRevision },
      });
      if (result.count !== 1) {
        throw new StaleRevisionError(
          errorIssue("STALE_REVISION", `Record ${p.recordId} changed while the batch was being applied.`, {
            recordId: p.recordId,
            operationIndex: p.index,
          }),
        );
      }
    }
    await writeRevision(tx, p.recordId, newRevision, p.after, sourceId);
    if (p.beforeRevision !== null) {
      await markEvidenceNeedsRecheckForSourceInTx(tx, ctx.projectId, p.recordId, newRevision);
      await markStoryEvidenceNeedsRecheckForSourceInTx(tx, ctx.projectId, p.recordId, newRevision);
      await markAnnotationNeedsRecheckForSourceInTx(tx, ctx.projectId, p.recordId, newRevision);
    }
    outcomes.push({
      index: p.index,
      kind: p.mutation.kind,
      recordId: p.recordId,
      type: p.type,
      title: p.after.title,
      previousRevision: p.beforeRevision,
      newRevision,
    });
  }

  const auditEntryId = await writeAudit(tx, {
    projectId: ctx.projectId,
    action: audit.action,
    actor: ctx.actor,
    summary: audit.summary,
    sourceId,
    packageId: audit.packageId ?? null,
    details: {
      scope: ctx.scope,
      sourceKind: ctx.source.kind,
      protectedOverridesUsed: plan.planned.filter((p) => p.usesProtectedOverride).map((p) => p.recordId),
      outcomes: outcomes.map((o) => ({
        index: o.index,
        kind: o.kind,
        recordId: o.recordId,
        type: o.type,
        title: o.title,
        previousRevision: o.previousRevision,
        newRevision: o.newRevision,
      })),
    },
  });

  return { sourceId, auditEntryId, outcomes, planned: plan.planned };
}

export async function applyMutations(
  db: Db,
  ctx: MutationContext,
  mutations: readonly Mutation[],
  audit: AuditSpec,
): Promise<AppliedBatch> {
  return db.$transaction((tx) => applyMutationsInTx(tx, ctx, mutations, audit));
}

/**
 * Protection is a record-level flag outside revisioned content. It is changed
 * only through this function, never through a mutation batch or change package.
 */
export async function setRecordProtection(
  db: Db,
  input: { projectId: string; recordId: string; protected: boolean; actor: string },
): Promise<void> {
  await db.$transaction((tx) => setRecordProtectionInTx(tx, input));
}

export async function setRecordProtectionInTx(
  tx: Tx,
  input: { projectId: string; recordId: string; protected: boolean; actor: string },
): Promise<void> {
  const record = await tx.record.findFirst({ where: { id: input.recordId, projectId: input.projectId, trashedAt: null } });
  if (!record) throw new NotFoundError(`Record ${input.recordId} not found`);
  if (record.protected === input.protected) return;
  await tx.record.update({ where: { id: record.id }, data: { protected: input.protected } });
  await writeAudit(tx, {
    projectId: input.projectId,
    action: "record.protection",
    actor: input.actor,
    summary: `${input.protected ? "Protected" : "Unprotected"} "${record.title}"`,
    details: { recordId: record.id, protected: input.protected },
  });
}

/*
 * Book order. A chapter's place among chapters, and a scene's place and
 * chapter, are outside revisioned content: a move writes no revision and
 * needs no protection unlock, because no text changes. Every move is audited.
 * Notes on a moved scene stay on that scene and so move with it.
 */

export interface MoveInBookInput {
  projectId: string;
  recordId: string;
  /** The chapter a scene goes into; null for a chapter. */
  parentRecordId: string | null;
  /** Place among the destination's chapters or scenes, counted without the moved record. Clamped. */
  index: number;
  actor: string;
}

export interface MoveInBookResult {
  moved: boolean;
  position: number;
  of: number;
}

export async function moveInBook(db: Db, input: MoveInBookInput): Promise<MoveInBookResult> {
  return db.$transaction((tx) => moveInBookInTx(tx, input));
}

export async function moveInBookInTx(tx: Tx, input: MoveInBookInput): Promise<MoveInBookResult> {
  const record = await tx.record.findFirst({ where: { id: input.recordId, projectId: input.projectId, trashedAt: null } });
  if (!record) throw new NotFoundError(`Record ${input.recordId} not found`);
  const reject = (message: string): never => {
    throw new MutationRejectedError([errorIssue("INVALID_PARENT", message, { recordId: record.id })]);
  };
  let chapterTitle: string | null = null;
  if (record.type === "manuscript_chapter") {
    if (input.parentRecordId) reject("A chapter cannot go inside another record.");
  } else if (record.type === "manuscript_scene") {
    if (!input.parentRecordId) reject("A scene must be inside a chapter.");
    const parent = await tx.record.findFirst({
      where: { id: input.parentRecordId!, projectId: input.projectId, trashedAt: null },
      select: { type: true, title: true, draftId: true },
    });
    if (!parent || parent.type !== "manuscript_chapter") reject("A scene can only move into a chapter of this project.");
    if ((parent!.draftId ?? null) !== (record.draftId ?? null)) {
      reject("A scene can only move into a chapter of the same draft.");
    }
    chapterTitle = parent!.title;
  } else {
    reject("Only chapters and scenes have a place in the book.");
  }

  const siblings = await tx.record.findMany({
    where: {
      projectId: input.projectId,
      type: record.type,
      parentRecordId: input.parentRecordId,
      trashedAt: null,
      draftId: record.draftId,
    },
    select: { id: true, position: true, createdAt: true },
  });
  const before = siblings
    .map((s) => ({ id: s.id, position: s.position, createdAt: s.createdAt.toISOString() }))
    .sort(compareBookOrder);
  const beforeIds = before.map((s) => s.id);
  const order = orderAfterMove(beforeIds, record.id, input.index);
  const position = order.indexOf(record.id);
  const sameParent = record.parentRecordId === input.parentRecordId;
  if (sameParent && order.every((id, i) => beforeIds[i] === id)) return { moved: false, position, of: order.length };

  const current = new Map(before.map((s) => [s.id, s.position]));
  for (const [i, id] of order.entries()) {
    if (id === record.id) {
      await tx.record.update({ where: { id }, data: { position: i, parentRecordId: input.parentRecordId } });
    } else if (current.get(id) !== i) {
      await tx.record.update({ where: { id }, data: { position: i } });
    }
  }
  const place = `${position + 1} of ${order.length}`;
  await writeAudit(tx, {
    projectId: input.projectId,
    action: "record.move",
    actor: input.actor,
    summary:
      record.type === "manuscript_chapter"
        ? `Moved chapter "${record.title}" to place ${place}`
        : sameParent
          ? `Moved scene "${record.title}" to place ${place} in "${chapterTitle}"`
          : `Moved scene "${record.title}" to "${chapterTitle}", place ${place}`,
    details: {
      recordId: record.id,
      fromParentRecordId: record.parentRecordId,
      toParentRecordId: input.parentRecordId,
      position,
      order,
    },
  });
  return { moved: true, position, of: order.length };
}

/*
 * The Trash. Like protection, it is a record-level mark outside revisioned
 * content: moving a record to the Trash and restoring it keep every row and
 * revision. A chapter or scene goes with the scenes and notes inside it, as
 * one batch. Records are deleted only from the Trash (or with their project),
 * through deleteRecordRowsInTx.
 */

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Scenes and notes inside these records, at any depth, in or out of the Trash. */
async function descendantIds(db: DbOrTx, projectId: string, rootIds: readonly string[]): Promise<string[]> {
  const seen = new Set(rootIds);
  const found: string[] = [];
  let frontier = [...rootIds];
  while (frontier.length > 0) {
    const children = await db.record.findMany({ where: { projectId, parentRecordId: { in: frontier } }, select: { id: true } });
    frontier = children.map((c) => c.id).filter((id) => !seen.has(id));
    frontier.forEach((id) => seen.add(id));
    found.push(...frontier);
  }
  return found;
}

export interface TrashedBatch {
  batchId: string;
  recordIds: string[];
}

export async function trashRecord(
  db: Db,
  input: { projectId: string; recordId: string; actor: string; unlockProtected: boolean },
): Promise<TrashedBatch> {
  return db.$transaction((tx) => trashRecordInTx(tx, input));
}

export async function trashRecordInTx(
  tx: Tx,
  input: { projectId: string; recordId: string; actor: string; unlockProtected: boolean },
): Promise<TrashedBatch> {
  const record = await tx.record.findFirst({ where: { id: input.recordId, projectId: input.projectId, trashedAt: null } });
  if (!record) throw new NotFoundError(`Record ${input.recordId} not found`);
  const inside = await tx.record.findMany({
    where: { id: { in: await descendantIds(tx, input.projectId, [record.id]) }, trashedAt: null },
    select: { id: true, protected: true },
  });
  if ((record.protected || inside.some((r) => r.protected)) && !input.unlockProtected) {
    throw new MutationRejectedError([
      errorIssue(
        "PROTECTED_RECORD",
        `"${record.title}"${inside.length ? " or a record inside it" : ""} is protected. Confirm that you are intentionally moving it to the Trash.`,
        { recordId: record.id },
      ),
    ]);
  }
  const batchId = newId("trb");
  const recordIds = [record.id, ...inside.map((r) => r.id)];
  await tx.record.updateMany({ where: { id: { in: recordIds }, trashedAt: null }, data: { trashedAt: new Date(), trashBatchId: batchId } });
  await writeAudit(tx, {
    projectId: input.projectId,
    action: "trash.move",
    actor: input.actor,
    summary: inside.length
      ? `Moved "${record.title}" and ${plural(inside.length, "record", "records")} inside it to the Trash`
      : `Moved "${record.title}" to the Trash`,
    details: { kind: "records", batchId, recordIds },
  });
  return { batchId, recordIds };
}

export async function restoreTrashBatch(db: Db, input: { projectId: string; batchId: string; actor: string }): Promise<TrashedBatch> {
  return db.$transaction((tx) => restoreTrashBatchInTx(tx, input));
}

export async function restoreTrashBatchInTx(
  tx: Tx,
  input: { projectId: string; batchId: string; actor: string },
): Promise<TrashedBatch> {
  const rows = await tx.record.findMany({
    where: { projectId: input.projectId, trashBatchId: input.batchId, trashedAt: { not: null } },
    select: { id: true, title: true, parentRecordId: true },
  });
  if (rows.length === 0) throw new NotFoundError(`Nothing in the Trash for ${input.batchId}`);
  const ids = new Set(rows.map((r) => r.id));
  const outsideParents = rows.flatMap((r) => (r.parentRecordId && !ids.has(r.parentRecordId) ? [r.parentRecordId] : []));
  const trashedParent = await tx.record.findFirst({
    where: { id: { in: outsideParents }, trashedAt: { not: null } },
    select: { title: true },
  });
  if (trashedParent) {
    throw new MutationRejectedError([
      errorIssue("IN_TRASH", `"${trashedParent.title}", which this belongs to, is also in the Trash. Restore it first.`),
    ]);
  }
  const lead = rows.find((r) => !r.parentRecordId || !ids.has(r.parentRecordId)) ?? rows[0];
  await tx.record.updateMany({ where: { id: { in: [...ids] } }, data: { trashedAt: null, trashBatchId: null } });
  await writeAudit(tx, {
    projectId: input.projectId,
    action: "trash.restore",
    actor: input.actor,
    summary:
      rows.length > 1
        ? `Restored "${lead.title}" and ${plural(rows.length - 1, "record", "records")} inside it from the Trash`
        : `Restored "${lead.title}" from the Trash`,
    details: { kind: "records", batchId: input.batchId, recordIds: [...ids] },
  });
  return { batchId: input.batchId, recordIds: [...ids] };
}

export interface RecordDeletionPlan {
  records: Array<{ id: string; title: string; type: string }>;
  issues: Issue[];
}

/**
 * What deleting these Trash batches removes (the batches plus everything inside
 * their records), and why it may not be allowed. Reads only.
 */
export async function planTrashedRecordDeletion(
  db: DbOrTx,
  projectId: string,
  batchIds: readonly string[],
): Promise<RecordDeletionPlan> {
  const roots = await db.record.findMany({
    where: { projectId, trashBatchId: { in: [...batchIds] }, trashedAt: { not: null } },
    select: { id: true },
  });
  const rootIds = roots.map((r) => r.id);
  const ids = [...rootIds, ...(await descendantIds(db, projectId, rootIds))];
  const rows = await db.record.findMany({
    where: { id: { in: ids } },
    orderBy: [{ type: "asc" }, { title: "asc" }],
    select: { id: true, title: true, type: true, trashedAt: true },
  });
  const issues: Issue[] = [];
  for (const r of rows.filter((x) => !x.trashedAt)) {
    issues.push(errorIssue("DELETE_BLOCKED", `"${r.title}" is inside a record in the Trash but is not in the Trash itself.`, { recordId: r.id }));
  }
  const titles = new Map(rows.map((r) => [r.id, r.title]));
  const superseding = await db.record.findMany({
    where: { supersededByRecordId: { in: ids }, id: { notIn: ids } },
    select: { id: true, title: true, supersededByRecordId: true },
  });
  for (const r of superseding) {
    issues.push(
      errorIssue(
        "DELETE_BLOCKED",
        `"${r.title}" is marked superseded by "${titles.get(r.supersededByRecordId!)}". Change the status of "${r.title}" before deleting "${titles.get(r.supersededByRecordId!)}" permanently.`,
        { recordId: r.id },
      ),
    );
  }
  return { records: rows.map(({ id, title, type }) => ({ id, title, type })), issues };
}

export async function deleteTrashedRecordsInTx(
  tx: Tx,
  input: { projectId: string; batchIds: readonly string[]; actor: string },
): Promise<RecordDeletionPlan["records"]> {
  const plan = await planTrashedRecordDeletion(tx, input.projectId, input.batchIds);
  if (plan.issues.length) throw new MutationRejectedError(plan.issues);
  if (plan.records.length === 0) throw new NotFoundError("Nothing in the Trash to delete");
  await deleteRecordRowsInTx(tx, plan.records.map((r) => r.id));
  await writeAudit(tx, {
    projectId: input.projectId,
    action: "trash.delete",
    actor: input.actor,
    summary: `Permanently deleted ${plural(plan.records.length, "record", "records")} from the Trash`,
    details: { kind: "records", batchIds: [...input.batchIds], records: plan.records },
  });
  return plan.records;
}

/**
 * Removes records with their revisions, links, images, review items, imported
 * files, proofreading runs and assistant context items. Callers check first
 * that every record is in the Trash or that its whole project is being deleted.
 */
export async function deleteRecordRowsInTx(tx: Tx, recordIds: readonly string[]): Promise<void> {
  if (recordIds.length === 0) return;
  const ids = { in: [...recordIds] };
  await tx.rewriteSourceLink.deleteMany({ where: { OR: [{ fromRecordId: ids }, { toRecordId: ids }] } });
  await tx.readingPin.deleteMany({ where: { recordId: ids } });
  await tx.boardCard.deleteMany({ where: { recordId: ids } });
  await tx.worldMapPin.deleteMany({ where: { recordId: ids } });
  await tx.placeRelation.deleteMany({ where: { OR: [{ fromRecordId: ids }, { toRecordId: ids }] } });
  await tx.recordRelation.deleteMany({ where: { OR: [{ fromRecordId: ids }, { toRecordId: ids }] } });
  await tx.sceneLocation.deleteMany({
    where: { OR: [{ manuscriptRecordId: ids }, { locationRecordId: ids }] },
  });
  await tx.storyEventEvidence.deleteMany({ where: { sourceRecordId: ids } });
  await tx.storyEventLocation.deleteMany({ where: { locationRecordId: ids } });
  await tx.storyEventScene.deleteMany({ where: { manuscriptRecordId: ids } });
  await clearWeaveForDeletedRecordsInTx(tx, recordIds);
  await deleteFactsForRecordsInTx(tx, recordIds);
  await deleteAnnotationsForRecordsInTx(tx, recordIds);
  await tx.recordLink.deleteMany({ where: { OR: [{ fromRecordId: ids }, { toRecordId: ids }] } });
  // Clear board image cards and maps that use these images before deleting the bytes.
  const images = await tx.recordImage.findMany({ where: { recordId: ids }, select: { id: true } });
  if (images.length) {
    const imageIds = images.map((i) => i.id);
    await tx.boardCard.deleteMany({ where: { imageId: { in: imageIds } } });
    const maps = await tx.worldMap.findMany({ where: { imageId: { in: imageIds } }, select: { id: true } });
    if (maps.length) {
      await tx.worldMapPin.deleteMany({ where: { mapId: { in: maps.map((m) => m.id) } } });
      await tx.worldMap.deleteMany({ where: { id: { in: maps.map((m) => m.id) } } });
    }
  }
  await tx.recordImage.deleteMany({ where: { recordId: ids } });
  await tx.reviewItem.deleteMany({ where: { recordId: ids } });
  await tx.importedFile.deleteMany({ where: { recordId: ids } });
  await tx.assistantContextItem.deleteMany({ where: { recordId: ids } });
  await tx.proofreadRun.deleteMany({ where: { recordId: ids } });
  await tx.revision.deleteMany({ where: { recordId: ids } });
  await tx.record.deleteMany({ where: { id: ids } });
}

/*
 * Split, merge, and convert. Text changes go through applyMutationsInTx.
 * Changing a chapter into a scene, or a scene into a chapter, updates type
 * here and then moveInBookInTx. Neither writes a revision when the text is
 * unchanged. Scene notes are reparented here before a merged scene is trashed.
 */

const STRUCTURE_ACTOR = "author";

function structureContext(projectId: string, unlockIds: readonly string[]): MutationContext {
  return {
    projectId,
    actor: STRUCTURE_ACTOR,
    source: { kind: "ui", conversationLabel: "manuscript structure" },
    scope: "manuscript",
    protectedOverrides: new Set(unlockIds),
  };
}

function rejectStructure(
  code: "PROTECTED_RECORD" | "STALE_REVISION" | "INVALID_CHANGE" | "INVALID_PARENT",
  message: string,
  recordId?: string,
): never {
  throw new MutationRejectedError([errorIssue(code, message, recordId ? { recordId } : {})]);
}

function requireStructureUnlock(isProtected: boolean, unlock: boolean, title: string, recordId: string) {
  if (isProtected && !unlock) {
    rejectStructure("PROTECTED_RECORD", `"${title}" is protected. Confirm that you are intentionally changing it.`, recordId);
  }
}

async function setManuscriptTypeInTx(tx: Tx, recordId: string, type: "manuscript_chapter" | "manuscript_scene") {
  await tx.record.update({ where: { id: recordId }, data: { type } });
}

async function reparentSceneNotesInTx(tx: Tx, projectId: string, fromRecordId: string, toRecordId: string) {
  await tx.record.updateMany({
    where: { projectId, parentRecordId: fromRecordId, type: "scene_note", trashedAt: null },
    data: { parentRecordId: toRecordId },
  });
}

async function placeAfterSource(tx: Tx, projectId: string, sourceId: string, createdId: string, parentRecordId: string | null) {
  const created = await tx.record.findFirst({ where: { id: createdId, projectId, trashedAt: null } });
  if (!created) throw new NotFoundError(`Record ${createdId} not found`);
  const siblings = await tx.record.findMany({
    where: { projectId, type: created.type, parentRecordId, trashedAt: null, draftId: created.draftId },
    select: { id: true, position: true, createdAt: true },
  });
  const order = siblings
    .map((row) => ({ id: row.id, position: row.position, createdAt: row.createdAt.toISOString() }))
    .sort(compareBookOrder)
    .map((row) => row.id)
    .filter((id) => id !== createdId);
  const sourceIndex = order.indexOf(sourceId);
  await moveInBookInTx(tx, {
    projectId,
    recordId: createdId,
    parentRecordId,
    index: sourceIndex < 0 ? order.length : sourceIndex + 1,
    actor: STRUCTURE_ACTOR,
  });
}

async function copySplitAttachments(tx: Tx, projectId: string, fromId: string, toId: string, splitAt: number, tailOffset: number) {
  const links = await tx.recordLink.findMany({ where: { projectId, fromRecordId: fromId } });
  for (const link of links) {
    await tx.recordLink.create({
      data: { id: newId("lnk"), projectId, fromRecordId: toId, toRecordId: link.toRecordId },
    });
  }
  const events = await tx.storyEventScene.findMany({ where: { projectId, manuscriptRecordId: fromId } });
  for (const event of events) {
    await tx.storyEventScene.create({
      data: { id: newId("evs"), projectId, eventId: event.eventId, manuscriptRecordId: toId },
    });
  }
  const comments = await tx.manuscriptAnnotation.findMany({
    where: { projectId, recordId: fromId, kind: ANNOTATION_KIND.comment },
  });
  for (const comment of comments) {
    const start = comment.passageStart ?? 0;
    if (start < splitAt) continue;
    await tx.manuscriptAnnotation.update({
      where: { id: comment.id },
      data: {
        recordId: toId,
        passageStart: Math.max(0, start - tailOffset),
        passageEnd: Math.max(0, (comment.passageEnd ?? start) - tailOffset),
        needsRecheck: true,
      },
    });
  }
}

export async function splitManuscriptRecord(
  db: Db,
  input: {
    projectId: string;
    recordId: string;
    expectedRevision: number;
    splitAt: number;
    newTitle: string;
    unlockProtected: boolean;
  },
) {
  const title = input.newTitle.trim();
  if (!title) rejectStructure("INVALID_CHANGE", "The new part needs a title.", input.recordId);
  return db.$transaction(async (tx) => {
    const record = await tx.record.findFirst({ where: { id: input.recordId, projectId: input.projectId, trashedAt: null } });
    if (!record) throw new NotFoundError(`Record ${input.recordId} not found`);
    if (record.type !== "manuscript_chapter" && record.type !== "manuscript_scene") {
      rejectStructure("INVALID_CHANGE", "Only a chapter or a scene can be split.", record.id);
    }
    if (record.currentRevision !== input.expectedRevision) {
      rejectStructure("STALE_REVISION", "This chapter or scene was saved elsewhere. Reload it, then split again.", record.id);
    }
    requireStructureUnlock(record.protected, input.unlockProtected, record.title, record.id);
    const parts = splitManuscriptBody(record.body, input.splitAt);
    if (!parts) rejectStructure("INVALID_CHANGE", "Put the cursor in the middle of the text, with words on both sides.", record.id);
    const createdId = newId("rec");
    const isScene = record.type === "manuscript_scene";
    const parentRecordId = isScene ? record.parentRecordId : null;
    const batch = await applyMutationsInTx(
      tx,
      structureContext(input.projectId, [record.id]),
      [
        { kind: "update_record", recordId: record.id, expectedRevision: record.currentRevision, changes: { body: parts.head } },
        {
          kind: "create_record",
          recordId: createdId,
          type: isScene ? "manuscript_scene" : "manuscript_chapter",
          title,
          body: parts.tail,
          fields: {},
          authorityStatus: "draft",
          parentRecordId,
          draftId: record.draftId,
        },
      ],
      { action: "record.split", summary: `Split "${record.title}" into "${title}"` },
    );
    await placeAfterSource(tx, input.projectId, record.id, createdId, parentRecordId);
    await copySplitAttachments(tx, input.projectId, record.id, createdId, input.splitAt, parts.tailOffset);
    const updated = batch.outcomes.find((outcome) => outcome.recordId === record.id);
    return { newRecordId: createdId, head: parts.head, revision: updated?.newRevision ?? record.currentRevision + 1 };
  });
}

async function moveMergedChildren(tx: Tx, projectId: string, fromId: string, toId: string, passageShift: number) {
  await reparentSceneNotesInTx(tx, projectId, fromId, toId);

  const locations = await tx.sceneLocation.findMany({ where: { projectId, manuscriptRecordId: fromId } });
  for (const row of locations) {
    const clash = await tx.sceneLocation.findUnique({
      where: { manuscriptRecordId_locationRecordId: { manuscriptRecordId: toId, locationRecordId: row.locationRecordId } },
    });
    if (clash) {
      if (row.isPrimary && !clash.isPrimary) {
        await tx.sceneLocation.update({ where: { id: clash.id }, data: { isPrimary: true, revision: { increment: 1 } } });
      }
      await tx.sceneLocation.delete({ where: { id: row.id } });
      continue;
    }
    const keeperPrimary = await tx.sceneLocation.findFirst({
      where: { projectId, manuscriptRecordId: toId, isPrimary: true },
      select: { id: true },
    });
    await tx.sceneLocation.update({
      where: { id: row.id },
      data: { manuscriptRecordId: toId, isPrimary: row.isPrimary && !keeperPrimary, revision: { increment: 1 } },
    });
  }

  const links = await tx.recordLink.findMany({ where: { projectId, fromRecordId: fromId } });
  for (const link of links) {
    const clash = await tx.recordLink.findUnique({
      where: { fromRecordId_toRecordId: { fromRecordId: toId, toRecordId: link.toRecordId } },
    });
    if (clash) await tx.recordLink.delete({ where: { id: link.id } });
    else await tx.recordLink.update({ where: { id: link.id }, data: { fromRecordId: toId } });
  }

  const events = await tx.storyEventScene.findMany({ where: { projectId, manuscriptRecordId: fromId } });
  for (const event of events) {
    const clash = await tx.storyEventScene.findUnique({
      where: { eventId_manuscriptRecordId: { eventId: event.eventId, manuscriptRecordId: toId } },
    });
    if (clash) await tx.storyEventScene.delete({ where: { id: event.id } });
    else await tx.storyEventScene.update({ where: { id: event.id }, data: { manuscriptRecordId: toId } });
  }

  await tx.weaveBeat.updateMany({ where: { projectId, manuscriptRecordId: fromId }, data: { manuscriptRecordId: toId } });

  const notes = await tx.manuscriptAnnotation.findMany({ where: { projectId, recordId: fromId } });
  const keptSynopsis = await tx.manuscriptAnnotation.findFirst({
    where: { projectId, recordId: toId, kind: ANNOTATION_KIND.synopsis },
    select: { id: true },
  });
  for (const note of notes) {
    if (note.kind === ANNOTATION_KIND.synopsis) {
      if (keptSynopsis) await tx.manuscriptAnnotation.delete({ where: { id: note.id } });
      else await tx.manuscriptAnnotation.update({ where: { id: note.id }, data: { recordId: toId } });
      continue;
    }
    const start = note.passageStart ?? 0;
    const end = note.passageEnd ?? start;
    await tx.manuscriptAnnotation.update({
      where: { id: note.id },
      data: {
        recordId: toId,
        passageStart: start + passageShift,
        passageEnd: end + passageShift,
        needsRecheck: true,
      },
    });
  }
}

export async function mergeManuscriptScenes(
  db: Db,
  input: {
    projectId: string;
    keepRecordId: string;
    dropRecordId: string;
    expectedKeepRevision: number;
    expectedDropRevision: number;
    unlockProtected: boolean;
  },
) {
  if (input.keepRecordId === input.dropRecordId) rejectStructure("INVALID_CHANGE", "Choose two different scenes to merge.");
  return db.$transaction(async (tx) => {
    const keep = await tx.record.findFirst({ where: { id: input.keepRecordId, projectId: input.projectId, trashedAt: null } });
    const drop = await tx.record.findFirst({ where: { id: input.dropRecordId, projectId: input.projectId, trashedAt: null } });
    if (!keep) throw new NotFoundError(`Record ${input.keepRecordId} not found`);
    if (!drop) throw new NotFoundError(`Record ${input.dropRecordId} not found`);
    if (keep.type !== "manuscript_scene" || drop.type !== "manuscript_scene") {
      rejectStructure("INVALID_CHANGE", "Only two scenes can be merged.", keep.id);
    }
    if (keep.parentRecordId !== drop.parentRecordId || (keep.draftId ?? null) !== (drop.draftId ?? null)) {
      rejectStructure("INVALID_PARENT", "Scenes can be merged only when they are in the same chapter and the same draft.", keep.id);
    }
    if (keep.currentRevision !== input.expectedKeepRevision || drop.currentRevision !== input.expectedDropRevision) {
      rejectStructure("STALE_REVISION", "One of these scenes was saved elsewhere. Reload, then merge again.", keep.id);
    }
    requireStructureUnlock(keep.protected, input.unlockProtected, keep.title, keep.id);
    requireStructureUnlock(drop.protected, input.unlockProtected, drop.title, drop.id);
    const extras = await tx.record.count({
      where: { projectId: input.projectId, parentRecordId: drop.id, trashedAt: null, NOT: { type: "scene_note" } },
    });
    if (extras > 0) rejectStructure("INVALID_CHANGE", "Move anything inside this scene out before merging it.", drop.id);
    const merged = mergeManuscriptBodies(keep.body, drop.body);
    if (merged.body !== keep.body) {
      await applyMutationsInTx(
        tx,
        structureContext(input.projectId, [keep.id]),
        [{ kind: "update_record", recordId: keep.id, expectedRevision: keep.currentRevision, changes: { body: merged.body } }],
        { action: "record.merge", summary: `Merged "${drop.title}" into "${keep.title}"` },
      );
    } else {
      await writeAudit(tx, {
        projectId: input.projectId,
        action: "record.merge",
        actor: STRUCTURE_ACTOR,
        summary: `Merged empty scene "${drop.title}" into "${keep.title}"`,
        details: { keepRecordId: keep.id, dropRecordId: drop.id },
      });
    }
    await moveMergedChildren(tx, input.projectId, drop.id, keep.id, merged.dropOffset);
    await trashRecordInTx(tx, { projectId: input.projectId, recordId: drop.id, actor: STRUCTURE_ACTOR, unlockProtected: true });
    return { keepRecordId: keep.id, body: merged.body };
  });
}

export async function convertChapterScene(
  db: Db,
  input: {
    projectId: string;
    recordId: string;
    to: "chapter" | "scene";
    parentRecordId?: string | null;
    unlockProtected: boolean;
  },
) {
  return db.$transaction(async (tx) => {
    const record = await tx.record.findFirst({ where: { id: input.recordId, projectId: input.projectId, trashedAt: null } });
    if (!record) throw new NotFoundError(`Record ${input.recordId} not found`);
    requireStructureUnlock(record.protected, input.unlockProtected, record.title, record.id);
    const revision = record.currentRevision;

    if (input.to === "chapter") {
      if (record.type !== "manuscript_scene") rejectStructure("INVALID_CHANGE", "That record is already a chapter.", record.id);
      const formerParent = record.parentRecordId;
      await setManuscriptTypeInTx(tx, record.id, "manuscript_chapter");
      const chapters = await tx.record.findMany({
        where: {
          projectId: input.projectId,
          type: "manuscript_chapter",
          parentRecordId: null,
          trashedAt: null,
          draftId: record.draftId,
        },
        select: { id: true, position: true, createdAt: true },
      });
      const order = chapters
        .map((row) => ({ id: row.id, position: row.position, createdAt: row.createdAt.toISOString() }))
        .sort(compareBookOrder)
        .map((row) => row.id)
        .filter((id) => id !== record.id);
      const parentIndex = formerParent ? order.indexOf(formerParent) : -1;
      await moveInBookInTx(tx, {
        projectId: input.projectId,
        recordId: record.id,
        parentRecordId: null,
        index: parentIndex < 0 ? order.length : parentIndex + 1,
        actor: STRUCTURE_ACTOR,
      });
      await writeAudit(tx, {
        projectId: input.projectId,
        action: "record.convert",
        actor: STRUCTURE_ACTOR,
        summary: `Turned scene "${record.title}" into a chapter`,
        details: { recordId: record.id, from: "manuscript_scene", to: "manuscript_chapter" },
      });
      return { recordId: record.id, type: "manuscript_chapter" as const, revision };
    }

    if (record.type !== "manuscript_chapter") rejectStructure("INVALID_CHANGE", "That record is already a scene.", record.id);
    const parentId = input.parentRecordId ?? "";
    if (!parentId || parentId === record.id) rejectStructure("INVALID_PARENT", "Choose a different chapter to hold this scene.", record.id);
    const childScenes = await tx.record.count({
      where: { projectId: input.projectId, parentRecordId: record.id, type: "manuscript_scene", trashedAt: null },
    });
    if (childScenes > 0) {
      rejectStructure("INVALID_PARENT", "Move this chapter's scenes into another chapter before turning it into a scene.", record.id);
    }
    const parent = await tx.record.findFirst({
      where: { id: parentId, projectId: input.projectId, trashedAt: null },
      select: { id: true, type: true, title: true, draftId: true },
    });
    if (!parent || parent.type !== "manuscript_chapter") {
      rejectStructure("INVALID_PARENT", "A scene can only go inside a chapter of this project.", record.id);
    }
    if ((parent.draftId ?? null) !== (record.draftId ?? null)) {
      rejectStructure("INVALID_PARENT", "A scene can only go inside a chapter of the same draft.", record.id);
    }
    await setManuscriptTypeInTx(tx, record.id, "manuscript_scene");
    const siblings = await tx.record.count({
      where: {
        projectId: input.projectId,
        type: "manuscript_scene",
        parentRecordId: parent.id,
        trashedAt: null,
        draftId: record.draftId,
      },
    });
    await moveInBookInTx(tx, {
      projectId: input.projectId,
      recordId: record.id,
      parentRecordId: parent.id,
      index: siblings,
      actor: STRUCTURE_ACTOR,
    });
    await writeAudit(tx, {
      projectId: input.projectId,
      action: "record.convert",
      actor: STRUCTURE_ACTOR,
      summary: `Turned chapter "${record.title}" into a scene in "${parent.title}"`,
      details: { recordId: record.id, from: "manuscript_chapter", to: "manuscript_scene", parentRecordId: parent.id },
    });
    return { recordId: record.id, type: "manuscript_scene" as const, revision };
  });
}
