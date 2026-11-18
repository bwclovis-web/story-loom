import type { JsonObject } from "@/domain/json";
import { toRecordView, toRevisionView, type RecordView, type RevisionView } from "@/domain/records";
import { isLinkableReferenceType, isRecordType, RECORD_TYPE_LABELS, type RecordType } from "@/domain/recordTypes";
import { isAuthorityStatus, type AuthorityStatus } from "@/domain/statuses";
import type { RecordNavEntry } from "@/ui/navigation";
import type { Db, DbOrTx } from "../db";
import { NotFoundError } from "./errors";
import {
  applyMutations,
  moveInBook,
  restoreTrashBatch,
  setRecordProtection,
  trashRecord,
  type AppliedBatch,
  type MoveInBookResult,
  type MutationContext,
  type TrashedBatch,
} from "./mutationService";
import { LIVE_RECORD } from "./trashFilters";

/*
 * Direct author edits from the UI. The author editing in the app may touch
 * manuscript content, but protected records still require an explicit unlock.
 */

const UI_ACTOR = "author";

function uiContext(projectId: string, protectedOverrides: string[] = []): MutationContext {
  return {
    projectId,
    actor: UI_ACTOR,
    source: { kind: "ui" },
    scope: "manuscript",
    protectedOverrides: new Set(protectedOverrides),
  };
}

export async function createRecord(
  db: Db,
  projectId: string,
  input: {
    type: RecordType;
    title: string;
    body?: string;
    fields?: JsonObject;
    authorityStatus: AuthorityStatus;
    recordId?: string;
    parentRecordId?: string | null;
    draftId?: string | null;
  },
): Promise<AppliedBatch> {
  return applyMutations(
    db,
    uiContext(projectId),
    [
      {
        kind: "create_record",
        recordId: input.recordId,
        type: input.type,
        title: input.title,
        body: input.body ?? "",
        fields: input.fields ?? {},
        authorityStatus: input.authorityStatus,
        parentRecordId: input.parentRecordId ?? null,
        draftId: input.draftId ?? null,
      },
    ],
    { action: "record.create", summary: `Created ${RECORD_TYPE_LABELS[input.type]} "${input.title}"` },
  );
}

export async function updateRecord(
  db: Db,
  projectId: string,
  input: {
    recordId: string;
    expectedRevision: number;
    title?: string;
    body?: string;
    fields?: JsonObject;
    authorityStatus?: AuthorityStatus;
    /** Author explicitly unlocked a protected record for this edit. */
    unlockProtected?: boolean;
  },
): Promise<AppliedBatch> {
  const current = await getRecord(db, projectId, input.recordId);
  let fieldChanges: { set: JsonObject; unset: string[] } | undefined;
  if (input.fields) {
    const unset = Object.keys(current.fields).filter((k) => !(k in input.fields!));
    fieldChanges = { set: input.fields, unset };
  }
  return applyMutations(
    db,
    uiContext(projectId, input.unlockProtected ? [input.recordId] : []),
    [
      {
        kind: "update_record",
        recordId: input.recordId,
        expectedRevision: input.expectedRevision,
        changes: { title: input.title, body: input.body, fields: fieldChanges },
        authorityStatus: input.authorityStatus,
      },
    ],
    { action: "record.update", summary: `Edited "${input.title ?? current.title}"` },
  );
}

export async function setAuthorityStatus(
  db: Db,
  projectId: string,
  input: {
    recordId: string;
    expectedRevision: number;
    status: AuthorityStatus;
    supersededBy?: string | null;
    unlockProtected?: boolean;
  },
): Promise<AppliedBatch> {
  return applyMutations(
    db,
    uiContext(projectId, input.unlockProtected ? [input.recordId] : []),
    [
      {
        kind: "set_authority_status",
        recordId: input.recordId,
        expectedRevision: input.expectedRevision,
        status: input.status,
        supersededBy: input.supersededBy ?? null,
      },
    ],
    { action: "record.status", summary: `Set ${input.recordId} to ${input.status}` },
  );
}

export async function setProtection(db: Db, projectId: string, recordId: string, isProtected: boolean) {
  await setRecordProtection(db, { projectId, recordId, protected: isProtected, actor: UI_ACTOR });
}

/** Moves a chapter among chapters, or a scene within or between chapters. No text changes. */
export async function moveRecordInBook(
  db: Db,
  projectId: string,
  input: { recordId: string; parentRecordId: string | null; index: number },
): Promise<MoveInBookResult> {
  return moveInBook(db, { projectId, ...input, actor: UI_ACTOR });
}

export async function moveRecordToTrash(db: Db, projectId: string, recordId: string, unlockProtected: boolean): Promise<TrashedBatch> {
  return trashRecord(db, { projectId, recordId, unlockProtected, actor: UI_ACTOR });
}

export async function restoreRecordsFromTrash(db: Db, projectId: string, batchId: string): Promise<TrashedBatch> {
  return restoreTrashBatch(db, { projectId, batchId, actor: UI_ACTOR });
}

