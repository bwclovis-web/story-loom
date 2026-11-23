/**
 * World Hub ↔ SmartCollection (scope: world) filter bridge.
 * Stores stable Hub identifiers; evaluates via filterWorldHubRecords.
 */

import type { AuthorityStatus } from "@/domain/statuses";
import type { SmartCollectionFilter } from "@/domain/smartCollection";
import type { CustomTaxonomyCategoryOption } from "@/world/customCategories";
import {
  categoryLabelOrCustom,
  hubHasActiveFilters,
  type HubProtectedFilter,
  type HubScopeFilter,
  type HubSort,
  type HubView,
  type WorldHubQuery,
  type WorldHubRecord,
  discoverWorldHubRecords,
  filterWorldHubRecords,
} from "@/world/hubDiscovery";
import { getTaxonomySubcategory } from "@/world/taxonomy";
import { WORLD_CATEGORY_LABELS, type WorldType } from "@/ui/world";
import {
  isWorldbuildingKindFilter,
  WORLDBUILDING_KIND_OTHER,
  WORLDBUILDING_KIND_UNSET,
  type WorldbuildingKindFilter,
} from "@/world/worldKinds";
import { isWorldKindKey, referenceTemplate } from "@/world/referenceTemplates";
import { WORLD } from "@/ui/labels";

const HUB_SORTS: readonly HubSort[] = ["title", "updated", "created"];
const HUB_VIEWS: readonly HubView[] = ["list", "cards"];
const HUB_SCOPES: readonly HubScopeFilter[] = ["book", "series", "unset"];
const HUB_PROTECTED: readonly HubProtectedFilter[] = ["yes", "no"];

/** Discovery + presentation fields persisted for a world-scoped collection. */
export const WORLD_COLLECTION_SAVED_FIELDS = [
  "category",
  "subcategory",
  "tag",
  "customKind",
  "unclassified",
  "hubScope",
  "type",
  "kind",
  "query",
  "status",
  "protected",
  "sort",
  "view",
  "list",
] as const;

export type WorldCollectionSavedField = (typeof WORLD_COLLECTION_SAVED_FIELDS)[number];

/** Snapshot active Hub filters into a SmartCollectionFilter (scope: world). */
export function collectionFilterFromWorldHubQuery(query: WorldHubQuery): SmartCollectionFilter {
  const filter: SmartCollectionFilter = {};
  if (query.category) filter.category = query.category;
  if (query.subcategory) filter.subcategory = query.subcategory;
  if (query.tag) filter.tag = query.tag;
  if (query.customKind) filter.customKind = query.customKind;
  if (query.unclassified) filter.unclassified = true;
  if (query.scope) filter.hubScope = query.scope;
  if (query.type) filter.types = [query.type];
  if (query.kind) filter.kind = query.kind;
  if (query.q.trim()) filter.query = query.q.trim();
  if (query.status) filter.authorityStatuses = [query.status];
  if (query.protected === "yes") filter.protected = true;
  if (query.protected === "no") filter.protected = false;
  filter.sort = query.sort;
  filter.view = query.view;
  filter.list = true;
  return filter;
}

/** Restore a WorldHubQuery from a saved world collection filter. */
export function worldHubQueryFromCollectionFilter(filter: SmartCollectionFilter): WorldHubQuery {
  const type =
    filter.types?.find((t): t is WorldType => (WORLD_TYPES_SET as Set<string>).has(t)) ?? null;
  const kind =
    filter.kind && isWorldbuildingKindFilter(filter.kind)
      ? filter.kind
      : null;
  const status = filter.authorityStatuses?.[0] ?? null;
  let protectedFilter: HubProtectedFilter | null = null;
  if (filter.protected === true) protectedFilter = "yes";
  else if (filter.protected === false) protectedFilter = "no";
  const hubScope =
    filter.hubScope && (HUB_SCOPES as readonly string[]).includes(filter.hubScope)
      ? filter.hubScope
      : null;
  return {
    type,
    kind: type === "worldbuilding" || !type ? kind : null,
    q: filter.query?.trim() ?? "",
    list: filter.list !== false,
    category: filter.category ?? null,
    subcategory: filter.category && filter.subcategory ? filter.subcategory : null,
    tag: filter.tag ?? null,
    customKind: filter.customKind ?? null,
    unclassified: Boolean(filter.unclassified),
    scope: hubScope,
    status: status as AuthorityStatus | null,
    protected: protectedFilter,
    sort: filter.sort && (HUB_SORTS as readonly string[]).includes(filter.sort) ? filter.sort : "updated",
    view: filter.view && (HUB_VIEWS as readonly string[]).includes(filter.view) ? filter.view : "list",
  };
}

