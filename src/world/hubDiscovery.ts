import type { WorldScope } from "@/domain/assignments";
import type { AuthorityStatus } from "@/domain/statuses";
import type { RecordType } from "@/domain/recordTypes";
import { isAuthorityStatus } from "@/domain/statuses";
import {
  isWorldType,
  isWorldbuildingKindFilter,
  type WorldType,
  type WorldbuildingKindFilter,
  WORLD_TYPES,
} from "@/ui/world";
import type { SeriesHomeRef } from "@/world/seriesHome";
import { isWorldKindKey, type WorldKindKey } from "@/world/referenceTemplates";
import type { CustomTaxonomyCategoryOption } from "@/world/customCategories";
import {
  getTaxonomyCategory,
  LEGACY_KIND_TO_CATEGORY,
  resolveRecordTaxonomy,
  taxonomyNavSummary,
  WORLD_TAXONOMY_CATEGORIES,
  type TaxonomyNavSummary,
} from "@/world/taxonomy";

/** Reverse map: taxonomy category → suggested built-in `fields.kind` (optional template). */
export const CATEGORY_TO_LEGACY_KIND: Partial<Record<string, WorldKindKey>> = Object.fromEntries(
  (Object.entries(LEGACY_KIND_TO_CATEGORY) as [WorldKindKey, string][]).map(([kind, category]) => [category, kind]),
);

export type HubSort = "title" | "updated" | "created";
export type HubView = "list" | "cards";
export type HubScopeFilter = WorldScope | "unset";
export type HubProtectedFilter = "yes" | "no";

export interface WorldHubQuery {
  type: WorldType | null;
  kind: WorldbuildingKindFilter | null;
  q: string;
  list: boolean;
  category: string | null;
  subcategory: string | null;
  tag: string | null;
  customKind: string | null;
  unclassified: boolean;
  scope: HubScopeFilter | null;
  status: AuthorityStatus | null;
  protected: HubProtectedFilter | null;
  sort: HubSort;
  view: HubView;
}

export interface WorldHubRecord {
  id: string;
  title: string;
  type: RecordType;
  authorityStatus: AuthorityStatus;
  protected: boolean;
  currentRevision: number;
  worldScope: WorldScope | null;
  createdAt: string;
  updatedAt: string;
  fields: Readonly<Record<string, unknown>>;
  taxonomy: TaxonomyNavSummary;
  home: SeriesHomeRef | null;
  worldKind: string | null;
  customKind: string | null;
}

const SORTS: readonly HubSort[] = ["title", "updated", "created"];
const VIEWS: readonly HubView[] = ["list", "cards"];
const SCOPES: readonly HubScopeFilter[] = ["book", "series", "unset"];
const PROTECTED: readonly HubProtectedFilter[] = ["yes", "no"];

