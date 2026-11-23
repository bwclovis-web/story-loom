import type { MarkerGroup } from "@/world/mapMarkers";

export interface WorldMapLayerView {
  id: string;
  mapId: string;
  position: number;
  title: string;
  legacyGroup: MarkerGroup | null;
}

export function layerStrokeColor(index: number): string {
  const palette = [
    "var(--color-accent)",
    "var(--color-ok, #2f6f4e)",
    "var(--color-warn, #a15c12)",
    "var(--color-violet, #5b4b8a)",
    "var(--color-text-muted)",
    "var(--color-accent)",
  ];
  return palette[index % palette.length]!;
}

export function resolvePinLayerId(
  pin: { layerId: string | null; markerGroup: MarkerGroup },
  layers: readonly WorldMapLayerView[],
): string | null {
  if (pin.layerId && layers.some((layer) => layer.id === pin.layerId)) return pin.layerId;
  const match = layers.find((layer) => layer.legacyGroup === pin.markerGroup);
  return match?.id ?? layers[0]?.id ?? null;
}

export function markerGroupFromLayer(layer: WorldMapLayerView | undefined, fallback: MarkerGroup = "places"): MarkerGroup {
  if (layer?.legacyGroup) return layer.legacyGroup;
  return fallback;
}
