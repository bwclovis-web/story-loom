/**
 * Browser-safe World category discovery helpers for Maps, Boards, and
 * Relationship Explorer. Matches Hub primary + secondary membership rules.
 */

import type { WorldScope } from "@/domain/assignments";
import type { CustomTaxonomyCategoryOption } from "@/world/customCategories";
import {
  getTaxonomyCategory,
  getTaxonomySubcategory,
  type TaxonomyNavSummary,
} from "@/world/taxonomy";

function categoryLabel(
  categoryId: string,
  customCategories: readonly CustomTaxonomyCategoryOption[] = [],
): string {
  return (
    getTaxonomyCategory(categoryId)?.label ??
    customCategories.find((item) => item.slug === categoryId)?.label ??
    categoryId
  );
}

/** Sentinel category value for unclassified records in canvas filters. */
export const TAXONOMY_FILTER_UNCLASSIFIED = "__unclassified__";

export interface PlaceableRecord {
  id: string;
  title: string;
  typeLabel: string;
  homeLabel?: string | null;
  worldScope?: WorldScope | string | null;
  taxonomy?: TaxonomyNavSummary | null;
}

export interface TaxonomyFilterValue {
  category: string | null;
  subcategory: string | null;
}

export function emptyTaxonomyFilter(): TaxonomyFilterValue {
  return { category: null, subcategory: null };
}

export function taxonomyFilterActive(filter: TaxonomyFilterValue): boolean {
  return Boolean(filter.category);
}

/**
 * Match Hub rules: primary category/subcategory, secondary categories, and
 * membershipKeys (`category\0subcategory`). Unclassified uses the sentinel.
 */
export function recordMatchesTaxonomyFilter(
  taxonomy: TaxonomyNavSummary | null | undefined,
  filter: TaxonomyFilterValue,
): boolean {
  if (!filter.category) return true;
  if (filter.category === TAXONOMY_FILTER_UNCLASSIFIED) {
    return Boolean(taxonomy?.isUnclassified);
  }
  if (!taxonomy) return false;
  if (filter.subcategory) {
    const key = `${filter.category}\0${filter.subcategory}`;
    return (
      (taxonomy.primaryCategory === filter.category && taxonomy.primarySubcategory === filter.subcategory) ||
      taxonomy.membershipKeys.includes(key)
    );
  }
  return (
    taxonomy.primaryCategory === filter.category ||
    taxonomy.secondaryCategories.includes(filter.category) ||
    taxonomy.membershipKeys.some((key) => key.startsWith(`${filter.category}\0`))
  );
}

/** One result per Record.id; title search is case-insensitive NFC. */
export function filterPlaceableRecords(
  records: readonly PlaceableRecord[],
  options: { query?: string; category?: string | null; subcategory?: string | null } = {},
): PlaceableRecord[] {
  const needle = (options.query ?? "").normalize("NFC").trim().toLocaleLowerCase();
  const filter: TaxonomyFilterValue = {
    category: options.category ?? null,
    subcategory: options.subcategory ?? null,
  };
  const seen = new Set<string>();
  const out: PlaceableRecord[] = [];
  for (const record of records) {
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    if (needle && !record.title.normalize("NFC").toLocaleLowerCase().includes(needle)) continue;
    if (!recordMatchesTaxonomyFilter(record.taxonomy, filter)) continue;
    out.push(record);
  }
  return out;
}

export function filterMapPinsByTaxonomy<T extends { recordId: string | null; unavailable?: boolean }>(
  pins: readonly T[],
  filter: TaxonomyFilterValue,
  taxonomyByRecordId: ReadonlyMap<string, TaxonomyNavSummary | null | undefined>,
): { match: boolean; pin: T }[] {
  const active = taxonomyFilterActive(filter);
  return pins.map((pin) => {
    if (!active) return { match: true, pin };
    if (!pin.recordId || pin.unavailable) return { match: false, pin };
    return {
      match: recordMatchesTaxonomyFilter(taxonomyByRecordId.get(pin.recordId), filter),
      pin,
    };
  });
}

export function filterBoardCardsByTaxonomy<
  T extends { id: string; kind: string; recordId: string | null },
>(
  cards: readonly T[],
  filter: TaxonomyFilterValue,
  taxonomyByRecordId: ReadonlyMap<string, TaxonomyNavSummary | null | undefined>,
  kindFilter: "all" | "record" | "image" | "note" = "all",
): T[] {
  return cards.filter((card) => {
    if (kindFilter !== "all" && card.kind !== kindFilter) return false;
    if (!taxonomyFilterActive(filter)) return true;
    if (!card.recordId) return false;
    return recordMatchesTaxonomyFilter(taxonomyByRecordId.get(card.recordId), filter);
  });
}

export function taxonomyFilterSummaryLabel(
  filter: TaxonomyFilterValue,
  customCategories: readonly CustomTaxonomyCategoryOption[] = [],
): string | null {
  if (!filter.category) return null;
  if (filter.category === TAXONOMY_FILTER_UNCLASSIFIED) return "Uncategorized";
  const category = categoryLabel(filter.category, customCategories);
  if (!filter.subcategory) return category;
  const sub =
    getTaxonomySubcategory(filter.category, filter.subcategory)?.label ??
    customCategories.find((item) => item.slug === filter.subcategory)?.label ??
    filter.subcategory;
  return `${category} · ${sub}`;
}

export function subcategoryOptionsFor(
  category: string | null,
  customCategories: readonly CustomTaxonomyCategoryOption[] = [],
): Array<{ id: string; label: string }> {
  if (!category || category === TAXONOMY_FILTER_UNCLASSIFIED) return [];
  const builtIn = getTaxonomyCategory(category);
  const customs = customCategories.filter((item) => item.parentCategorySlug === category);
  const options: Array<{ id: string; label: string }> = [];
  if (builtIn) {
    for (const sub of builtIn.subcategories) options.push({ id: sub.id, label: sub.label });
  }
  for (const custom of customs) options.push({ id: custom.slug, label: custom.label });
  return options;
}

export type { TaxonomyNavSummary };
