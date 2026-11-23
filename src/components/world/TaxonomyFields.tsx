"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Atoms/Button";
import { Select } from "@/components/ui/Atoms/Select";
import { HelpPopover } from "@/components/ui/HelpPopover";
import type { JsonObject } from "@/domain/json";
import { cn } from "@/ui/cn";
import { TAXONOMY_FIELDS } from "@/ui/labels";
import { taxonomyPlacementLabel as placementLabel } from "@/ui/world";
import { fieldDraftText, parseFieldDraft } from "@/world/fieldDraft";
import {
  customSubcategoriesOf,
  type CustomTaxonomyCategoryOption,
} from "@/world/customCategories";
import {
  getTaxonomyCategory,
  normalizeCustomTaxonomySlug,
  readRecordTaxonomy,
  TAXONOMY_FIELD_KEY,
  withoutRecordTaxonomy,
  withRecordTaxonomy,
  WORLD_TAXONOMY_CATEGORIES,
  type RecordTaxonomyV1,
  type TaxonomyPlacement,
} from "@/world/taxonomy";

function placementKey(placement: TaxonomyPlacement): string {
  return `${placement.category}\0${placement.subcategory ?? ""}`;
}

/** Options for one category: built-in + custom children, plus a saved custom one so it is never lost. */
function subcategoryOptions(
  category: string,
  customs: readonly CustomTaxonomyCategoryOption[],
  saved?: string,
): Array<{ id: string; label: string }> {
  const options = (getTaxonomyCategory(category)?.subcategories ?? []).map((item) => ({ id: item.id, label: item.label }));
  for (const custom of customSubcategoriesOf(customs, category)) {
    if (!options.some((item) => item.id === custom.slug)) {
      options.push({ id: custom.slug, label: custom.label });
    }
  }
  if (saved && !options.some((item) => item.id === saved)) options.push({ id: saved, label: saved });
  return options;
}

/**
 * World Hub classification: primary category, subcategory, extra memberships
 * and tags, saved as `fields.taxonomy` inside the same field draft as the rest
 * of the record's fields. Unknown keys on the draft and on the taxonomy stay.
 * Classification is discovery only; document type and structured kind are separate.
 */
