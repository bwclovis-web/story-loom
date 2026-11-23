"use client";

import { ImagePlus, LayoutGrid, List, Plus } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Atoms/Button";
import { Select } from "@/components/ui/Atoms/Select";
import { EmptyState } from "@/components/ui/EmptyState";
import { SegmentedControl, SegmentedOption } from "@/components/ui/SegmentedControl";
import { SearchIcon } from "@/components/shell/icons";
import { MAPS_VIEW_COOKIE, writePreference, type MapsViewPreference } from "@/components/shell/preferences";
import { WORLD } from "@/ui/labels";
import { MAP_CLASSIFICATION_LABEL, MAP_CLASSIFICATIONS, type MapClassification } from "@/world/mapClassification";
import {
  filterAndSortMaps,
  parseMapLibraryFilter,
  parseMapLibrarySort,
  type MapLibraryItem,
  type MapLibrarySort,
  type MapLibraryView,
} from "@/world/mapLibrary";
import { CreateMapForm } from "./CreateMapForm";
import { EditMapDetailsDialog } from "./EditMapDetailsDialog";
import { MapCard, MapListRow } from "./MapCard";

export function MapsLanding({
  projectId,
  maps,
  images,
  hosts,
  initialView,
}: {
  projectId: string;
  maps: MapLibraryItem[];
  images: Array<{ id: string; label: string; previewUrl: string }>;
  hosts: Array<{ id: string; title: string; isProtected: boolean }>;
  initialView: MapsViewPreference;
}) {
  const searchId = useId();
  const searchHintId = useId();
  const filterId = useId();
  const sortId = useId();
  const createTitleId = useId();
  const createDialogRef = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<MapClassification | "all">("all");
  const [sort, setSort] = useState<MapLibrarySort>("updated");
  const [view, setView] = useState<MapLibraryView>(initialView);
  const [editing, setEditing] = useState<MapLibraryItem | null>(null);

  const visible = useMemo(
    () => filterAndSortMaps(maps, { query, filter, sort }),
    [maps, query, filter, sort],
  );

  const openCreate = () => {
    createDialogRef.current?.showModal();
  };

  const closeCreate = () => {
    createDialogRef.current?.close();
  };

  const setViewPreference = (next: MapLibraryView) => {
    setView(next);
    writePreference(MAPS_VIEW_COOKIE, next);
  };

  return (
    <div className="map-library">
      <header className="map-library-intro">
        <h2 className="map-library-intro-title">{WORLD.mapsIntro}</h2>
        <Button type="button" onClick={openCreate}>
          <Plus aria-hidden="true" strokeWidth={2} />
          {WORLD.mapsNewButton}
        </Button>
      </header>

      {maps.length > 0 ? (
        <div className="map-library-toolbar">
          <form
            role="search"
            className="map-library-search-form"
            aria-label={WORLD.mapsSearch}
            onSubmit={(e) => e.preventDefault()}
          >
            <label className="tree-search map-library-search" htmlFor={searchId}>
              <span className="sr-only">{WORLD.mapsSearch}</span>
              <SearchIcon />
              <input
                id={searchId}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={WORLD.mapsSearchPlaceholder}
                autoComplete="off"
                aria-describedby={searchHintId}
              />
            </label>
            <p className="sr-only" id={searchHintId}>
              {WORLD.mapsSearch}
            </p>
          </form>
          <Select
            id={filterId}
            label={false}
            value={filter}
            onChange={(e) => setFilter(parseMapLibraryFilter(e.target.value))}
            aria-label={WORLD.mapClassification}
          >
            <option value="all">{WORLD.mapsFilterAll}</option>
            {MAP_CLASSIFICATIONS.map((value) => (
              <option key={value} value={value}>
                {MAP_CLASSIFICATION_LABEL[value]}
              </option>
            ))}
          </Select>
          <Select
            id={sortId}
            label={false}
            value={sort}
            onChange={(e) => setSort(parseMapLibrarySort(e.target.value))}
            aria-label={WORLD.mapsSortRecentlyUpdated}
          >
            <option value="updated">{WORLD.mapsSortRecentlyUpdated}</option>
            <option value="created">{WORLD.mapsSortRecentlyCreated}</option>
            <option value="name-asc">{WORLD.mapsSortNameAsc}</option>
            <option value="name-desc">{WORLD.mapsSortNameDesc}</option>
          </Select>
          <SegmentedControl label={WORLD.toolbarView} size="sm" className="map-library-view-toggle">
            <SegmentedOption
              selected={view === "grid"}
              aria-label={WORLD.mapsViewGridHint}
              onClick={() => setViewPreference("grid")}
            >
              <LayoutGrid aria-hidden="true" strokeWidth={1.75} className="map-library-view-icon" />
            </SegmentedOption>
            <SegmentedOption
              selected={view === "list"}
              aria-label={WORLD.mapsViewListHint}
              onClick={() => setViewPreference("list")}
            >
              <List aria-hidden="true" strokeWidth={1.75} className="map-library-view-icon" />
            </SegmentedOption>
          </SegmentedControl>
        </div>
      ) : null}

      <section className="map-library-atlas" aria-labelledby="maps-atlas-heading">
        <header className="map-library-atlas-head">
          <h2 id="maps-atlas-heading">{WORLD.mapsAtlas}</h2>
          <span className="badge" aria-live="polite">
            {WORLD.mapsCount(visible.length)}
          </span>
        </header>

        {maps.length === 0 ? (
          <EmptyState as="div" className="map-library-empty">
            <strong className="map-library-empty-title">{WORLD.mapsEmptyTitle}</strong>
            <p>{WORLD.mapsEmptyBody}</p>
            <Button type="button" onClick={openCreate}>
              {WORLD.mapsEmptyAction}
            </Button>
          </EmptyState>
        ) : visible.length === 0 ? (
          <EmptyState>{WORLD.mapsNoMatches}</EmptyState>
        ) : view === "grid" ? (
          <div className="map-library-grid">
            {visible.map((map) => (
              <MapCard key={map.id} projectId={projectId} map={map} onEditDetails={setEditing} />
            ))}
            <button type="button" className="map-library-add-tile" onClick={openCreate}>
              <span className="map-library-add-icon" aria-hidden="true">
                <ImagePlus strokeWidth={1.5} />
              </span>
              <span className="map-library-add-copy">
                <strong>{WORLD.mapsAddTile}</strong>
                <span>{WORLD.mapsAddTileHint}</span>
              </span>
            </button>
          </div>
        ) : (
          <>
            <ul className="map-library-list">
              {visible.map((map) => (
                <MapListRow key={map.id} projectId={projectId} map={map} onEditDetails={setEditing} />
              ))}
            </ul>
            <button type="button" className="map-library-add-tile map-library-add-tile-list" onClick={openCreate}>
              <span className="map-library-add-icon" aria-hidden="true">
                <ImagePlus strokeWidth={1.5} />
              </span>
              <span className="map-library-add-copy">
                <strong>{WORLD.mapsAddTile}</strong>
                <span>{WORLD.mapsAddTileHint}</span>
              </span>
            </button>
          </>
        )}
      </section>

      <dialog
        ref={createDialogRef}
        className="library-dialog map-library-dialog map-create-dialog"
        aria-labelledby={createTitleId}
      >
        <div className="map-create-dialog-head">
          <h2 id={createTitleId}>{WORLD.newMap}</h2>
          <p className="small muted">{WORLD.newMapLead}</p>
        </div>
        <CreateMapForm
          projectId={projectId}
          images={images}
          hosts={hosts}
          onCancel={closeCreate}
        />
      </dialog>

      <EditMapDetailsDialog
        projectId={projectId}
        map={editing}
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}
