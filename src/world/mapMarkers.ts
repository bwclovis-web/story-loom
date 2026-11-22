/** Marker groups shown on a World map. Default for existing pins is places. */
export const MARKER_GROUPS = ["places", "waterways", "transport", "story"] as const;

export type MarkerGroup = (typeof MARKER_GROUPS)[number];

export function isMarkerGroup(value: unknown): value is MarkerGroup {
  return typeof value === "string" && (MARKER_GROUPS as readonly string[]).includes(value);
}

export const MAP_ZOOM_MIN = 1;
export const MAP_ZOOM_MAX = 4;

export interface MapViewState {
  zoom: number;
  x: number;
  y: number;
}

export interface MapTrailItem {
  id: string;
  title: string;
}

export function clampMapZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAP_ZOOM_MAX, Math.max(MAP_ZOOM_MIN, zoom));
}

export function clampMapPan(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(8000, Math.max(-8000, value));
}

/** Drop the current map and anything after it so the trail is only ancestors. */
export function trailWithoutCurrent(trail: readonly MapTrailItem[], currentId: string): MapTrailItem[] {
  const index = trail.findIndex((item) => item.id === currentId);
  const kept = index >= 0 ? trail.slice(0, index) : trail;
  return kept.filter((item) => item.id !== currentId);
}

/** Remember the map being left. The same map is not stored twice. */
export function pushMapTrail(trail: readonly MapTrailItem[], item: MapTrailItem): MapTrailItem[] {
  return [...trail.filter((entry) => entry.id !== item.id), item].slice(-8);
}

const VIEW_PREFIX = "wordly-map-view:";
const TRAIL_PREFIX = "wordly-map-trail:";
const MODE_KEY = "wordly-map-mode";
const HIDDEN_KEY = "wordly-map-hidden-groups";
const HIDDEN_LAYERS_PREFIX = "wordly-map-hidden-layers:";
const SEARCH_PREFIX = "wordly-map-search:";

function storage(): Storage | null {
  return typeof sessionStorage === "undefined" ? null : sessionStorage;
}

export function readMapView(mapId: string): MapViewState {
  const raw = storage()?.getItem(`${VIEW_PREFIX}${mapId}`);
  if (!raw) return { zoom: 1, x: 0, y: 0 };
  try {
    const parsed = JSON.parse(raw) as Partial<MapViewState>;
    return {
      zoom: clampMapZoom(typeof parsed.zoom === "number" ? parsed.zoom : 1),
      x: clampMapPan(typeof parsed.x === "number" ? parsed.x : 0),
      y: clampMapPan(typeof parsed.y === "number" ? parsed.y : 0),
    };
  } catch {
    return { zoom: 1, x: 0, y: 0 };
  }
}

export function writeMapView(mapId: string, view: MapViewState): void {
  storage()?.setItem(
    `${VIEW_PREFIX}${mapId}`,
    JSON.stringify({ zoom: clampMapZoom(view.zoom), x: clampMapPan(view.x), y: clampMapPan(view.y) }),
  );
}

export function readMapTrail(projectId: string): MapTrailItem[] {
  const raw = storage()?.getItem(`${TRAIL_PREFIX}${projectId}`);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as { id?: unknown; title?: unknown };
      if (typeof row.id !== "string" || typeof row.title !== "string") return [];
      return [{ id: row.id, title: row.title }];
    });
  } catch {
    return [];
  }
}

export function writeMapTrail(projectId: string, trail: readonly MapTrailItem[]): void {
  storage()?.setItem(`${TRAIL_PREFIX}${projectId}`, JSON.stringify(trail));
}

export function clearMapTrail(projectId: string): void {
  storage()?.removeItem(`${TRAIL_PREFIX}${projectId}`);
}

export function readMapMode(): "browse" | "edit" {
  return storage()?.getItem(MODE_KEY) === "edit" ? "edit" : "browse";
}

export function writeMapMode(mode: "browse" | "edit"): void {
  storage()?.setItem(MODE_KEY, mode);
}

export function readHiddenGroups(): MarkerGroup[] {
  const raw = storage()?.getItem(HIDDEN_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isMarkerGroup);
  } catch {
    return [];
  }
}

export function writeHiddenGroups(groups: readonly MarkerGroup[]): void {
  storage()?.setItem(HIDDEN_KEY, JSON.stringify(groups));
}

export function readHiddenLayers(mapId: string): string[] {
  const raw = storage()?.getItem(`${HIDDEN_LAYERS_PREFIX}${mapId}`);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function writeHiddenLayers(mapId: string, layerIds: readonly string[]): void {
  storage()?.setItem(`${HIDDEN_LAYERS_PREFIX}${mapId}`, JSON.stringify(layerIds));
}

export function readMapSearch(mapId: string): string {
  return storage()?.getItem(`${SEARCH_PREFIX}${mapId}`) ?? "";
}

export function writeMapSearch(mapId: string, query: string): void {
  const store = storage();
  if (!store) return;
  const key = `${SEARCH_PREFIX}${mapId}`;
  if (!query) store.removeItem(key);
  else store.setItem(key, query);
}
