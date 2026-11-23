"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/Atoms/Button";
import { Select } from "@/components/ui/Atoms/Select";
import { TextField } from "@/components/ui/TextField";
import {
  deleteWorldCategoryAction,
  saveWorldCategoryAction,
  setWorldCategoryScopeAction,
} from "@/app/projects/[projectId]/world/categoryActions";
import { WORLD_CATEGORY } from "@/ui/labels";
import type { CustomTaxonomyCategoryOption } from "@/world/customCategories";
import { WORLD_TAXONOMY_CATEGORIES } from "@/world/taxonomy";

/**
 * Author-managed custom World Hub categories and subcategories.
 * Built-in taxonomy categories stay available; these only add discovery labels.
 */
export function WorldCategoryManager({
  projectId,
  categories,
}: {
  projectId: string;
  categories: readonly CustomTaxonomyCategoryOption[];
}) {
  const local = useMemo(() => categories.filter((item) => !item.shared), [categories]);
  const [slug, setSlug] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [parent, setParent] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  const parentOptions = [
    ...WORLD_TAXONOMY_CATEGORIES.map((item) => ({ id: item.id, label: item.label })),
    ...local.filter((item) => !item.parentCategorySlug).map((item) => ({ id: item.slug, label: item.label })),
  ];

  const save = () => {
    startTransition(async () => {
      const result = await saveWorldCategoryAction(projectId, {
        slug,
        label,
        description,
        parentCategorySlug: parent || null,
      });
      if (result.ok) {
        setSlug("");
        setLabel("");
        setDescription("");
        setParent("");
        setMessage("");
      } else {
        setMessage(result.error);
      }
    });
  };

  return (
    <section className="panel stack" aria-labelledby="world-category-manager-heading">
      <h2 id="world-category-manager-heading">{WORLD_CATEGORY.legend}</h2>
      <p className="small muted">{WORLD_CATEGORY.hint}</p>
      {local.length === 0 ? <p className="small muted">{WORLD_CATEGORY.empty}</p> : null}
      {local.length ? (
        <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: "0.5rem" }}>
          {local.map((item) => (
            <li key={item.slug} className="row" style={{ flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
              <strong>{item.label}</strong>
              <span className="small muted">{item.slug}</span>
              {item.parentCategorySlug ? (
                <span className="small muted">under {item.parentCategorySlug}</span>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await setWorldCategoryScopeAction(projectId, item.slug, "series");
                  })
                }
              >
                {WORLD_CATEGORY.shareSeries}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await setWorldCategoryScopeAction(projectId, item.slug, "book");
                  })
                }
              >
                {WORLD_CATEGORY.keepBook}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await deleteWorldCategoryAction(projectId, item.slug);
                  })
                }
              >
                {WORLD_CATEGORY.remove}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="row" style={{ flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
        <TextField label={WORLD_CATEGORY.slug} value={slug} onChange={(event) => setSlug(event.target.value)} />
        <TextField label={WORLD_CATEGORY.label} value={label} onChange={(event) => setLabel(event.target.value)} />
        <TextField
          label={WORLD_CATEGORY.description}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <Select label={WORLD_CATEGORY.parent} value={parent} onChange={(event) => setParent(event.target.value)}>
          <option value="">{WORLD_CATEGORY.parentNone}</option>
          {parentOptions.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </Select>
        <Button type="button" disabled={pending || !slug.trim() || !label.trim()} onClick={save}>
          {WORLD_CATEGORY.save}
        </Button>
      </div>
      {message ? <p className="small">{message}</p> : null}
    </section>
  );
}