function oneOf<T extends string>(value: string | null | undefined, allowed: readonly T[]): T | null {
  if (!value) return null;
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/** Parse World Hub search params. Legacy `type` / `kind` / `q` / `list` stay valid. */
export function parseWorldHubQuery(input: Record<string, string | undefined>): WorldHubQuery {
  const type = isWorldType(input.type) ? input.type : null;
  const kind =
    type === "worldbuilding" && isWorldbuildingKindFilter(input.kind) ? input.kind : isWorldbuildingKindFilter(input.kind) ? input.kind : null;
  const categoryRaw = input.category?.trim() || null;
  const category = categoryRaw || null;
  const subcategory = input.subcategory?.trim() || null;
  return {
    type,
    kind: type === "worldbuilding" || !type ? kind : null,
    q: (input.q ?? "").trim(),
    list: input.list === "1",
    category,
    subcategory: category && subcategory ? subcategory : null,
    tag: input.tag?.trim() || null,
    customKind: input.customKind?.trim() || null,
    unclassified: input.unclassified === "1",
    scope: oneOf(input.scope, SCOPES),
    status: isAuthorityStatus(input.status ?? "") ? (input.status as AuthorityStatus) : null,
    protected: oneOf(input.protected, PROTECTED),
    sort: oneOf(input.sort, SORTS) ?? "updated",
    view: oneOf(input.view, VIEWS) ?? "list",
  };
}

export function worldHubHref(
  projectId: string,
  params: Partial<WorldHubQuery> & { list?: boolean } = {},
): string {
  const search = new URLSearchParams();
  if (params.type) search.set("type", params.type);
  if (params.kind) search.set("kind", params.kind);
  if (params.q?.trim()) search.set("q", params.q.trim());
  if (params.list) search.set("list", "1");
  if (params.category) search.set("category", params.category);
  if (params.subcategory) search.set("subcategory", params.subcategory);
  if (params.tag) search.set("tag", params.tag);
  if (params.customKind) search.set("customKind", params.customKind);
  if (params.unclassified) search.set("unclassified", "1");
  if (params.scope) search.set("scope", params.scope);
  if (params.status) search.set("status", params.status);
  if (params.protected) search.set("protected", params.protected);
  if (params.sort && params.sort !== "updated") search.set("sort", params.sort);
  if (params.view && params.view !== "list") search.set("view", params.view);
  const qs = search.toString();
  return `/projects/${encodeURIComponent(projectId)}/world${qs ? `?${qs}` : ""}`;
}

export function projectWorldHubRecord(input: {
  id: string;
  title: string;
  type: RecordType;
  authorityStatus: AuthorityStatus;
  protected: boolean;
  currentRevision: number;
  worldScope: WorldScope | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  fields: Readonly<Record<string, unknown>>;
  home?: SeriesHomeRef | null;
}): WorldHubRecord {
  const resolved = resolveRecordTaxonomy({ type: input.type, fields: input.fields });
  const summary = taxonomyNavSummary(resolved);
  return {
    id: input.id,
    title: input.title,
    type: input.type,
    authorityStatus: input.authorityStatus,
    protected: input.protected,
    currentRevision: input.currentRevision,
    worldScope: input.worldScope,
    createdAt: typeof input.createdAt === "string" ? input.createdAt : input.createdAt.toISOString(),
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : input.updatedAt.toISOString(),
    fields: input.fields,
    taxonomy: summary,
    home: input.home ?? null,
    worldKind: resolved.usedLegacyFallback && resolved.primary
      ? CATEGORY_TO_LEGACY_KIND[resolved.primary.category] ?? null
      : typeof input.fields.kind === "string" && isWorldKindKey(input.fields.kind)
        ? input.fields.kind
        : null,
    customKind: summary.customKind,
  };
}

function matchesLegacyKind(record: WorldHubRecord, kind: WorldbuildingKindFilter): boolean {
  if (record.type !== "worldbuilding") return false;
  if (kind === "__none") return !record.worldKind && !record.customKind;
  if (kind === "__other") return !!record.customKind;
  return record.worldKind === kind;
}

/**
 * Filter World Hub records. Each matching record appears once even with
 * multiple category memberships.
 */
export function filterWorldHubRecords(records: readonly WorldHubRecord[], query: WorldHubQuery): WorldHubRecord[] {
  const needle = query.q.normalize("NFC").trim().toLocaleLowerCase();
  const tagNeedle = query.tag?.normalize("NFC").trim().toLocaleLowerCase() ?? null;
  return records.filter((record) => {
    if (!isWorldType(record.type)) return false;
    if (query.type && record.type !== query.type) return false;
    if (needle && !record.title.normalize("NFC").toLocaleLowerCase().includes(needle)) return false;
    if (query.kind && !matchesLegacyKind(record, query.kind)) return false;
    if (query.unclassified && !record.taxonomy.isUnclassified) return false;
    if (query.customKind && record.customKind !== query.customKind) return false;
    if (query.category) {
      const summary = record.taxonomy;
      if (query.subcategory) {
        const key = `${query.category}\0${query.subcategory}`;
        if (
          !(summary.primaryCategory === query.category && summary.primarySubcategory === query.subcategory) &&
          !summary.membershipKeys.includes(key)
        ) {
          return false;
        }
      } else if (
        summary.primaryCategory !== query.category &&
        !summary.secondaryCategories.includes(query.category) &&
        !summary.membershipKeys.some((key) => key.startsWith(`${query.category}\0`))
      ) {
        return false;
      }
    }
    if (tagNeedle && !record.taxonomy.tags.some((tag) => tag.normalize("NFC").toLocaleLowerCase() === tagNeedle)) {
      return false;
    }
    if (query.scope === "unset" && record.worldScope !== null) return false;
    if (query.scope === "book" && record.worldScope !== "book") return false;
    if (query.scope === "series" && record.worldScope !== "series") return false;
    if (query.status && record.authorityStatus !== query.status) return false;
    if (query.protected === "yes" && !record.protected) return false;
    if (query.protected === "no" && record.protected) return false;
    return true;
  });
}

export function sortWorldHubRecords(records: readonly WorldHubRecord[], sort: HubSort): WorldHubRecord[] {
  const next = [...records];
  next.sort((a, b) => {
    if (sort === "title") {
      const byTitle = a.title.localeCompare(b.title);
      return byTitle || a.id.localeCompare(b.id);
    }
    if (sort === "created") {
      const byCreated = b.createdAt.localeCompare(a.createdAt);
      return byCreated || a.title.localeCompare(b.title);
    }
    const byUpdated = b.updatedAt.localeCompare(a.updatedAt);
    return byUpdated || a.title.localeCompare(b.title);
  });
  return next;
}

export function discoverWorldHubRecords(
  records: readonly WorldHubRecord[],
  query: WorldHubQuery,
): WorldHubRecord[] {
  return sortWorldHubRecords(filterWorldHubRecords(records, query), query.sort);
}

export function hubHasActiveFilters(query: WorldHubQuery): boolean {
  return Boolean(
    query.type ||
      query.kind ||
      query.q ||
      query.list ||
      query.category ||
      query.subcategory ||
      query.tag ||
      query.customKind ||
      query.unclassified ||
      query.scope ||
      query.status ||
      query.protected,
  );
}

export function defaultRecordTypeForCategory(category: string | null): WorldType {
  if (category === "characters") return "character_dossier";
  return "worldbuilding";
}

export function suggestedKindForCategory(category: string | null): WorldKindKey | null {
  if (!category) return null;
  return CATEGORY_TO_LEGACY_KIND[category] ?? null;
}

export function listHubTags(records: readonly WorldHubRecord[]): string[] {
  const tags = new Set<string>();
  for (const record of records) {
    for (const tag of record.taxonomy.tags) tags.add(tag);
  }
  return [...tags].sort((a, b) => a.localeCompare(b));
}

export function categoryBrowseCounts(
  records: readonly WorldHubRecord[],
  customCategories: readonly CustomTaxonomyCategoryOption[] = [],
): {
  byCategory: Record<string, number>;
  bySubcategory: Record<string, Record<string, number>>;
  unclassified: number;
  customKinds: Record<string, number>;
  tags: Record<string, number>;
  all: number;
} {
  const byCategory = Object.fromEntries(WORLD_TAXONOMY_CATEGORIES.map((c) => [c.id, 0])) as Record<string, number>;
  const bySubcategory: Record<string, Record<string, number>> = {};
  for (const category of WORLD_TAXONOMY_CATEGORIES) {
    bySubcategory[category.id] = Object.fromEntries(category.subcategories.map((s) => [s.id, 0]));
  }
  for (const custom of customCategories) {
    if (!custom.parentCategorySlug) {
      byCategory[custom.slug] = byCategory[custom.slug] ?? 0;
      bySubcategory[custom.slug] = bySubcategory[custom.slug] ?? {};
    } else {
      bySubcategory[custom.parentCategorySlug] = bySubcategory[custom.parentCategorySlug] ?? {};
      bySubcategory[custom.parentCategorySlug]![custom.slug] =
        bySubcategory[custom.parentCategorySlug]![custom.slug] ?? 0;
    }
  }
  const customKinds: Record<string, number> = {};
  const tags: Record<string, number> = {};
  let unclassified = 0;
  for (const record of records) {
    if (record.taxonomy.isUnclassified) unclassified += 1;
    const categories = new Set<string>();
    if (record.taxonomy.primaryCategory) categories.add(record.taxonomy.primaryCategory);
    for (const category of record.taxonomy.secondaryCategories) categories.add(category);
    for (const category of categories) {
      byCategory[category] = (byCategory[category] ?? 0) + 1;
    }
    for (const key of record.taxonomy.membershipKeys) {
      const [category, subcategory] = key.split("\0");
      if (category && subcategory) {
        bySubcategory[category] = bySubcategory[category] ?? {};
        bySubcategory[category]![subcategory] = (bySubcategory[category]![subcategory] ?? 0) + 1;
      }
    }
    if (record.customKind) customKinds[record.customKind] = (customKinds[record.customKind] ?? 0) + 1;
    for (const tag of record.taxonomy.tags) tags[tag] = (tags[tag] ?? 0) + 1;
  }
  return { byCategory, bySubcategory, unclassified, customKinds, tags, all: records.length };
}

export function categoryLabelOrCustom(
  categoryId: string,
  customCategories: readonly CustomTaxonomyCategoryOption[] = [],
): string {
  return (
    getTaxonomyCategory(categoryId)?.label ??
    customCategories.find((item) => item.slug === categoryId)?.label ??
    categoryId
  );
}

export { WORLD_TYPES, WORLD_TAXONOMY_CATEGORIES };
