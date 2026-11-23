import type { CustomTaxonomyCategoryOption } from "@/world/customCategories";
import { getTaxonomyCategory, type TaxonomyNavSummary } from "@/world/taxonomy";
import { taxonomyPlacementLabel } from "@/ui/world";
import { TAXONOMY_FIELDS, WORLD } from "@/ui/labels";

function categoryDisplay(
  categoryId: string,
  customCategories: readonly CustomTaxonomyCategoryOption[],
): string {
  return (
    getTaxonomyCategory(categoryId)?.label ??
    customCategories.find((item) => item.slug === categoryId)?.label ??
    categoryId
  );
}

/** Compact primary / secondary taxonomy badges for inspectors and pickers. */
export function TaxonomyBadges({
  taxonomy,
  customCategories = [],
  compact = false,
}: {
  taxonomy: TaxonomyNavSummary | null | undefined;
  customCategories?: readonly CustomTaxonomyCategoryOption[];
  compact?: boolean;
}) {
  if (!taxonomy) return null;
  const primaryLabel = taxonomy.primaryCategory
    ? taxonomyPlacementLabel({
        category: taxonomy.primaryCategory,
        subcategory: taxonomy.primarySubcategory,
      })
    : null;
  const secondary = taxonomy.secondaryCategories.map((id) => categoryDisplay(id, customCategories));
  if (!primaryLabel && !secondary.length && !taxonomy.customKind && !taxonomy.isUnclassified) return null;

  return (
    <p className="small world-row-taxonomy" style={{ margin: compact ? "0.15rem 0 0" : undefined }}>
      {taxonomy.isUnclassified ? <span className="badge badge-muted">{WORLD.uncategorized}</span> : null}
      {primaryLabel ? (
        <span className="badge" title={TAXONOMY_FIELDS.viewPrimary}>
          {primaryLabel}
        </span>
      ) : null}
      {secondary.map((label) => (
        <span key={label} className="badge badge-muted">
          + {label}
        </span>
      ))}
      {taxonomy.customKind ? <span className="badge badge-muted">{taxonomy.customKind}</span> : null}
    </p>
  );
}
