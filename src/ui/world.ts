import { isRecordType, RECORD_TYPE_LABELS, type RecordType } from "@/domain/recordTypes";
import { RECORD_GROUPS, type RecordNavEntry } from "./navigation";

/*
 * World categories are exactly the World document types. There are no
 * separate place or magic types: those notes are Worldbuilding, and anything
 * that fits no other type is a Reference note.
 */

export type WorldType = (typeof RECORD_GROUPS.world)[number];

export const WORLD_CATEGORY_LABELS: Record<WorldType, string> = {
  character_dossier: "Characters",
  worldbuilding: "Worldbuilding",
  canon_decision: "Decisions",
  continuity_note: "Continuity notes",
  reference_note: "Reference notes",
};

export const WORLD_TYPES: readonly WorldType[] = RECORD_GROUPS.world;

export function isWorldType(value: string | null | undefined): value is WorldType {
  return !!value && (WORLD_TYPES as readonly string[]).includes(value);
}

/** Category label for a World type, or the type's own label for anything else. */
export function categoryLabel(type: RecordType): string {
  return isWorldType(type) ? WORLD_CATEGORY_LABELS[type] : RECORD_TYPE_LABELS[type];
}

export interface WorldCounts {
  all: number;
  byType: Record<WorldType, number>;
}

export function worldCounts(records: readonly { type: string }[]): WorldCounts {
  const byType = Object.fromEntries(WORLD_TYPES.map((t) => [t, 0])) as Record<WorldType, number>;
  let all = 0;
  for (const r of records) {
    if (isRecordType(r.type) && isWorldType(r.type)) {
      byType[r.type] += 1;
      all += 1;
    }
  }
  return { all, byType };
}

/** World records whose title contains the query (case-insensitive), optionally of one type, in the given order. */
export function filterWorldTitles(records: readonly RecordNavEntry[], query: string, type: WorldType | null): RecordNavEntry[] {
  const needle = query.normalize("NFC").trim().toLocaleLowerCase();
  return records.filter(
    (r) => isWorldType(r.type) && (!type || r.type === type) && (!needle || r.title.normalize("NFC").toLocaleLowerCase().includes(needle)),
  );
}

export function worldHref(projectId: string, params: { type?: WorldType | null; q?: string | null } = {}): string {
  const search = new URLSearchParams();
  if (params.type) search.set("type", params.type);
  if (params.q?.trim()) search.set("q", params.q.trim());
  const qs = search.toString();
  return `/projects/${encodeURIComponent(projectId)}/world${qs ? `?${qs}` : ""}`;
}
