"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { WORLD } from "@/ui/labels";
import type { RecordNavEntry } from "@/ui/navigation";
import { categoryLabel, filterWorldTitles, isWorldType, WORLD_CATEGORY_LABELS, WORLD_TYPES, worldCounts, worldHref, type WorldType } from "@/ui/world";
import { SearchIcon } from "./icons";

/**
 * World navigation: title search, categories (the World document types) with
 * real counts, and the references in the current category. Pressing Enter in
 * the search box opens the World page with matches in text and fields too.
 */
export function WorldNav({
  projectId,
  records,
  onWorldPage,
  currentRecordId,
}: {
  projectId: string;
  records: RecordNavEntry[];
  onWorldPage: boolean;
  currentRecordId: string | null;
}) {
  const idPrefix = useId();
  const params = useSearchParams();
  const urlQuery = onWorldPage ? (params.get("q") ?? "") : "";
  const [query, setQuery] = useState(urlQuery);
  const [syncedQuery, setSyncedQuery] = useState(urlQuery);
  if (syncedQuery !== urlQuery) {
    setSyncedQuery(urlQuery);
    setQuery(urlQuery);
  }

  const counts = useMemo(() => worldCounts(records), [records]);
  const currentRecord = currentRecordId ? records.find((r) => r.id === currentRecordId) : undefined;
  const pageType = onWorldPage ? params.get("type") : null;
  const category: WorldType | null = isWorldType(pageType) ? pageType : currentRecord && isWorldType(currentRecord.type) ? currentRecord.type : null;
  const allCurrent = onWorldPage && !isWorldType(pageType) && !urlQuery;

  const searching = query.trim() !== "";
  const listed = useMemo(() => filterWorldTitles(records, query, searching ? null : category), [records, query, searching, category]);
  const recordHref = (id: string) => `/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(id)}`;
  const listHeading = searching ? WORLD.matchingTitles : category ? WORLD.inCategory(WORLD_CATEGORY_LABELS[category]) : WORLD.allReferences;

  return (
    <section className="world-nav" aria-labelledby={`${idPrefix}-heading`}>
      <p className="nav-subheading" id={`${idPrefix}-heading`}>
        {WORLD.references}
      </p>
      <form role="search" action={worldHref(projectId)} method="get" aria-label={WORLD.searchReferences}>
        <label className="tree-search">
          <span className="sr-only">{WORLD.searchReferences}</span>
          <SearchIcon />
          <input
            type="search"
            name="q"
            placeholder={WORLD.searchReferences}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-describedby={`${idPrefix}-hint`}
          />
        </label>
        <p className="tree-note world-search-hint" id={`${idPrefix}-hint`}>
          {WORLD.searchHint}
        </p>
      </form>

      <ul className="nav-list world-categories" aria-label={WORLD.categories}>
        <li>
          <Link href={worldHref(projectId)} aria-current={allCurrent ? "page" : undefined}>
            {WORLD.allReferences}
            <span className="nav-count">{counts.all}</span>
          </Link>
        </li>
        {WORLD_TYPES.map((type) => {
          const pageCurrent = onWorldPage && pageType === type && !urlQuery;
          const holdsCurrent = !onWorldPage && category === type;
          return (
            <li key={type}>
              <Link href={worldHref(projectId, { type })} aria-current={pageCurrent ? "page" : holdsCurrent ? "true" : undefined}>
                {WORLD_CATEGORY_LABELS[type]}
                <span className="nav-count">{counts.byType[type]}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="tree-note">{WORLD.categoryNote}</p>

      <p className="nav-subheading" id={`${idPrefix}-list`}>
        {listHeading}
        <span className="nav-count">{listed.length}</span>
      </p>
      <p className="sr-only" role="status">
        {searching ? (listed.length ? WORLD.titleMatches(listed.length) : WORLD.noTitleMatches) : ""}
      </p>
      {listed.length === 0 ? (
        <p className="nav-empty">{searching ? WORLD.noTitleMatches : WORLD.noneYet}</p>
      ) : (
        <ul className="nav-list record-list" aria-labelledby={`${idPrefix}-list`}>
          {listed.map((r) => (
            <li key={r.id}>
              <Link href={recordHref(r.id)} aria-current={r.id === currentRecordId ? "page" : undefined}>
                <span className="world-nav-title">{r.title}</span>
                {searching || !category ? <span className="nav-count">{categoryLabel(r.type)}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
