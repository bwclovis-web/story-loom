import Link from "next/link";
import { TaxonomyCategoryIcon } from "@/components/world/TaxonomyCategoryIcon";
import { WORLD, WORLD_CATEGORY } from "@/ui/labels";
import { worldHref } from "@/ui/world";
import {
  customSubcategoriesOf,
  topLevelCustomCategories,
  type CustomTaxonomyCategoryOption,
} from "@/world/customCategories";
import { WORLD_TAXONOMY_CATEGORIES } from "@/world/taxonomy";

/**
 * Compact category index for the World Hub. Counts include secondary memberships.
 * Empty categories stay muted; creation links stay available. Custom
 * WorldCategoryDefinition rows appear alongside the 14 built-ins.
 */
export function WorldCategoryNav({
  projectId,
  counts,
  subcategoryCounts,
  customKinds,
  tagCounts,
  unclassified,
  currentCategory,
  currentSubcategory,
  currentCustomKind,
  currentTag,
  unclassifiedSelected,
  allSelected,
  customCategories = [],
  collectionId = null,
}: {
  projectId: string;
  counts: Record<string, number>;
  subcategoryCounts: Record<string, Record<string, number>>;
  customKinds: Record<string, number>;
  tagCounts: Record<string, number>;
  unclassified: number;
  currentCategory: string | null;
  currentSubcategory: string | null;
  currentCustomKind: string | null;
  currentTag: string | null;
  unclassifiedSelected: boolean;
  allSelected: boolean;
  customCategories?: readonly CustomTaxonomyCategoryOption[];
  /** Keep an open World collection while browsing categories. */
  collectionId?: string | null;
}) {
  const customEntries = Object.entries(customKinds).sort(([a], [b]) => a.localeCompare(b));
  const tagEntries = Object.entries(tagCounts).sort(([a], [b]) => a.localeCompare(b));
  const topLevelCustoms = topLevelCustomCategories(customCategories);
  const withCollection = (params: Parameters<typeof worldHref>[1] = {}) =>
    worldHref(projectId, { ...params, collection: collectionId });

  return (
    <nav className="world-category-nav" aria-label={WORLD.browseCategories}>
      <ul className="world-filter-list">
        <li>
          <Link href={withCollection({ list: true })} aria-current={allSelected ? "page" : undefined}>
            {WORLD.allReferences}
          </Link>
        </li>
      </ul>
      <ul className="world-category-list">
        {WORLD_TAXONOMY_CATEGORIES.map((category) => {
          const count = counts[category.id] ?? 0;
          const selected = currentCategory === category.id;
          const subs = subcategoryCounts[category.id] ?? {};
          const customSubs = customSubcategoriesOf(customCategories, category.id);
          return (
            <li key={category.id} className={count === 0 ? "world-category-empty" : undefined}>
              <details open={selected || undefined}>
                <summary className="world-category-summary">
                  <Link
                    href={withCollection({ category: category.id })}
                    className="world-category-link"
                    aria-current={selected && !currentSubcategory ? "page" : undefined}
                    title={category.description}
                  >
                    <TaxonomyCategoryIcon categoryId={category.id} />
                    <span>{category.label}</span>
                    <span className="nav-count">{count}</span>
                  </Link>
                </summary>
                <ul className="world-filter-list world-subcategory-list">
                  {category.subcategories.map((sub) => (
                    <li key={sub.id}>
                      <Link
                        href={withCollection({ category: category.id, subcategory: sub.id })}
                        aria-current={selected && currentSubcategory === sub.id ? "page" : undefined}
                        title={sub.description}
                      >
                        {sub.label}
                        <span className="nav-count">{subs[sub.id] ?? 0}</span>
                      </Link>
                    </li>
                  ))}
                  {customSubs.map((sub) => (
                    <li key={sub.slug}>
                      <Link
                        href={withCollection({ category: category.id, subcategory: sub.slug })}
                        aria-current={selected && currentSubcategory === sub.slug ? "page" : undefined}
                        title={sub.description}
                      >
                        {sub.label}
                        <span className="nav-count">{subs[sub.slug] ?? 0}</span>
                      </Link>
                    </li>
                  ))}
                  <li>
                    <Link
                      href={`${worldHref(projectId)}/new?category=${encodeURIComponent(category.id)}`}
                      className="world-category-create"
                    >
                      {WORLD.newInCategory(category.label)}
                    </Link>
                  </li>
                </ul>
              </details>
            </li>
          );
        })}
        {topLevelCustoms.map((category) => {
          const count = counts[category.slug] ?? 0;
          const selected = currentCategory === category.slug;
          const subs = subcategoryCounts[category.slug] ?? {};
          const children = customSubcategoriesOf(customCategories, category.slug);
          return (
            <li key={category.slug} className={count === 0 ? "world-category-empty" : undefined}>
              <details open={selected || undefined}>
                <summary className="world-category-summary">
                  <Link
                    href={withCollection({ category: category.slug })}
                    className="world-category-link"
                    aria-current={selected && !currentSubcategory ? "page" : undefined}
                    title={category.description}
                  >
                    <span>{category.label}</span>
                    <span className="nav-count">{count}</span>
                  </Link>
                </summary>
                <ul className="world-filter-list world-subcategory-list">
                  {children.map((sub) => (
                    <li key={sub.slug}>
                      <Link
                        href={withCollection({ category: category.slug, subcategory: sub.slug })}
                        aria-current={selected && currentSubcategory === sub.slug ? "page" : undefined}
                        title={sub.description}
                      >
                        {sub.label}
                        <span className="nav-count">{subs[sub.slug] ?? 0}</span>
                      </Link>
                    </li>
                  ))}
                  <li>
                    <Link
                      href={`${worldHref(projectId)}/new?category=${encodeURIComponent(category.slug)}`}
                      className="world-category-create"
                    >
                      {WORLD.newInCategory(category.label)}
                    </Link>
                  </li>
                </ul>
              </details>
            </li>
          );
        })}
      </ul>
      <p className="small muted world-filter-note">{WORLD.hubTaxonomyNote}</p>
      {topLevelCustoms.length === 0 && customCategories.length === 0 ? (
        <p className="small muted">{WORLD_CATEGORY.empty}</p>
      ) : null}
      <h3 className="world-category-aside-heading">{WORLD.uncategorized}</h3>
      <ul className="world-filter-list">
        <li>
          <Link
            href={withCollection({ unclassified: true })}
            aria-current={unclassifiedSelected ? "page" : undefined}
          >
            {WORLD.uncategorized}
            <span className="nav-count">{unclassified}</span>
          </Link>
        </li>
      </ul>
      {customEntries.length ? (
        <>
          <h3 className="world-category-aside-heading">{WORLD.customKindsHeading}</h3>
          <ul className="world-filter-list">
            {customEntries.map(([kind, count]) => (
              <li key={kind}>
                <Link
                  href={withCollection({ customKind: kind })}
                  aria-current={currentCustomKind === kind ? "page" : undefined}
                >
                  {kind}
                  <span className="nav-count">{count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {tagEntries.length ? (
        <>
          <h3 className="world-category-aside-heading">{WORLD.tagsHeading}</h3>
          <ul className="world-filter-list world-tag-list">
            {tagEntries.map(([tag, count]) => (
              <li key={tag}>
                <Link
                  href={withCollection({ tag })}
                  aria-current={currentTag === tag ? "page" : undefined}
                >
                  {tag}
                  <span className="nav-count">{count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </nav>
  );
}