const WORLD_TYPES_SET = new Set([
  "character_dossier",
  "worldbuilding",
  "rules_glossary",
  "research_note",
  "canon_decision",
  "continuity_note",
  "reference_note",
]);

export function worldCollectionHasSavableFilters(query: WorldHubQuery): boolean {
  return hubHasActiveFilters({ ...query, list: true });
}

/**
 * Fields present in the Hub query that this version cannot persist.
 * Currently all Hub discovery + presentation fields are supported.
 */
export function unsupportedWorldCollectionFilters(_query: WorldHubQuery): string[] {
  return [];
}

export function summarizeWorldCollectionFilter(
  filter: SmartCollectionFilter,
  customCategories: readonly CustomTaxonomyCategoryOption[] = [],
): string {
  const parts: string[] = [];
  if (filter.unclassified) parts.push(WORLD.uncategorized);
  if (filter.category) {
    const category = categoryLabelOrCustom(filter.category, customCategories);
    if (filter.subcategory) {
      const sub =
        getTaxonomySubcategory(filter.category, filter.subcategory)?.label ??
        customCategories.find((item) => item.slug === filter.subcategory)?.label ??
        filter.subcategory;
      parts.push(`${category} · ${sub}`);
    } else {
      parts.push(category);
    }
  }
  if (filter.types?.length) {
    for (const type of filter.types) {
      if ((WORLD_TYPES_SET as Set<string>).has(type)) {
        parts.push(WORLD_CATEGORY_LABELS[type as WorldType] ?? type);
      }
    }
  }
  if (filter.kind) {
    if (filter.kind === WORLDBUILDING_KIND_UNSET) parts.push(WORLD.worldKindUnset);
    else if (filter.kind === WORLDBUILDING_KIND_OTHER) parts.push(WORLD.worldKindOther);
    else if (isWorldKindKey(filter.kind)) parts.push(referenceTemplate(filter.kind).label);
    else parts.push(filter.kind);
  }
  if (filter.tag) parts.push(`${WORLD.filterTag}: ${filter.tag}`);
  if (filter.customKind) parts.push(filter.customKind);
  if (filter.hubScope === "book") parts.push(WORLD.scopeBook);
  if (filter.hubScope === "series") parts.push(WORLD.scopeSeries);
  if (filter.hubScope === "unset") parts.push(WORLD.scopeUnset);
  if (filter.authorityStatuses?.length) {
    parts.push(`${WORLD.filterStatus}: ${filter.authorityStatuses.join(", ")}`);
  }
  if (filter.protected === true) parts.push(WORLD.protectedYes);
  if (filter.protected === false) parts.push(WORLD.protectedNo);
  if (filter.query) parts.push(`${WORLD.search}: ${filter.query}`);
  if (filter.sort && filter.sort !== "updated") {
    parts.push(
      filter.sort === "title" ? WORLD.sortTitle : filter.sort === "created" ? WORLD.sortCreated : WORLD.sortUpdated,
    );
  }
  if (filter.view === "cards") parts.push(WORLD.viewCards);
  return parts.length ? parts.join(" · ") : WORLD.allReferencesList;
}

/** Evaluate a world collection against the viewing book's Hub index (deduped by Record.id). */
export function applyWorldCollectionFilter(
  records: readonly WorldHubRecord[],
  filter: SmartCollectionFilter,
): WorldHubRecord[] {
  const query = worldHubQueryFromCollectionFilter(filter);
  return discoverWorldHubRecords(records, query);
}

export function filterWorldCollectionRecords(
  records: readonly WorldHubRecord[],
  filter: SmartCollectionFilter,
): WorldHubRecord[] {
  const query = worldHubQueryFromCollectionFilter(filter);
  return filterWorldHubRecords(records, query);
}

export function parseHubScopeFilter(value: unknown): HubScopeFilter | undefined {
  if (typeof value !== "string") return undefined;
  return (HUB_SCOPES as readonly string[]).includes(value) ? (value as HubScopeFilter) : undefined;
}

export function parseHubSort(value: unknown): HubSort | undefined {
  if (typeof value !== "string") return undefined;
  return (HUB_SORTS as readonly string[]).includes(value) ? (value as HubSort) : undefined;
}

export function parseHubView(value: unknown): HubView | undefined {
  if (typeof value !== "string") return undefined;
  return (HUB_VIEWS as readonly string[]).includes(value) ? (value as HubView) : undefined;
}

export function parseWorldKindFilter(value: unknown): WorldbuildingKindFilter | undefined {
  if (typeof value !== "string") return undefined;
  return isWorldbuildingKindFilter(value) ? value : undefined;
}

export { HUB_PROTECTED };
