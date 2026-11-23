/**
 * Client-safe shape for custom World Hub categories (WorldCategoryDefinition).
 * Built-in WORLD_TAXONOMY_CATEGORIES stay separate; these are author-defined
 * discovery categories / subcategories merged into TaxonomyFields and Hub nav.
 */

export interface CustomTaxonomyCategoryOption {
  slug: string;
  label: string;
  description?: string;
  parentCategorySlug: string | null;
  /** True when this definition lives in a sibling book (series-shared). */
  shared?: boolean;
  homeLabel?: string | null;
}

export function topLevelCustomCategories(
  customs: readonly CustomTaxonomyCategoryOption[],
): CustomTaxonomyCategoryOption[] {
  return customs.filter((item) => !item.parentCategorySlug);
}

export function customSubcategoriesOf(
  customs: readonly CustomTaxonomyCategoryOption[],
  parentSlug: string,
): CustomTaxonomyCategoryOption[] {
  return customs.filter((item) => item.parentCategorySlug === parentSlug);
}

export function customCategoryLabel(
  customs: readonly CustomTaxonomyCategoryOption[],
  slug: string,
): string | null {
  return customs.find((item) => item.slug === slug)?.label ?? null;
}
