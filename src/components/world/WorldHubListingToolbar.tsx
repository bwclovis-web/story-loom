"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Bookmark, Filter, FolderOpen, LayoutGrid, List, Search, X } from "lucide-react";
import { Button } from "@/components/ui/Atoms/Button";
import { MenuPopover } from "@/components/ui/MenuPopover";
import { SegmentedControl, SegmentedOption } from "@/components/ui/SegmentedControl";
import { Select } from "@/components/ui/Select";
import { WORLD_HUB_VIEW_COOKIE, writePreference } from "@/components/shell/preferences";
import { worldHref } from "@/ui/world";
import { WORLD } from "@/ui/labels";
import {
  countWorldHubFilterChips,
  listWorldHubFilterChips,
  worldHubHref,
  type HubView,
  type WorldHubQuery,
} from "@/world/hubDiscovery";
import { worldCollectionHasSavableFilters } from "@/world/worldHubCollections";
import { WorldHubFilterForm } from "@/components/world/WorldHubFilterForm";
import { WorldHubCollectionsMenu } from "@/components/world/WorldHubCollectionsMenu";
import type { SmartCollectionView } from "@/server/services/smartCollectionService";
import type { CustomTaxonomyCategoryOption } from "@/world/customCategories";

export function WorldHubListingToolbar({
  projectId,
  query,
  tags,
  resultCount,
  collectionId = null,
  collections,
  activeCollection = null,
  matchCount = 0,
  customCategories = [],
}: {
  projectId: string;
  query: WorldHubQuery;
  tags: readonly string[];
  resultCount: number;
  collectionId?: string | null;
  collections: SmartCollectionView[];
  activeCollection?: SmartCollectionView | null;
  matchCount?: number;
  customCategories?: readonly CustomTaxonomyCategoryOption[];
}) {
  const router = useRouter();
  const searchId = useId();
  const filterFormId = useId();
  const sortId = useId();
  const [saveOpen, setSaveOpen] = useState(false);
  const filterCount = countWorldHubFilterChips(query);
  const chips = listWorldHubFilterChips(query);

  const setView = (view: HubView) => {
    writePreference(WORLD_HUB_VIEW_COOKIE, view);
    router.push(
      worldHubHref(projectId, {
        ...query,
        list: true,
        view,
        collection: collectionId,
      }),
    );
  };

  const clearBase = (): WorldHubQuery => ({
    type: null,
    kind: null,
    q: query.q,
    list: true,
    category: null,
    subcategory: null,
    tag: null,
    customKind: null,
    unclassified: false,
    scope: null,
    status: null,
    protected: null,
    sort: query.sort,
    view: query.view,
  });

  const clearAllHref = () => {
    if (query.category) {
      return worldHubHref(projectId, {
        ...clearBase(),
        category: query.category,
        collection: collectionId,
      });
    }
    if (query.unclassified) {
      return worldHubHref(projectId, {
        ...clearBase(),
        unclassified: true,
        collection: collectionId,
      });
    }
    return worldHubHref(projectId, {
      list: true,
      view: query.view,
      sort: query.sort,
      q: query.q,
      collection: collectionId,
    });
  };

  return (
    <div className="world-hub-listing-toolbar">
      <div className="world-hub-toolbar-row">
        <form
          role="search"
          method="get"
          action={worldHref(projectId)}
          className="world-hub-toolbar-search"
          aria-label={WORLD.searchReferences}
        >
          <input type="hidden" name="list" value="1" />
          {query.category ? <input type="hidden" name="category" value={query.category} /> : null}
          {query.subcategory ? <input type="hidden" name="subcategory" value={query.subcategory} /> : null}
          {query.type ? <input type="hidden" name="type" value={query.type} /> : null}
          {query.kind ? <input type="hidden" name="kind" value={query.kind} /> : null}
          {query.tag ? <input type="hidden" name="tag" value={query.tag} /> : null}
          {query.customKind ? <input type="hidden" name="customKind" value={query.customKind} /> : null}
          {query.unclassified ? <input type="hidden" name="unclassified" value="1" /> : null}
          {query.scope ? <input type="hidden" name="scope" value={query.scope} /> : null}
          {query.status ? <input type="hidden" name="status" value={query.status} /> : null}
          {query.protected ? <input type="hidden" name="protected" value={query.protected} /> : null}
          {query.sort !== "updated" ? <input type="hidden" name="sort" value={query.sort} /> : null}
          {query.view !== "cards" ? <input type="hidden" name="view" value={query.view} /> : null}
          {collectionId ? <input type="hidden" name="collection" value={collectionId} /> : null}
          <label className="sr-only" htmlFor={searchId}>
            {WORLD.searchReferences}
          </label>
          <span className="world-hub-toolbar-search-icon" aria-hidden="true">
            <Search strokeWidth={1.75} />
          </span>
          <input
            id={searchId}
            type="search"
            name="q"
            placeholder={WORLD.searchReferencesPlaceholder}
            defaultValue={query.q}
          />
          <button type="submit" className="sl-btn world-hub-toolbar-search-submit">
            {WORLD.search}
          </button>
        </form>

        <MenuPopover
          label={WORLD.filtersButton}
          role="dialog"
          align="end"
          closeOnSelect={false}
          trigger={
            <Button type="button" size="sm" variant="secondary" icon={<Filter strokeWidth={1.75} />}>
              {WORLD.filtersWithCount(filterCount)}
            </Button>
          }
        >
          <WorldHubFilterForm
            formId={filterFormId}
            projectId={projectId}
            query={query}
            tags={tags}
            collectionId={collectionId}
          />
        </MenuPopover>

        <Select
          id={sortId}
          label={false}
          size="sm"
          className="world-hub-toolbar-sort"
          value={query.sort}
          aria-label={WORLD.filterSort}
          onChange={(event) => {
            const sort = event.target.value as WorldHubQuery["sort"];
            router.push(
              worldHubHref(projectId, {
                ...query,
                list: true,
                sort,
                collection: collectionId,
              }),
            );
          }}
        >
          <option value="updated">{WORLD.sortUpdated}</option>
          <option value="created">{WORLD.sortCreated}</option>
          <option value="title">{WORLD.sortTitle}</option>
        </Select>

        <SegmentedControl label={WORLD.viewToggle} size="sm" tone="accent" className="map-library-view-toggle">
          <SegmentedOption
            selected={query.view === "cards"}
            onClick={() => setView("cards")}
            aria-label={WORLD.viewCards}
          >
            <LayoutGrid aria-hidden="true" strokeWidth={1.75} className="map-library-view-icon" />
          </SegmentedOption>
          <SegmentedOption
            selected={query.view === "list"}
            onClick={() => setView("list")}
            aria-label={WORLD.viewList}
          >
            <List aria-hidden="true" strokeWidth={1.75} className="map-library-view-icon" />
          </SegmentedOption>
        </SegmentedControl>

        <WorldHubCollectionsMenu
          projectId={projectId}
          query={query}
          collections={collections}
          activeCollection={activeCollection}
          matchCount={matchCount}
          customCategories={customCategories}
          saveOpen={saveOpen}
          onSaveOpenChange={setSaveOpen}
          triggerIcon={<FolderOpen strokeWidth={1.75} />}
        />

        <Button
          type="button"
          size="sm"
          variant="secondary"
          icon={<Bookmark strokeWidth={1.75} />}
          disabled={!worldCollectionHasSavableFilters(query)}
          onClick={() => setSaveOpen(true)}
        >
          {WORLD.saveCurrentFilters}
        </Button>
      </div>

      <div className="world-hub-toolbar-status">
        <p className="small muted" role="status">
          {WORLD.resultCount(resultCount)}
        </p>
        {chips.length > 0 ? (
          <ul className="world-hub-filter-chips">
            {chips.map((chip) => (
              <li key={chip.key}>
                <Link
                  href={worldHubHref(projectId, {
                    ...query,
                    list: true,
                    collection: collectionId,
                    ...chip.clear,
                  })}
                  className="world-hub-filter-chip"
                >
                  <span>{chip.label}</span>
                  <X strokeWidth={1.75} aria-hidden="true" className="world-hub-filter-chip-x" />
                  <span className="sr-only">{WORLD.clearFilters}</span>
                </Link>
              </li>
            ))}
            <li>
              <Link href={clearAllHref()} className="small">
                {WORLD.clearFilters}
              </Link>
            </li>
          </ul>
        ) : null}
      </div>
    </div>
  );
}
