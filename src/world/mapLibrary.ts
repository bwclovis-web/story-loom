import type { MapClassification } from "@/world/mapClassification";
import { isMapClassification } from "@/world/mapClassification";

export type MapLibrarySort = "updated" | "created" | "name-asc" | "name-desc";
export type MapLibraryView = "grid" | "list";

export interface MapLibraryItem {
  id: string;
  title: string;
  imageId: string;
  imageName: string;
  hostRecordId: string;
  hostRecordTitle: string;
  classification: MapClassification | null;
  pinCount: number;
  createdAt: string;
  updatedAt: string;
}

export function parseMapLibrarySort(value: string | null | undefined): MapLibrarySort {
  if (value === "created" || value === "name-asc" || value === "name-desc") return value;
  return "updated";
}

export function parseMapLibraryFilter(value: string | null | undefined): MapClassification | "all" {
  if (!value || value === "all") return "all";
  return isMapClassification(value) ? value : "all";
}

export function filterAndSortMaps(
  maps: readonly MapLibraryItem[],
  options: { query: string; filter: MapClassification | "all"; sort: MapLibrarySort },
): MapLibraryItem[] {
  const q = options.query.trim().toLowerCase();
  const filtered = maps.filter((map) => {
    if (options.filter !== "all" && map.classification !== options.filter) return false;
    if (!q) return true;
    return map.title.toLowerCase().includes(q) || map.hostRecordTitle.toLowerCase().includes(q);
  });
  const sorted = [...filtered];
  sorted.sort((a, b) => {
    if (options.sort === "name-asc") return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
    if (options.sort === "name-desc") return b.title.localeCompare(a.title) || a.id.localeCompare(b.id);
    if (options.sort === "created") {
      const byCreated = b.createdAt.localeCompare(a.createdAt);
      return byCreated || a.id.localeCompare(b.id);
    }
    const byUpdated = b.updatedAt.localeCompare(a.updatedAt);
    return byUpdated || a.id.localeCompare(b.id);
  });
  return sorted;
}
