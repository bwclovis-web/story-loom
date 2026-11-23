import { newId } from "@/domain/ids";
import { errorIssue } from "@/domain/issues";
import { isMarkerGroup, MARKER_GROUPS, type MarkerGroup } from "@/world/mapMarkers";
import {
  layerStrokeColor,
  markerGroupFromLayer,
  resolvePinLayerId,
  type WorldMapLayerView,
} from "@/world/mapLayers";
import type { DbOrTx, Tx } from "../db";
import { MutationRejectedError } from "./errors";

export {
  layerStrokeColor,
  markerGroupFromLayer,
  resolvePinLayerId,
  type WorldMapLayerView,
};

const TITLE_MAX = 80;
const MAX_LAYERS = 16;

export const DEFAULT_LAYER_SPECS: readonly { legacyGroup: MarkerGroup; title: string; position: number }[] = [
  { legacyGroup: "places", title: "Places", position: 1 },
  { legacyGroup: "waterways", title: "Waterways", position: 2 },
  { legacyGroup: "transport", title: "Transport", position: 3 },
  { legacyGroup: "story", title: "Story locations", position: 4 },
];

function rejected(message: string): MutationRejectedError {
  return new MutationRejectedError([errorIssue("INVALID_CHANGE", message)]);
}

export async function listWorldMapLayers(db: DbOrTx, mapId: string): Promise<WorldMapLayerView[]> {
  if (!("worldMapLayer" in db)) return [];
  const rows = await db.worldMapLayer.findMany({
    where: { mapId },
    orderBy: [{ position: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    mapId: row.mapId,
    position: row.position,
    title: row.title,
    legacyGroup: row.legacyGroup && isMarkerGroup(row.legacyGroup) ? row.legacyGroup : null,
  }));
}

export async function seedDefaultMapLayers(tx: Tx, projectId: string, mapId: string): Promise<void> {
  const existing = await tx.worldMapLayer.count({ where: { mapId } });
  if (existing > 0) return;
  await tx.worldMapLayer.createMany({
    data: DEFAULT_LAYER_SPECS.map((spec) => ({
      id: newId("wmly"),
      mapId,
      projectId,
      position: spec.position,
      title: spec.title,
      legacyGroup: spec.legacyGroup,
    })),
  });
}

export async function resolveLayerForWrite(
  tx: Tx,
  mapId: string,
  layerId: string | null | undefined,
  markerGroup: string | null | undefined,
): Promise<{ layerId: string; markerGroup: MarkerGroup }> {
  const layers = await listWorldMapLayers(tx, mapId);
  if (!layers.length) throw rejected("Add at least one layer on this map.");
  if (layerId) {
    const layer = layers.find((row) => row.id === layerId);
    if (!layer) throw rejected("Choose a layer on this map.");
    return { layerId: layer.id, markerGroup: layer.legacyGroup ?? (isMarkerGroup(markerGroup) ? markerGroup : "places") };
  }
  const group = isMarkerGroup(markerGroup) ? markerGroup : "places";
  const layer = layers.find((row) => row.legacyGroup === group) ?? layers[0]!;
  return { layerId: layer.id, markerGroup: layer.legacyGroup ?? group };
}

export function validateLayerTitles(
  input: readonly { title: string }[],
): { title: string }[] {
  if (!input.length) throw rejected("Add at least one layer.");
  if (input.length > MAX_LAYERS) throw rejected(`A map can have up to ${MAX_LAYERS} layers.`);
  return input.map((row, index) => {
    const title = row.title.trim();
    if (!title || title.length > TITLE_MAX) throw rejected(`Layer ${index + 1} needs a title up to ${TITLE_MAX} characters.`);
    return { title };
  });
}

export { MARKER_GROUPS };