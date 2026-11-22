import { compareBookOrder } from "@/domain/bookOrder";
import { errorIssue } from "@/domain/issues";
import { stableStringify, type JsonObject } from "@/domain/json";
import { toRecordView, toRevisionView, type RecordView, type RevisionView } from "@/domain/records";
import { isLinkableReferenceType, isRecordType, RECORD_TYPE_LABELS, type RecordType } from "@/domain/recordTypes";
import { isAuthorityStatus, type AuthorityStatus } from "@/domain/statuses";
import type { RecordNavEntry } from "@/ui/navigation";
import { aliasesOf } from "@/writing/crossRefs";
import { worldbuildingCustomKind, worldbuildingKindFromFields } from "@/world/worldKinds";
import type { Db, DbOrTx } from "../db";
import { MutationRejectedError, NotFoundError } from "./errors";
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
import { getSeriesSharedRecord, listSeriesSharedRecords, type SeriesSharedRecord } from "./seriesBibleService";
import { isWorldType } from "@/ui/world";
import type { SeriesHomeRef } from "@/world/seriesHome";

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
    select: {
      id: true,
      title: true,
      type: true,
      parentRecordId: true,
      position: true,
      createdAt: true,
      draftId: true,
      fields: true,
    },
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
            worldKind: r.type === "worldbuilding" ? worldbuildingKindFromFields(r.fields) : null,
            customKind: r.type === "worldbuilding" ? worldbuildingCustomKind(r.fields) : null,
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

/** Scenes nested directly under a chapter, in book order, with their own text. */
export async function listScenesInChapter(
  db: DbOrTx,
  projectId: string,
  chapterId: string,
): Promise<Array<{ id: string; title: string; body: string; fieldsJson: string; revision: number; protected: boolean }>> {
  const rows = await db.record.findMany({
    where: { projectId, parentRecordId: chapterId, type: "manuscript_scene", trashedAt: null },
    select: { id: true, title: true, body: true, fields: true, currentRevision: true, protected: true, position: true, createdAt: true },
  });
  return rows
    .sort((a, b) =>
      compareBookOrder(
        { id: a.id, position: a.position, createdAt: a.createdAt.toISOString() },
        { id: b.id, position: b.position, createdAt: b.createdAt.toISOString() },
      ),
    )
    .map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      fieldsJson: row.fields,
      revision: row.currentRevision,
      protected: row.protected,
    }));
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

export interface CodexEntryRow {
  id: string;
  title: string;
  aliases: string[];
}

/** Titles and aliases for inline [[ / @ suggestions. Bodies are not loaded. */
export async function listCodexEntries(db: DbOrTx, projectId: string): Promise<CodexEntryRow[]> {
  const rows = await db.record.findMany({
    where: { projectId, trashedAt: null },
    orderBy: [{ title: "asc" }, { id: "asc" }],
    select: { id: true, title: true, type: true, fields: true },
  });
  const local = rows.flatMap((row) => {
    if (!isRecordType(row.type) || !isLinkableReferenceType(row.type)) return [];
    let fields: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(row.fields) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) fields = parsed as Record<string, unknown>;
    } catch {
      fields = {};
    }
    return [{ id: row.id, title: row.title, aliases: aliasesOf(fields) }];
  });
  const seen = new Set(local.map((entry) => entry.id));
  const shared = await listSeriesSharedRecords(db, projectId);
  for (const item of shared) {
    if (seen.has(item.record.id) || !isLinkableReferenceType(item.record.type)) continue;
    seen.add(item.record.id);
    local.push({ id: item.record.id, title: item.record.title, aliases: aliasesOf(item.record.fields) });
  }
  return local;
}

export interface WorldIndexEntry {
  record: RecordView;
  /** Set when the reference lives in another book of this series. */
  home: SeriesHomeRef | null;
}

/** This book's world references, plus series-scoped references from sibling books. */
export async function listWorldIndex(db: DbOrTx, projectId: string): Promise<WorldIndexEntry[]> {
  const [local, shared] = await Promise.all([listRecords(db, projectId), listSeriesSharedRecords(db, projectId)]);
  return [
    ...local.filter((record) => isWorldType(record.type)).map((record) => ({ record, home: null })),
    ...shared.filter((item) => isWorldType(item.record.type)).map((item) => ({ record: item.record, home: item.home })),
  ];
}

/**
 * The record when it belongs to this project, or a read-only series reference
 * from a sibling book. Null when neither matches. Does not authorize writes.
 */
export async function readRecordForProject(
  db: DbOrTx,
  projectId: string,
  recordId: string,
): Promise<{ record: RecordView; home: SeriesHomeRef | null } | SeriesSharedRecord | null> {
  try {
    return { record: await getRecord(db, projectId, recordId), home: null };
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }
  return getSeriesSharedRecord(db, projectId, recordId);
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

function snapshotDiffersFromRevision(
  current: RecordView,
  source: RevisionView,
  includeFields: boolean,
): boolean {
  if (current.title !== source.title || current.body !== source.body) return true;
  if (!includeFields) return false;
  return stableStringify(current.fields) !== stableStringify(source.fields);
}

/**
 * Writes an older revision's title and body (and optionally structured fields) as
 * a new revision. Canon status, protection, and superseded-by stay as they are now.
 */
export async function restoreRecordFromRevision(
  db: Db,
  projectId: string,
  input: {
    recordId: string;
    expectedRevision: number;
    fromRevisionNumber: number;
    includeFields?: boolean;
    unlockProtected?: boolean;
  },
): Promise<AppliedBatch> {
  const current = await getRecord(db, projectId, input.recordId);
  if (input.fromRevisionNumber < 1 || input.fromRevisionNumber > current.currentRevision) {
    throw new MutationRejectedError([
      errorIssue("INVALID_CHANGE", `Revision ${input.fromRevisionNumber} is not saved on this record.`, {
        recordId: input.recordId,
      }),
    ]);
  }
  if (input.fromRevisionNumber === current.currentRevision) {
    throw new MutationRejectedError([
      errorIssue("INVALID_CHANGE", "That is already the current saved version.", { recordId: input.recordId }),
    ]);
  }
  const source = await getRevision(db, input.recordId, input.fromRevisionNumber);
  if (!source) {
    throw new NotFoundError(`Revision ${input.fromRevisionNumber} not found on record ${input.recordId}`);
  }
  const includeFields = input.includeFields === true;
  if (!snapshotDiffersFromRevision(current, source, includeFields)) {
    throw new MutationRejectedError([
      errorIssue(
        "INVALID_CHANGE",
        includeFields
          ? "The current saved version already matches that revision's title, text, and structured fields."
          : "The current saved version already matches that revision's title and text. Tick include structured fields if you need those too.",
        { recordId: input.recordId },
      ),
    ]);
  }

  const changes: {
    title: string;
    body: string;
    fields?: { set: JsonObject; unset: string[] };
  } = { title: source.title, body: source.body };
  if (includeFields) {
    const unset = Object.keys(current.fields).filter((k) => !(k in source.fields));
    changes.fields = { set: source.fields, unset };
  }

  return applyMutations(
    db,
    {
      projectId,
      actor: UI_ACTOR,
      source: { kind: "restore", conversationLabel: `revision ${input.fromRevisionNumber}` },
      scope: "manuscript",
      protectedOverrides: new Set(input.unlockProtected ? [input.recordId] : []),
    },
    [
      {
        kind: "update_record",
        recordId: input.recordId,
        expectedRevision: input.expectedRevision,
        changes,
      },
    ],
    {
      action: "record.restore",
      summary: `Restored "${current.title}" from revision ${input.fromRevisionNumber}`,
    },
  );
}
