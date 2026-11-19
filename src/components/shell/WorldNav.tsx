"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { WORLD } from "@/ui/labels";
import type { RecordNavEntry } from "@/ui/navigation";
import { categoryLabel, filterWorldTitles, isWorldType, WORLD_CATEGORY_LABELS, WORLD_TYPES, worldCounts, worldHref, type WorldType } from "@/ui/world";
import { CollapsibleNavSection } from "./CollapsibleNavSection";
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
  boards = [],
  maps = [],
  collapsed,
  onToggleSection,
}: {
  projectId: string;
  records: RecordNavEntry[];
  onWorldPage: boolean;
  currentRecordId: string | null;
  boards?: Array<{ id: string; title: string }>;
  maps?: Array<{ id: string; title: string }>;
  collapsed: ReadonlySet<string>;
  onToggleSection: (key: string) => void;
}) {
  const idPrefix = useId();
  const params = useSearchParams();
  const pathname = usePathname() ?? "";
  const boardsBase = `/projects/${encodeURIComponent(projectId)}/world/boards`;
  const mapsBase = `/projects/${encodeURIComponent(projectId)}/world/maps`;
  const onBoards = pathname.includes("/world/boards");
  const onMaps = pathname.includes("/world/maps");
  const onSpecial = onBoards || onMaps;
  const urlQuery = onWorldPage && !onSpecial ? (params.get("q") ?? "") : "";
  const [query, setQuery] = useState(urlQuery);
  const [syncedQuery, setSyncedQuery] = useState(urlQuery);
  if (syncedQuery !== urlQuery) {
    setSyncedQuery(urlQuery);
    setQuery(urlQuery);
  }

  const counts = useMemo(() => worldCounts(records), [records]);
  const currentRecord = currentRecordId ? records.find((r) => r.id === currentRecordId) : undefined;
  const pageType = onWorldPage && !onSpecial ? params.get("type") : null;
  const category: WorldType | null = isWorldType(pageType) ? pageType : currentRecord && isWorldType(currentRecord.type) ? currentRecord.type : null;
  const allCurrent = onWorldPage && !onSpecial && !isWorldType(pageType) && !urlQuery;

  const searching = query.trim() !== "";
  const listed = useMemo(() => filterWorldTitles(records, query, searching ? null : category), [records, query, searching, category]);
  const recordHref = (id: string) => `/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(id)}`;
  const listHeading = searching ? WORLD.matchingTitles : category ? WORLD.inCategory(WORLD_CATEGORY_LABELS[category]) : WORLD.allReferences;

  return (
    <section className="world-nav" aria-labelledby={`${idPrefix}-heading`}>
      <CollapsibleNavSection
        sectionKey="world:boards"
        collapsed={collapsed}
        onToggle={onToggleSection}
        headingId={`${idPrefix}-boards`}
        heading={WORLD.boards}
        count={boards.length}
      >
        <ul className="nav-list" aria-labelledby={`${idPrefix}-boards`}>
          <li>
            <Link href={boardsBase} aria-current={onBoards && !pathname.includes("/boards/") ? "page" : undefined}>
              {WORLD.boards}
              <span className="nav-count">{boards.length}</span>
            </Link>
          </li>
          {boards.map((b) => (
            <li key={b.id}>
              <Link
                href={`${boardsBase}/${encodeURIComponent(b.id)}`}
                aria-current={pathname.endsWith(`/boards/${b.id}`) || pathname.includes(`/boards/${b.id}`) ? "page" : undefined}
              >
                {b.title}
              </Link>
            </li>
          ))}
        </ul>
      </CollapsibleNavSection>

      <CollapsibleNavSection
        sectionKey="world:maps"
        collapsed={collapsed}
        onToggle={onToggleSection}
        headingId={`${idPrefix}-maps`}
        heading={WORLD.maps}
        count={maps.length}
      >
        <ul className="nav-list" aria-labelledby={`${idPrefix}-maps`}>
          <li>
            <Link href={mapsBase} aria-current={onMaps && !pathname.includes("/maps/") ? "page" : undefined}>
              {WORLD.maps}
              <span className="nav-count">{maps.length}</span>
            </Link>
          </li>
          {maps.map((m) => (
            <li key={m.id}>
              <Link
                href={`${mapsBase}/${encodeURIComponent(m.id)}`}
                aria-current={pathname.endsWith(`/maps/${m.id}`) || pathname.includes(`/maps/${m.id}`) ? "page" : undefined}
              >
                {m.title}
              </Link>
            </li>
          ))}
        </ul>
      </CollapsibleNavSection>

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

      <CollapsibleNavSection
        sectionKey="world:titles"
        collapsed={collapsed}
        onToggle={onToggleSection}
        headingId={`${idPrefix}-list`}
        heading={listHeading}
        count={listed.length}
        forceOpen={searching}
      >
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
      </CollapsibleNavSection>
    </section>
  );
}
