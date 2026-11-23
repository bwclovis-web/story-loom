"use client";

import { Button } from "@/components/ui/Atoms/Button";
import { Select } from "@/components/ui/Atoms/Select";
import { WORLD } from "@/ui/labels";
import type { CustomTaxonomyCategoryOption } from "@/world/customCategories";
import { topLevelCustomCategories } from "@/world/customCategories";
import {
  emptyTaxonomyFilter,
  subcategoryOptionsFor,
  TAXONOMY_FILTER_UNCLASSIFIED,
  taxonomyFilterActive,
  type TaxonomyFilterValue,
} from "@/world/taxonomyDiscovery";
import { WORLD_TAXONOMY_CATEGORIES } from "@/world/taxonomy";

/** Category and subcategory selects with an accessible Clear control. */
export function TaxonomyFilterSelects({
  value,
  onChange,
  customCategories = [],
  idPrefix,
  showUnclassified = true,
  showClear = true,
  className,
}: {
  value: TaxonomyFilterValue;
  onChange: (next: TaxonomyFilterValue) => void;
  customCategories?: readonly CustomTaxonomyCategoryOption[];
  idPrefix: string;
  showUnclassified?: boolean;
  showClear?: boolean;
  className?: string;
}) {
  const customs = topLevelCustomCategories(customCategories);
  const subOptions = subcategoryOptionsFor(value.category, customCategories);
  const active = taxonomyFilterActive(value);

  return (
    <div className={className ?? "stack"} style={{ gap: "0.35rem" }}>
      <Select
        id={`${idPrefix}-category`}
        label={WORLD.filterCategory}
        value={value.category ?? ""}
        onChange={(event) => {
          const category = event.target.value || null;
          onChange({ category, subcategory: null });
        }}
      >
        <option value="">{WORLD.filterAny}</option>
        {WORLD_TAXONOMY_CATEGORIES.map((category) => (
          <option key={category.id} value={category.id}>
            {category.label}
          </option>
        ))}
        {customs.map((category) => (
          <option key={category.slug} value={category.slug}>
            {category.label}
          </option>
        ))}
        {showUnclassified ? (
          <option value={TAXONOMY_FILTER_UNCLASSIFIED}>{WORLD.uncategorized}</option>
        ) : null}
      </Select>
      <Select
        id={`${idPrefix}-subcategory`}
        label={WORLD.filterSubcategory}
        value={value.subcategory ?? ""}
        disabled={!value.category || value.category === TAXONOMY_FILTER_UNCLASSIFIED || subOptions.length === 0}
        onChange={(event) =>
          onChange({
            category: value.category,
            subcategory: event.target.value || null,
          })
        }
      >
        <option value="">{WORLD.filterAny}</option>
        {subOptions.map((sub) => (
          <option key={sub.id} value={sub.id}>
            {sub.label}
          </option>
        ))}
      </Select>
      {showClear && active ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => onChange(emptyTaxonomyFilter())}
        >
          {WORLD.clearFilters}
        </Button>
      ) : null}
    </div>
  );
}
