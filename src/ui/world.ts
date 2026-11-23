import { isRecordType, RECORD_TYPE_LABELS, type RecordType } from "@/domain/recordTypes";
import {
  getTaxonomyCategory,
  getTaxonomySubcategory,
  recordBelongsToCategory,
  recordBelongsToSubcategory,
  resolveRecordTaxonomy,
  WORLD_TAXONOMY_CATEGORIES,
  type TaxonomyCategoryId,
  type TaxonomyNavSummary,
} from "@/world/taxonomy";
import {
  isWorldbuildingKindFilter,
  WORLDBUILDING_KIND_OTHER,
  WORLDBUILDING_KIND_UNSET,
  worldKindCounts,
  type WorldbuildingKindFilter,
} from "@/world/worldKinds";
import { RECORD_GROUPS, type RecordNavEntry } from "./navigation";

/*
 * World document types (functional) and thematic taxonomy (discovery).
 * Optional `fields.kind` on Worldbuilding still drives structured templates.
 * Optional `fields.taxonomy` (and read-time legacy fallbacks) drive Hub categories.
 */

export type WorldType = (typeof RECORD_GROUPS.world)[number];

export const WORLD_CATEGORY_LABELS: Record<WorldType, string> = {
  character_dossier: "Characters",
  worldbuilding: "Worldbuilding",
  rules_glossary: "Rules & glossary",
  research_note: "Research notes",
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
  params: {
    type?: WorldType | null;
    q?: string | null;
    list?: boolean;
    kind?: WorldbuildingKindFilter | null;
    category?: string | null;
    subcategory?: string | null;
    customKind?: string | null;
    unclassified?: boolean;
    tag?: string | null;
    scope?: "book" | "series" | "unset" | null;
    status?: string | null;
    protected?: "yes" | "no" | null;
    sort?: "title" | "updated" | "created" | null;
    view?: "list" | "cards" | null;
  } = {},
): string {
  const search = new URLSearchParams();
  if (params.type) search.set("type", params.type);
  if (params.q?.trim()) search.set("q", params.q.trim());
  if (params.list) search.set("list", "1");
  if (params.kind) search.set("kind", params.kind);
  if (params.category) search.set("category", params.category);
  if (params.subcategory) search.set("subcategory", params.subcategory);
  if (params.customKind) search.set("customKind", params.customKind);
  if (params.unclassified) search.set("unclassified", "1");
  if (params.tag) search.set("tag", params.tag);
  if (params.scope) search.set("scope", params.scope);
  if (params.status) search.set("status", params.status);
  if (params.protected) search.set("protected", params.protected);
  if (params.sort && params.sort !== "updated") search.set("sort", params.sort);
  if (params.view && params.view !== "list") search.set("view", params.view);
  const qs = search.toString();
  return `/projects/${encodeURIComponent(projectId)}/world${qs ? `?${qs}` : ""}`;
}

export interface WorldTaxonomyCounts {
  byCategory: Record<string, number>;
  unclassified: number;
  customKinds: Record<string, number>;
}

/** Count each record under every thematic category it belongs to (no row duplication). */
export function worldTaxonomyCounts(
  records: readonly { type: string; fields?: Readonly<Record<string, unknown>>; taxonomy?: TaxonomyNavSummary | null }[],
): WorldTaxonomyCounts {
  const byCategory = Object.fromEntries(WORLD_TAXONOMY_CATEGORIES.map((c) => [c.id, 0])) as Record<string, number>;
  const customKinds: Record<string, number> = {};
  let unclassified = 0;
  for (const r of records) {
    if (!isRecordType(r.type) || !isWorldType(r.type)) continue;
    const summary =
      r.taxonomy ??
      (r.fields
        ? (() => {
            const resolved = resolveRecordTaxonomy({ type: r.type, fields: r.fields });
            return {
              primaryCategory: resolved.primary?.category ?? null,
              primarySubcategory: resolved.primary?.subcategory ?? null,
              secondaryCategories: resolved.secondary.map((item) => item.category),
              tags: resolved.tags,
              customKind: resolved.customKind,
              isUnclassified: resolved.isUnclassified,
              membershipKeys: resolved.memberships.map((item) => `${item.category}\0${item.subcategory ?? ""}`),
            } satisfies TaxonomyNavSummary;
          })()
        : null);
    if (!summary) continue;
    if (summary.isUnclassified) unclassified += 1;
    const categories = new Set<string>();
    if (summary.primaryCategory) categories.add(summary.primaryCategory);
    for (const category of summary.secondaryCategories) categories.add(category);
    for (const category of categories) {
      byCategory[category] = (byCategory[category] ?? 0) + 1;
    }
    if (summary.customKind) {
      customKinds[summary.customKind] = (customKinds[summary.customKind] ?? 0) + 1;
    }
  }
  return { byCategory, unclassified, customKinds };
}

/** Distinct custom `fields.kind` labels, sorted, for individual discovery (not a single Other bucket). */
export function listCustomWorldKinds(
  records: readonly { type: string; customKind?: string | null; taxonomy?: TaxonomyNavSummary | null }[],
): string[] {
  const names = new Set<string>();
  for (const r of records) {
    if (r.type !== "worldbuilding") continue;
    const kind = r.customKind ?? r.taxonomy?.customKind ?? null;
    if (kind) names.add(kind);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

export function filterWorldByTaxonomy(
  records: readonly RecordNavEntry[],
  options: {
    query?: string;
    type?: WorldType | null;
    category?: string | null;
    subcategory?: string | null;
    customKind?: string | null;
    unclassified?: boolean;
    tag?: string | null;
  } = {},
): RecordNavEntry[] {
  const needle = (options.query ?? "").normalize("NFC").trim().toLocaleLowerCase();
  const tagNeedle = options.tag?.normalize("NFC").trim().toLocaleLowerCase() ?? null;
  return records.filter((r) => {
    if (!isWorldType(r.type)) return false;
    if (options.type && r.type !== options.type) return false;
    if (needle && !r.title.normalize("NFC").toLocaleLowerCase().includes(needle)) return false;
    const summary = r.taxonomy;
    if (options.unclassified) return !!summary?.isUnclassified;
    if (options.customKind) {
      return (summary?.customKind ?? r.customKind) === options.customKind;
    }
    if (options.category) {
      if (!summary) return false;
      if (options.subcategory) {
        return (
          (summary.primaryCategory === options.category && summary.primarySubcategory === options.subcategory) ||
          summary.membershipKeys.includes(`${options.category}\0${options.subcategory}`)
        );
      }
      return (
        summary.primaryCategory === options.category ||
        summary.secondaryCategories.includes(options.category) ||
        summary.membershipKeys.some((key) => key.startsWith(`${options.category}\0`))
      );
    }
    if (tagNeedle) {
      return !!summary?.tags.some((tag) => tag.normalize("NFC").toLocaleLowerCase() === tagNeedle);
    }
    return true;
  });
}

export function taxonomyCategoryLabel(categoryId: string): string {
  return getTaxonomyCategory(categoryId)?.label ?? categoryId;
}

/** "Category / Subcategory" for one placement; custom slugs show as saved. */
export function taxonomyPlacementLabel(placement: { category: string; subcategory?: string | null }): string {
  const category = taxonomyCategoryLabel(placement.category);
  if (!placement.subcategory) return category;
  const sub = getTaxonomySubcategory(placement.category, placement.subcategory)?.label ?? placement.subcategory;
  return `${category} / ${sub}`;
}

export type { TaxonomyCategoryId, TaxonomyNavSummary };
export { recordBelongsToCategory, recordBelongsToSubcategory, WORLD_TAXONOMY_CATEGORIES };
