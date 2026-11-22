import type { JsonObject } from "@/domain/json";
import { toRecordView, type RecordView } from "@/domain/records";
import { isRecordType, type RecordType } from "@/domain/recordTypes";
import { isAuthorityStatus, type AuthorityStatus } from "@/domain/statuses";
import type { SeriesHomeRef } from "@/world/seriesHome";
import type { Db, DbOrTx } from "../db";
import { NotFoundError } from "./errors";
import { applyMutations, type AppliedBatch, type MutationContext } from "./mutationService";
import { listSeriesBookProjects } from "./projectService";

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

/** Reference types a series scope is allowed to share. Manuscripts stay in their book. */
export const SERIES_REFERENCE_TYPES = [
  "character_dossier",
  "worldbuilding",
  "canon_decision",
  "continuity_note",
  "reference_note",
] as const satisfies readonly RecordType[];

export interface SeriesSharedRecord {
  record: RecordView;
  home: SeriesHomeRef;
}

/**
 * Series-scoped references that live in a sibling book of the same series.
 * The viewing book can read them. `getRecord` still refuses them, so saves
 * and links cannot target another book by swapping the route id.
 */
export async function listSeriesSharedRecords(db: DbOrTx, viewingProjectId: string): Promise<SeriesSharedRecord[]> {
  const books = await listSeriesBookProjects(db, viewingProjectId);
  const siblings = books.filter((book) => book.id !== viewingProjectId);
  if (!siblings.length) return [];
  const homes = new Map(siblings.map((book) => [book.id, { projectId: book.id, title: book.title, bookName: book.bookName }]));
  const rows = await db.record.findMany({
    where: {
      projectId: { in: siblings.map((book) => book.id) },
      trashedAt: null,
      worldScope: "series",
      type: { in: [...SERIES_REFERENCE_TYPES] },
    },
    orderBy: [{ title: "asc" }, { id: "asc" }],
  });
  return rows.flatMap((row) => {
    if (!isRecordType(row.type)) return [];
    const home = homes.get(row.projectId);
    if (!home) return [];
    return [{ record: toRecordView(row), home }];
  });
}

export async function getSeriesSharedRecord(
  db: DbOrTx,
  viewingProjectId: string,
  recordId: string,
): Promise<SeriesSharedRecord | null> {
  const rows = await listSeriesSharedRecords(db, viewingProjectId);
  return rows.find((row) => row.record.id === recordId) ?? null;
}

/** Home book for a series-shared reference visible from a sibling book. */
export function seriesRecordOwningProjectId(shared: SeriesSharedRecord): string {
  return shared.home.projectId;
}

/**
 * A series-scoped reference opened from another book in the same series.
 * Throws when the record is not shared into this book.
 */
export async function requireSeriesSharedFromSibling(
  db: DbOrTx,
  viewingProjectId: string,
  recordId: string,
): Promise<SeriesSharedRecord> {
  const shared = await getSeriesSharedRecord(db, viewingProjectId, recordId);
  if (!shared) {
    throw new NotFoundError(`Record ${recordId} is not a series-shared reference in this book.`);
  }
  return shared;
}

/**
 * Author edit from a sibling book. Mutations run in the owning project so
 * inProject checks and protection stay on the home record.
 */
export async function updateSeriesSharedFromSibling(
  db: Db,
  viewingProjectId: string,
  input: {
    recordId: string;
    expectedRevision: number;
    title?: string;
    body?: string;
    fields?: JsonObject;
    authorityStatus?: AuthorityStatus;
    unlockProtected?: boolean;
  },
): Promise<AppliedBatch> {
  const shared = await requireSeriesSharedFromSibling(db, viewingProjectId, input.recordId);
  const owningProjectId = shared.home.projectId;
  const row = await db.record.findFirst({
    where: { id: input.recordId, projectId: owningProjectId, trashedAt: null },
  });
  if (!row) throw new NotFoundError(`Record ${input.recordId} not found in its home book.`);
  const current = toRecordView(row);
  let fieldChanges: { set: JsonObject; unset: string[] } | undefined;
  if (input.fields) {
    const unset = Object.keys(current.fields).filter((k) => !(k in input.fields!));
    fieldChanges = { set: input.fields, unset };
  }
  const homeLabel = shared.home.bookName?.trim() || shared.home.title;
  return applyMutations(
    db,
    uiContext(owningProjectId, input.unlockProtected ? [input.recordId] : []),
    [
      {
        kind: "update_record",
        recordId: input.recordId,
        expectedRevision: input.expectedRevision,
        changes: { title: input.title, body: input.body, fields: fieldChanges },
        authorityStatus: input.authorityStatus,
      },
    ],
    {
      action: "record.update",
      summary: `Edited series-shared "${input.title ?? current.title}" from sibling book (saved in ${homeLabel})`,
    },
  );
}

export async function updateSeriesSharedFromSiblingParsed(
  db: Db,
  viewingProjectId: string,
  input: {
    recordId: string;
    expectedRevision: number;
    title: string;
    body: string;
    fields?: JsonObject;
    authorityStatus?: string;
    unlockProtected?: boolean;
  },
): Promise<AppliedBatch> {
  return updateSeriesSharedFromSibling(db, viewingProjectId, {
    recordId: input.recordId,
    expectedRevision: input.expectedRevision,
    title: input.title,
    body: input.body,
    fields: input.fields,
    authorityStatus: input.authorityStatus && isAuthorityStatus(input.authorityStatus) ? input.authorityStatus : undefined,
    unlockProtected: input.unlockProtected,
  });
}