/** Scenes and notes that would move to the Trash with this record, for the confirmation. */
export async function listRecordsInside(
  db: DbOrTx,
  projectId: string,
  recordId: string,
): Promise<Array<{ id: string; title: string; type: RecordType; protected: boolean }>> {
  const found: Array<{ id: string; title: string; type: RecordType; protected: boolean }> = [];
  let frontier = [recordId];
  while (frontier.length > 0) {
    const rows = await db.record.findMany({
      where: { projectId, parentRecordId: { in: frontier }, trashedAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, title: true, type: true, protected: true },
    });
    for (const r of rows) if (isRecordType(r.type)) found.push({ id: r.id, title: r.title, type: r.type, protected: r.protected });
    frontier = rows.map((r) => r.id);
  }
  return found;
}

export async function listRecords(db: DbOrTx, projectId: string): Promise<RecordView[]> {
  const rows = await db.record.findMany({ where: { projectId, trashedAt: null }, orderBy: [{ type: "asc" }, { title: "asc" }] });
  return rows.map(toRecordView);
}

/** IDs, titles and types for navigation, without loading record text. All projects when no ID is given. */
/**
 * Navigation records for a project (or all projects). When `hasDrafts` is true,
 * manuscript chapters/scenes are limited to `draftId` (or none if draftId is
 * null); reference records are always included. Legacy projects omit the filter.
 */
export async function listRecordNav(
  db: DbOrTx,
  projectId?: string,
  options?: { draftId?: string | null; hasDrafts?: boolean },
): Promise<RecordNavEntry[]> {
  const hasDrafts = options?.hasDrafts === true;
  const draftId = options?.draftId ?? null;
  const manuscriptTypes = ["manuscript_chapter", "manuscript_scene"];
  const manuscriptScope = hasDrafts
    ? draftId
      ? { type: { in: manuscriptTypes }, draftId }
      : { type: { in: manuscriptTypes }, id: { in: [] as string[] } }
    : null;

  const where = projectId
    ? hasDrafts
      ? {
          projectId,
          trashedAt: null,
          OR: [{ type: { notIn: manuscriptTypes } }, manuscriptScope!],
        }
      : { projectId, trashedAt: null }
    : LIVE_RECORD;

  const rows = await db.record.findMany({
    where,
    orderBy: [{ type: "asc" }, { title: "asc" }],
    select: { id: true, title: true, type: true, parentRecordId: true, position: true, createdAt: true, draftId: true },
  });
  return rows.flatMap((r) =>
    isRecordType(r.type)
      ? [
          {
            id: r.id,
            title: r.title,
            type: r.type,
            parentRecordId: r.parentRecordId,
            position: r.position,
            createdAt: r.createdAt.toISOString(),
            draftId: r.draftId,
          },
        ]
      : [],
  );
}

/** Manuscript chapters and scenes only, under a draft scope (or whole project when legacy). */
export async function listManuscriptNav(
  db: DbOrTx,
  projectId: string,
  options?: { draftId?: string | null; hasDrafts?: boolean },
): Promise<RecordNavEntry[]> {
  const all = await listRecordNav(db, projectId, options);
  return all.filter((r) => r.type === "manuscript_chapter" || r.type === "manuscript_scene");
}

/** Scene notes on a chapter or scene, oldest first. */
export async function listNotes(db: DbOrTx, projectId: string, parentRecordId: string): Promise<RecordView[]> {
  const rows = await db.record.findMany({
    where: { projectId, parentRecordId, type: "scene_note", trashedAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(toRecordView);
}

export interface ReferenceChoice {
  id: string;
  title: string;
  type: RecordType;
  authorityStatus: AuthorityStatus;
}

/** Reference records a chapter or scene can be linked to, by title. No record text is loaded. */
export async function listReferenceChoices(db: DbOrTx, projectId: string): Promise<ReferenceChoice[]> {
  const rows = await db.record.findMany({
    where: { projectId, trashedAt: null },
    orderBy: [{ title: "asc" }, { id: "asc" }],
    select: { id: true, title: true, type: true, authorityStatus: true },
  });
  return rows.flatMap((r) =>
    isRecordType(r.type) && isLinkableReferenceType(r.type) && isAuthorityStatus(r.authorityStatus)
      ? [{ id: r.id, title: r.title, type: r.type, authorityStatus: r.authorityStatus }]
      : [],
  );
}

/** Records in the Trash are not found. */
export async function getRecord(db: DbOrTx, projectId: string, recordId: string): Promise<RecordView> {
  const row = await db.record.findFirst({ where: { id: recordId, projectId, trashedAt: null } });
  if (!row) throw new NotFoundError(`Record ${recordId} not found`);
  return toRecordView(row);
}

export interface RevisionWithSource extends RevisionView {
  source: {
    kind: string;
    actor: string;
    conversationLabel: string | null;
    url: string | null;
    packageId: string | null;
    originalFilename: string | null;
  };
}

export async function listRevisions(db: DbOrTx, recordId: string): Promise<RevisionWithSource[]> {
  const rows = await db.revision.findMany({
    where: { recordId },
    orderBy: { revisionNumber: "desc" },
    include: { source: true },
  });
  return rows.map((r) => ({
    ...toRevisionView(r),
    source: {
      kind: r.source.kind,
      actor: r.source.actor,
      conversationLabel: r.source.conversationLabel,
      url: r.source.url,
      packageId: r.source.packageId,
      originalFilename: r.source.originalFilename,
    },
  }));
}

export async function getRevision(db: DbOrTx, recordId: string, revisionNumber: number): Promise<RevisionView | null> {
  const row = await db.revision.findUnique({ where: { recordId_revisionNumber: { recordId, revisionNumber } } });
  return row ? toRevisionView(row) : null;
}
