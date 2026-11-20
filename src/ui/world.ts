import { isRecordType, RECORD_TYPE_LABELS, type RecordType } from "@/domain/recordTypes";
import {
  isWorldbuildingKindFilter,
  WORLDBUILDING_KIND_OTHER,
  WORLDBUILDING_KIND_UNSET,
  worldKindCounts,
  type WorldbuildingKindFilter,
} from "@/world/worldKinds";
import { RECORD_GROUPS, type RecordNavEntry } from "./navigation";

/*
 * World categories are the five World document types. Optional `fields.kind` on
 * Worldbuilding records sub-groups places, magic, and the other outline kinds
 * in navigation without new record types.
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

export {
  worldKindCounts,
  WORLDBUILDING_KIND_OTHER,
  WORLDBUILDING_KIND_UNSET,
  type WorldbuildingKindFilter,
  isWorldbuildingKindFilter,
};

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

/** World records whose title contains the query (case-insensitive), optionally of one type and Worldbuilding kind. */
export function filterWorldTitles(
  records: readonly RecordNavEntry[],
  query: string,
  type: WorldType | null,
  worldKind: WorldbuildingKindFilter | null = null,
): RecordNavEntry[] {
  const needle = query.normalize("NFC").trim().toLocaleLowerCase();
  return records.filter((r) => {
    if (!isWorldType(r.type)) return false;
    if (type && r.type !== type) return false;
    if (needle && !r.title.normalize("NFC").toLocaleLowerCase().includes(needle)) return false;
    if (worldKind && r.type === "worldbuilding") {
      if (worldKind === WORLDBUILDING_KIND_UNSET) return !r.worldKind && !r.customKind;
      if (worldKind === WORLDBUILDING_KIND_OTHER) return !!r.customKind;
      return r.worldKind === worldKind;
    }
    return true;
  });
}

export function worldHref(
  projectId: string,
  params: { type?: WorldType | null; q?: string | null; list?: boolean; kind?: WorldbuildingKindFilter | null } = {},
): string {
  const search = new URLSearchParams();
  if (params.type) search.set("type", params.type);
  if (params.q?.trim()) search.set("q", params.q.trim());
  if (params.list) search.set("list", "1");
  if (params.kind) search.set("kind", params.kind);
  const qs = search.toString();
  return `/projects/${encodeURIComponent(projectId)}/world${qs ? `?${qs}` : ""}`;
}
