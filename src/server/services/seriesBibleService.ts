import { toRecordView, type RecordView } from "@/domain/records";
import { isRecordType, type RecordType } from "@/domain/recordTypes";
import type { SeriesHomeRef } from "@/world/seriesHome";
import type { DbOrTx } from "../db";
import { listSeriesBookProjects } from "./projectService";

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