export function TaxonomyFields({
  fieldsJson,
  onFieldsJsonChange,
  disabled,
  className,
  showClear = true,
  customCategories = [],
}: {
  fieldsJson: string;
  onFieldsJsonChange: (next: string) => void;
  disabled?: boolean;
  className?: string;
  showClear?: boolean;
  /** Author-defined categories/subcategories from WorldCategoryDefinition. */
  customCategories?: readonly CustomTaxonomyCategoryOption[];
}) {
  const draft = useMemo(() => parseFieldDraft(fieldsJson), [fieldsJson]);
  const read = useMemo(() => (draft.ok ? readRecordTaxonomy(draft.value) : null), [draft]);
  const taxonomy: RecordTaxonomyV1 | null = read?.taxonomy ?? null;
  const readable = !!draft.ok && !!read?.ok;
  const locked = disabled || !readable;
  const primary = taxonomy?.primary ?? null;
  const secondary = taxonomy?.secondary ?? [];
  const tags = taxonomy?.tags ?? [];

  const [secondaryCategory, setSecondaryCategory] = useState("");
  const [secondarySubcategory, setSecondarySubcategory] = useState("");
  const [secondaryMessage, setSecondaryMessage] = useState("");
  const [tagDraft, setTagDraft] = useState("");

  /** Write the next classification. Empty means no `fields.taxonomy` at all. */
  const publish = (next: { primary?: TaxonomyPlacement | null; secondary: TaxonomyPlacement[]; tags: string[] }) => {
    if (!draft.ok) return;
    const nextPrimary = next.primary ?? null;
    if (!nextPrimary && next.secondary.length === 0 && next.tags.length === 0) {
      onFieldsJsonChange(fieldDraftText(withoutRecordTaxonomy(draft.value)));
      return;
    }
    const value: RecordTaxonomyV1 = { version: 1 };
    if (nextPrimary) value.primary = nextPrimary;
    if (next.secondary.length) value.secondary = next.secondary;
    if (next.tags.length) value.tags = next.tags;
    const fields: JsonObject = withRecordTaxonomy(draft.value, value);
    onFieldsJsonChange(fieldDraftText(fields));
  };

  const changePrimary = (category: string, subcategory: string) => {
    const nextPrimary: TaxonomyPlacement | null = category
      ? subcategory
        ? { category, subcategory }
        : { category }
      : null;
    // A new primary may now equal a secondary membership; drop that duplicate.
    const nextSecondary = nextPrimary
      ? secondary.filter((item) => placementKey(item) !== placementKey(nextPrimary))
      : secondary;
    publish({ primary: nextPrimary, secondary: nextSecondary, tags });
  };

  const addSecondary = () => {
    if (!secondaryCategory) {
      setSecondaryMessage(TAXONOMY_FIELDS.secondaryNeedsCategory);
      return;
    }
    const placement: TaxonomyPlacement = secondarySubcategory
      ? { category: secondaryCategory, subcategory: secondarySubcategory }
      : { category: secondaryCategory };
    const key = placementKey(placement);
    if ((primary && placementKey(primary) === key) || secondary.some((item) => placementKey(item) === key)) {
      setSecondaryMessage(TAXONOMY_FIELDS.secondaryDuplicate);
      return;
    }
    setSecondaryMessage("");
    setSecondaryCategory("");
    setSecondarySubcategory("");
    publish({ primary, secondary: [...secondary, placement], tags });
  };

  const addTag = () => {
    const tag = normalizeCustomTaxonomySlug(tagDraft, 80);
    setTagDraft("");
    if (!tag || tags.some((item) => item.toLocaleLowerCase() === tag.toLocaleLowerCase())) return;
    publish({ primary, secondary, tags: [...tags, tag] });
  };

  const topLevelCustoms = customCategories.filter((item) => !item.parentCategorySlug);
  const primaryCategoryOptions = [
    ...WORLD_TAXONOMY_CATEGORIES.map((item) => ({ id: item.id, label: item.label })),
    ...topLevelCustoms.map((item) => ({ id: item.slug, label: item.label })),
    ...(primary &&
    !getTaxonomyCategory(primary.category) &&
    !customCategories.some((item) => item.slug === primary.category)
      ? [{ id: primary.category, label: primary.category }]
      : []),
  ];
  const primarySubs = primary ? subcategoryOptions(primary.category, customCategories, primary.subcategory) : [];
  const secondarySubs = secondaryCategory ? subcategoryOptions(secondaryCategory, customCategories) : [];
  const secondaryCategoryOptions = [
    ...WORLD_TAXONOMY_CATEGORIES.map((item) => ({ id: item.id, label: item.label })),
    ...topLevelCustoms.map((item) => ({ id: item.slug, label: item.label })),
  ];

  return (
    <fieldset className={cn("stack taxonomy-fields", className)}>
      <legend>
        <span className="field-caption">
          {TAXONOMY_FIELDS.legend}
          <HelpPopover label={TAXONOMY_FIELDS.legendExplain}>{TAXONOMY_FIELDS.legendHelp}</HelpPopover>
        </span>
      </legend>
      <p className="small muted">{TAXONOMY_FIELDS.hint}</p>
      {!draft.ok ? <p className="small">{TAXONOMY_FIELDS.invalidJson}</p> : null}
      {draft.ok && read && !read.ok ? <p className="small">{TAXONOMY_FIELDS.unreadable}</p> : null}

      <div className="row" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
        <Select
          label={
            <>
              {TAXONOMY_FIELDS.primary}
              <HelpPopover label={TAXONOMY_FIELDS.primaryExplain}>{TAXONOMY_FIELDS.primaryHelp}</HelpPopover>
            </>
          }
          value={primary?.category ?? ""}
          disabled={locked}
          onChange={(event) => changePrimary(event.target.value, "")}
        >
          <option value="">{TAXONOMY_FIELDS.primaryNone}</option>
          {primaryCategoryOptions.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </Select>
        <Select
          label={
            <>
              {TAXONOMY_FIELDS.subcategory}
              <HelpPopover label={TAXONOMY_FIELDS.subcategoryExplain}>{TAXONOMY_FIELDS.subcategoryHelp}</HelpPopover>
            </>
          }
          value={primary?.subcategory ?? ""}
          disabled={locked || !primary}
          onChange={(event) => primary && changePrimary(primary.category, event.target.value)}
        >
          <option value="">{TAXONOMY_FIELDS.subcategoryNone}</option>
          {primarySubs.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="stack">
        <span className="field-caption">
          {TAXONOMY_FIELDS.secondary}
          <HelpPopover label={TAXONOMY_FIELDS.secondaryExplain}>{TAXONOMY_FIELDS.secondaryHelp}</HelpPopover>
        </span>
        {secondary.length ? (
          <ul className="row" style={{ flexWrap: "wrap", gap: "0.35rem", listStyle: "none", padding: 0, margin: 0 }}>
            {secondary.map((item) => (
              <li key={placementKey(item)}>
                <span
                  className="small"
                  style={{ border: "1px solid var(--color-border)", borderRadius: "999px", padding: "0.15rem 0.45rem" }}
                >
                  {placementLabel(item)}{" "}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={locked}
                    aria-label={`${TAXONOMY_FIELDS.removeSecondary} ${placementLabel(item)}`}
                    onClick={() =>
                      publish({
                        primary,
                        secondary: secondary.filter((other) => placementKey(other) !== placementKey(item)),
                        tags,
                      })
                    }
                  >
                    {TAXONOMY_FIELDS.removeSecondary}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">{TAXONOMY_FIELDS.secondaryNone}</p>
        )}
        <div className="row" style={{ flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
          <Select
            label={TAXONOMY_FIELDS.secondaryCategory}
            value={secondaryCategory}
            disabled={locked}
            onChange={(event) => {
              setSecondaryCategory(event.target.value);
              setSecondarySubcategory("");
              setSecondaryMessage("");
            }}
          >
            <option value="">{TAXONOMY_FIELDS.primaryNone}</option>
            {secondaryCategoryOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </Select>
          <Select
            label={TAXONOMY_FIELDS.secondarySubcategory}
            value={secondarySubcategory}
            disabled={locked || !secondaryCategory}
            onChange={(event) => {
              setSecondarySubcategory(event.target.value);
              setSecondaryMessage("");
            }}
          >
            <option value="">{TAXONOMY_FIELDS.subcategoryNone}</option>
            {secondarySubs.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </Select>
          <Button type="button" variant="secondary" disabled={locked} onClick={addSecondary}>
            {TAXONOMY_FIELDS.addSecondary}
          </Button>
        </div>
        {secondaryMessage ? (
          <p className="small" role="status">
            {secondaryMessage}
          </p>
        ) : null}
      </div>

      <div className="stack">
        <span className="field-caption">
          {TAXONOMY_FIELDS.tags}
          <HelpPopover label={TAXONOMY_FIELDS.tagsExplain}>{TAXONOMY_FIELDS.tagsHelp}</HelpPopover>
        </span>
        {tags.length ? (
          <ul className="row" style={{ flexWrap: "wrap", gap: "0.35rem", listStyle: "none", padding: 0, margin: 0 }}>
            {tags.map((tag) => (
              <li key={tag}>
                <span
                  className="small"
                  style={{ border: "1px solid var(--color-border)", borderRadius: "999px", padding: "0.15rem 0.45rem" }}
                >
                  {tag}{" "}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={locked}
                    aria-label={`${TAXONOMY_FIELDS.removeTag} ${tag}`}
                    onClick={() => publish({ primary, secondary, tags: tags.filter((item) => item !== tag) })}
                  >
                    {TAXONOMY_FIELDS.removeTag}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="row">
          <label>
            <span className="sr-only">{TAXONOMY_FIELDS.addTag}</span>
            <input
              type="text"
              value={tagDraft}
              placeholder={TAXONOMY_FIELDS.tagPlaceholder}
              disabled={locked}
              onChange={(event) => setTagDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                addTag();
              }}
            />
          </label>
          <Button type="button" variant="secondary" disabled={locked} onClick={addTag}>
            {TAXONOMY_FIELDS.addTag}
          </Button>
        </div>
      </div>

      {showClear ? (
        <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
          <Button
            type="button"
            variant="secondary"
            disabled={disabled || !draft.ok || !(TAXONOMY_FIELD_KEY in draft.value)}
            onClick={() => {
              if (!draft.ok) return;
              onFieldsJsonChange(fieldDraftText(withoutRecordTaxonomy(draft.value)));
            }}
          >
            {TAXONOMY_FIELDS.clear}
          </Button>
          <span className="small muted">{TAXONOMY_FIELDS.clearHint}</span>
        </div>
      ) : null}
    </fieldset>
  );
}
