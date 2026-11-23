"use client";

import { useId, useMemo, useState } from "react";
import { Select } from "@/components/ui/Atoms/Select";
import { TextField } from "@/components/ui/TextField";
import { TaxonomyFilterSelects } from "@/components/world/TaxonomyFilterSelects";
import { WORLD } from "@/ui/labels";
import type { CustomTaxonomyCategoryOption } from "@/world/customCategories";
import {
  emptyTaxonomyFilter,
  filterPlaceableRecords,
  type PlaceableRecord,
  type TaxonomyFilterValue,
} from "@/world/taxonomyDiscovery";

/**
 * Search and category/subcategory picker for eligible local and series-shared
 * references. One option per Record.id; selection returns the original id.
 */
export function ReferenceTaxonomyPicker({
  records,
  value,
  onChange,
  customCategories = [],
  disabled = false,
  label = WORLD.choosePlace,
  emptyOptionLabel,
  searchLabel = WORLD.search,
  required = false,
  id,
}: {
  records: readonly PlaceableRecord[];
  value: string;
  onChange: (recordId: string) => void;
  customCategories?: readonly CustomTaxonomyCategoryOption[];
  disabled?: boolean;
  label?: string;
  emptyOptionLabel?: string;
  searchLabel?: string;
  required?: boolean;
  id?: string;
}) {
  const autoId = useId();
  const prefix = id ?? autoId;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<TaxonomyFilterValue>(emptyTaxonomyFilter());

  const filtered = useMemo(
    () =>
      filterPlaceableRecords(records, {
        query,
        category: filter.category,
        subcategory: filter.subcategory,
      }),
    [records, query, filter.category, filter.subcategory],
  );

  const selectedStillVisible = !value || filtered.some((record) => record.id === value);

  return (
    <div className="stack reference-taxonomy-picker" style={{ gap: "0.35rem" }}>
      <TextField
        id={`${prefix}-search`}
        label={searchLabel}
        type="search"
        value={query}
        disabled={disabled}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          // Stay inside the picker: Enter must not submit a parent "Add pin" form.
          if (event.key !== "Enter") return;
          event.preventDefault();
          if (filtered.length === 1 && filtered[0]) onChange(filtered[0].id);
        }}
        autoComplete="off"
      />
      <TaxonomyFilterSelects
        idPrefix={prefix}
        value={filter}
        onChange={setFilter}
        customCategories={customCategories}
        showClear
      />
      <Select
        id={`${prefix}-record`}
        label={label}
        value={selectedStillVisible ? value : ""}
        disabled={disabled || records.length === 0}
        required={required}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{emptyOptionLabel ?? label}</option>
        {filtered.map((record) => (
          <option key={record.id} value={record.id}>
            {record.title} ({record.typeLabel}
            {record.homeLabel ? ` · ${record.homeLabel}` : ""})
          </option>
        ))}
      </Select>
      {records.length === 0 ? (
        <p className="small muted">{WORLD.boardNoReferences}</p>
      ) : filtered.length === 0 ? (
        <p className="small muted">{WORLD.noMarkerMatch}</p>
      ) : null}
    </div>
  );
}

/** Fire-and-forget picker that clears after selection (board add-card menus). */
export function ReferenceTaxonomyPickerOnce({
  records,
  onSelect,
  customCategories = [],
  disabled = false,
  label = WORLD.chooseRecord,
}: {
  records: readonly PlaceableRecord[];
  onSelect: (recordId: string) => void;
  customCategories?: readonly CustomTaxonomyCategoryOption[];
  disabled?: boolean;
  label?: string;
}) {
  const [value, setValue] = useState("");
  return (
    <ReferenceTaxonomyPicker
      records={records}
      value={value}
      customCategories={customCategories}
      disabled={disabled}
      label={label}
      onChange={(recordId) => {
        setValue("");
        if (recordId) onSelect(recordId);
      }}
    />
  );
}
