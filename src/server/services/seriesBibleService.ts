import type { WorldScope } from "@/domain/assignments";
import type { JsonObject } from "@/domain/json";
import { toRecordView, type RecordView } from "@/domain/records";
import { isLinkableReferenceType, isRecordType, type RecordType } from "@/domain/recordTypes";
import { isAuthorityStatus, type AuthorityStatus } from "@/domain/statuses";
import { isWorldType } from "@/ui/world";
import { resolveRecordTaxonomy, type TaxonomyNavSummary, taxonomyNavSummary } from "@/world/taxonomy";
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
  "rules_glossary",
  "research_note",
  "canon_decision",
  "continuity_note",
  "reference_note",
] as const satisfies readonly RecordType[];

export interface SeriesSharedRecord {
  record: RecordView;
  home: SeriesHomeRef;
}

/**
 * A live local reference or an eligible series-shared sibling reference.
 * `getRecord` stays local-only; mutations on shared records go through
 * `updateSeriesSharedFromSibling` on the home project.
 */
export interface AvailableReference {
  record: RecordView;
  /** Null when the record belongs to the viewing project. */
  home: SeriesHomeRef | null;
  isShared: boolean;
  worldScope: WorldScope | null;
  taxonomy: TaxonomyNavSummary | null;
}

export interface ListAvailableReferencesOptions {
  /** When set, keep only these record types. */
  types?: readonly RecordType[];
  /** When true, only world-group types (and series-shared of those types). */
  worldOnly?: boolean;
  /** When true, only linkable reference types. */
  linkableOnly?: boolean;
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
  const books = await listSeriesBookProjects(db, viewingProjectId);
  const siblings = books.filter((book) => book.id !== viewingProjectId);
  if (!siblings.length) return null;
  const row = await db.record.findFirst({
    where: {
      id: recordId,
      projectId: { in: siblings.map((book) => book.id) },
      trashedAt: null,
      worldScope: "series",
      type: { in: [...SERIES_REFERENCE_TYPES] },
    },
  });
  if (!row || !isRecordType(row.type)) return null;
  const sibling = siblings.find((book) => book.id === row.projectId);
  if (!sibling) return null;
  return {
    record: toRecordView(row),
    home: { projectId: sibling.id, title: sibling.title, bookName: sibling.bookName },
  };
}

function taxonomyFor(record: RecordView): TaxonomyNavSummary | null {
  if (!isWorldType(record.type)) return null;
  return taxonomyNavSummary(resolveRecordTaxonomy({ type: record.type, fields: record.fields }));
}

function toAvailableLocal(record: RecordView): AvailableReference {
  return {
    record,
    home: null,
    isShared: false,
    worldScope: record.worldScope,
    taxonomy: taxonomyFor(record),
  };
}

function toAvailableShared(shared: SeriesSharedRecord): AvailableReference {
  return {
    record: shared.record,
    home: shared.home,
    isShared: true,
    worldScope: shared.record.worldScope,
    taxonomy: taxonomyFor(shared.record),
  };
}

function passesAvailableFilters(entry: AvailableReference, options?: ListAvailableReferencesOptions): boolean {
  const type = entry.record.type;
  if (options?.types && !options.types.includes(type)) return false;
  if (options?.worldOnly && !isWorldType(type)) return false;
  if (options?.linkableOnly && !isLinkableReferenceType(type)) return false;
  return true;
}

/**
 * Resolves a live local record or an eligible live sibling `worldScope = series`
 * record in the same workspace and non-empty series. Rejects trashed, non-series,
 * unrelated series/projects, and cross-workspace records.
 */
export async function resolveAvailableReference(
  db: DbOrTx,
  viewingProjectId: string,
  recordId: string,
): Promise<AvailableReference | null> {
  const local = await db.record.findFirst({
    where: { id: recordId, projectId: viewingProjectId, trashedAt: null },
  });
  if (local && isRecordType(local.type)) {
    return toAvailableLocal(toRecordView(local));
  }
  const shared = await getSeriesSharedRecord(db, viewingProjectId, recordId);
  return shared ? toAvailableShared(shared) : null;
}

/**
 * Local linkable/world records plus eligible sibling series-shared entries,
 * with home, worldScope, and taxonomy for pickers and discovery.
 */
export async function listAvailableReferences(
  db: DbOrTx,
  viewingProjectId: string,
  options?: ListAvailableReferencesOptions,
): Promise<AvailableReference[]> {
  const localRows = await db.record.findMany({
    where: { projectId: viewingProjectId, trashedAt: null },
    orderBy: [{ title: "asc" }, { id: "asc" }],
  });
  const local = localRows.flatMap((row) => {
    if (!isRecordType(row.type)) return [];
    const entry = toAvailableLocal(toRecordView(row));
    return passesAvailableFilters(entry, options) ? [entry] : [];
  });
  const seen = new Set(local.map((entry) => entry.record.id));
  const shared = await listSeriesSharedRecords(db, viewingProjectId);
  const fromSeries = shared.flatMap((item) => {
    if (seen.has(item.record.id)) return [];
    const entry = toAvailableShared(item);
    return passesAvailableFilters(entry, options) ? [entry] : [];
  });
  return [...local, ...fromSeries];
}

/**
 * True when a previously linked record id is no longer available from this book
 * (trashed, unshared, left the series, or never existed). Used for pin/card badges.
 */
export async function isAvailableReferenceUnavailable(
  db: DbOrTx,
  viewingProjectId: string,
  recordId: string | null | undefined,
): Promise<boolean> {
  if (!recordId) return false;
  const resolved = await resolveAvailableReference(db, viewingProjectId, recordId);
  return !resolved;
}

/**
 * Loads a record row that may be local or series-shared, including soft-trashed
 * rows for unavailable-state display. Returns null when the id is unknown or
 * not in this series/workspace.
 */
export async function loadPinnedReferenceState(
  db: DbOrTx,
  viewingProjectId: string,
  recordId: string,
): Promise<{
  record: RecordView | null;
  home: SeriesHomeRef | null;
  worldScope: WorldScope | null;
  unavailable: boolean;
}> {
  const available = await resolveAvailableReference(db, viewingProjectId, recordId);
  if (available) {
    return {
      record: available.record,
      home: available.home,
      worldScope: available.worldScope,
      unavailable: false,
    };
  }
  const books = await listSeriesBookProjects(db, viewingProjectId);
  const seriesIds = books.length ? books.map((b) => b.id) : [viewingProjectId];
  const row = await db.record.findFirst({
    where: { id: recordId, projectId: { in: seriesIds } },
  });
  if (!row || !isRecordType(row.type)) {
    return { record: null, home: null, worldScope: null, unavailable: true };
  }
  const view = toRecordView(row);
  let home: SeriesHomeRef | null = null;
  if (row.projectId !== viewingProjectId) {
    const book = books.find((b) => b.id === row.projectId);
    home = book ? { projectId: book.id, title: book.title, bookName: book.bookName } : null;
  }
  return {
    record: view,
    home,
    worldScope: view.worldScope,
    unavailable: true,
  };
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
