import { newId } from "@/domain/ids";
import { errorIssue } from "@/domain/issues";
import { isLinkableReferenceType, isRecordType, RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import { isAuthorityStatus, type AuthorityStatus } from "@/domain/statuses";
import {
  isMarkerKind,
  normalizeShape,
  parseStoredPoints,
  serializePoints,
  type MarkerKind,
  type NormPoint,
} from "@/world/mapGeometry";
import { isMarkerGroup, type MarkerGroup } from "@/world/mapMarkers";
import {
  listWorldMapLayers,
  resolveLayerForWrite,
  seedDefaultMapLayers,
  type WorldMapLayerView,
} from "./worldMapLayerService";
import type { Db, DbOrTx, Tx } from "../db";
import { writeAudit } from "./auditService";
import { MutationRejectedError, NotFoundError } from "./errors";

/*
 * World maps: a RecordImage backdrop with markers. A marker may link a
 * reference record, another map, or both. Points, route vertices, area
 * corners, and label anchors are fractions of image width/height (0–1) so
 * alignment survives resize. Those fractions are not distance or travel time.
 * Several maps may mark the same place. Moving markers never creates or
 * changes PlaceRelation rows. A geometry write sends the revision it read;
 * a mismatch is refused and nothing is written.
 *
 * Trash:
 * - Soft-trashed image host record → map omitted from lists / NotFound on open.
 * - Soft-trashed reference target → marker kept but marked unavailable.
 * - Soft-trashed detailed-map host → marker kept; Open detailed map is disabled.
 * - Permanent image delete → maps using that image are deleted (with markers).
 * - Permanent record delete → markers for that record are deleted.
 * - Deleting a map clears links that opened it and keeps the other markers.
 */

const UI_ACTOR = "author";

export interface WorldMapSummary {
  id: string;
  title: string;
  imageId: string;
  imageName: string;
  hostRecordId: string;
  hostRecordTitle: string;
  pinCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorldMapPinView {
  id: string;
  mapId: string;
  recordId: string | null;
  targetMapId: string | null;
  targetMapTitle: string | null;
  /** True when a detailed-map link is set but that map cannot be opened. */
  targetUnavailable: boolean;
  markerGroup: MarkerGroup;
  layerId: string | null;
  label: string;
  kind: MarkerKind;
  points: NormPoint[];
  revision: number;
  xNorm: number;
  yNorm: number;
  title: string;
  typeLabel: string;
  authorityStatus: AuthorityStatus | null;
  /** True when the linked record is in the Trash (marker kept until permanent delete). */
  unavailable: boolean;
}

export interface WorldMapPinLinks {
  recordId?: string | null;
  targetMapId?: string | null;
  markerGroup?: string | null;
  layerId?: string | null;
  label?: string | null;
  /** When set, the write is refused if the marker was saved again since this revision. */
  expectedRevision?: number | null;
}

export interface WorldMapView {
  id: string;
  projectId: string;
  title: string;
  imageId: string;
  imageName: string;
  imageWidth: number;
  imageHeight: number;
  hostRecordId: string;
  hostRecordTitle: string;
  createdAt: Date;
  updatedAt: Date;
  scaleLabel: string;
  scaleBarLength: number | null;
  layers: WorldMapLayerView[];
  pins: WorldMapPinView[];
}

function rejected(message: string, recordId?: string): MutationRejectedError {
  return new MutationRejectedError([errorIssue("INVALID_REFERENCE", message, recordId ? { recordId } : {})]);
}

function clampNorm(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

function staleMarker(): MutationRejectedError {
  return new MutationRejectedError([
    errorIssue("STALE_REVISION", "This marker was saved again after you started editing. The save was not applied."),
  ]);
}

function kindOf(value: string): MarkerKind {
  return isMarkerKind(value) ? value : "point";
}

function kindFallback(kind: MarkerKind): string {
  if (kind === "route") return "Route";
  if (kind === "area") return "Area";
  if (kind === "label") return "Label";
  return "Marker";
}

/** Lists maps whose backdrop image still belongs to a live (non-trashed) record. */
export async function listWorldMaps(db: DbOrTx, projectId: string): Promise<WorldMapSummary[]> {
  const rows = await db.worldMap.findMany({
    where: { projectId, image: { record: { trashedAt: null } } },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    include: {
      image: {
        select: {
          id: true,
          name: true,
          recordId: true,
          record: { select: { id: true, title: true, trashedAt: true } },
        },
      },
      _count: { select: { pins: true } },
    },
  });
  return rows.map((m) => ({
    id: m.id,
    title: m.title,
    imageId: m.imageId,
    imageName: m.image.name,
    hostRecordId: m.image.recordId,
    hostRecordTitle: m.image.record.title,
    pinCount: m._count.pins,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  }));
}

export async function getWorldMap(db: DbOrTx, projectId: string, mapId: string): Promise<WorldMapView> {
  if ("worldMapLayer" in db && (await db.worldMapLayer.count({ where: { mapId } })) === 0) {
    if ("$transaction" in db) {
      await (db as Db).$transaction(async (tx) => seedDefaultMapLayers(tx, projectId, mapId));
    }
  }
  const map = await db.worldMap.findFirst({
    where: { id: mapId, projectId },
    include: {
      image: {
        select: {
          id: true,
          name: true,
          width: true,
          height: true,
          recordId: true,
          record: { select: { id: true, title: true, trashedAt: true } },
        },
      },
      pins: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: {
          record: {
            select: { id: true, title: true, type: true, authorityStatus: true, trashedAt: true },
          },
          targetMap: {
            select: {
              id: true,
              title: true,
              image: { select: { record: { select: { trashedAt: true } } } },
            },
          },
        },
      },
    },
  });
  if (!map || map.image.record.trashedAt) throw new NotFoundError(`Map ${mapId} not found`);

  return {
    id: map.id,
    projectId: map.projectId,
    title: map.title,
    imageId: map.imageId,
    imageName: map.image.name,
    imageWidth: map.image.width,
    imageHeight: map.image.height,
    hostRecordId: map.image.recordId,
    hostRecordTitle: map.image.record.title,
    createdAt: map.createdAt,
    updatedAt: map.updatedAt,
    scaleLabel: map.scaleLabel ?? "",
    scaleBarLength: map.scaleBarLength ?? null,
    layers: await listWorldMapLayers(db, mapId),
    pins: map.pins.flatMap((p): WorldMapPinView[] => {
      const record = p.record;
      const linked =
        record && isRecordType(record.type) && isAuthorityStatus(record.authorityStatus)
          ? { id: record.id, title: record.title, type: record.type, authorityStatus: record.authorityStatus, trashedAt: record.trashedAt }
          : null;
      if (p.recordId && !linked) return [];
      const target = p.targetMap;
      const targetLive = Boolean(target && !target.image.record.trashedAt);
      const label = p.label.trim();
      const kind = kindOf(p.kind);
      const title = label || linked?.title || target?.title || kindFallback(kind);
      return [
        {
          id: p.id,
          mapId: p.mapId,
          recordId: linked?.id ?? null,
          targetMapId: p.targetMapId,
          targetMapTitle: target?.title ?? null,
          targetUnavailable: Boolean(p.targetMapId) && !targetLive,
          markerGroup: isMarkerGroup(p.markerGroup) ? p.markerGroup : "places",
          layerId: p.layerId,
          label: p.label,
          kind,
          points: kind === "route" || kind === "area" ? parseStoredPoints(p.points) : [],
          revision: p.revision,
          xNorm: p.xNorm,
          yNorm: p.yNorm,
          title,
          typeLabel: linked ? RECORD_TYPE_LABELS[linked.type] : "",
          authorityStatus: linked ? linked.authorityStatus : null,
          unavailable: Boolean(p.recordId) && (!record || record.trashedAt !== null),
        },
      ];
    }),
  };
}

export async function createWorldMap(
  db: Db,
  projectId: string,
  input: { title: string; imageId: string },
): Promise<WorldMapView> {
  const title = input.title.trim();
  if (!title) throw rejected("Give the map a title.");

  return db.$transaction(async (tx) => {
    const project = await tx.project.findFirst({ where: { id: projectId, trashedAt: null }, select: { id: true } });
    if (!project) throw new NotFoundError(`Project ${projectId} not found`);
    const image = await tx.recordImage.findFirst({
      where: { id: input.imageId, projectId },
      include: { record: { select: { id: true, title: true, type: true, trashedAt: true } } },
    });
    if (!image || image.record.trashedAt) throw rejected("That image is not available in this project.");
    if (!isRecordType(image.record.type) || !isLinkableReferenceType(image.record.type)) {
      throw rejected("Maps use an image from a reference document.");
    }

    const id = newId("wmp");
    await tx.worldMap.create({
      data: { id, projectId, title, imageId: image.id },
    });
    await seedDefaultMapLayers(tx, projectId, id);
    await writeAudit(tx, {
      projectId,
      action: "world_map.create",
      actor: UI_ACTOR,
      summary: `Created map "${title}" on image "${image.name}"`,
      details: { mapId: id, imageId: image.id, hostRecordId: image.recordId },
    });
    return getWorldMap(tx, projectId, id);
  });
}

/** Uploads one image and creates the map in the same transaction. A failure leaves no image. */
export async function createWorldMapWithUpload(
  db: Db,
  projectId: string,
  input: { title: string; recordId: string; confirmProtected: boolean; file: { filename: string; bytes: Uint8Array } },
): Promise<WorldMapView> {
  const title = input.title.trim();
  if (!title) throw rejected("Give the map a title.");
  const { validateImageFiles, insertRecordImagesInTx } = await import("./imageService");
  const { issues, infos } = validateImageFiles([input.file]);
  if (issues.length) throw new MutationRejectedError(issues);
  const info = infos[0];
  if (!info) throw new MutationRejectedError(issues);

  return db.$transaction(async (tx) => {
    const project = await tx.project.findFirst({ where: { id: projectId, trashedAt: null }, select: { id: true } });
    if (!project) throw new NotFoundError(`Project ${projectId} not found`);
    const created = await insertRecordImagesInTx(tx, projectId, input.recordId, [input.file], [info], {
      confirmProtected: input.confirmProtected,
    });
    const image = created[0];
    if (!image) throw rejected("That image could not be stored.");
    const id = newId("wmp");
    await tx.worldMap.create({
      data: { id, projectId, title, imageId: image.id },
    });
    await seedDefaultMapLayers(tx, projectId, id);
    await writeAudit(tx, {
      projectId,
      action: "world_map.create",
      actor: UI_ACTOR,
      summary: `Created map "${title}" on uploaded image "${image.name}"`,
      details: { mapId: id, imageId: image.id, hostRecordId: input.recordId },
    });
    return getWorldMap(tx, projectId, id);
  });
}

export async function renameWorldMap(db: Db, projectId: string, mapId: string, title: string): Promise<WorldMapView> {
  const next = title.trim();
  if (!next) throw rejected("Give the map a title.");
  return db.$transaction(async (tx) => {
    await requireLiveMap(tx, projectId, mapId);
    await tx.worldMap.update({ where: { id: mapId }, data: { title: next } });
    await writeAudit(tx, {
      projectId,
      action: "world_map.rename",
      actor: UI_ACTOR,
      summary: `Renamed map to "${next}"`,
      details: { mapId, title: next },
    });
    return getWorldMap(tx, projectId, mapId);
  });
}

export async function deleteWorldMap(db: Db, projectId: string, mapId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const map = await tx.worldMap.findFirst({ where: { id: mapId, projectId } });
    if (!map) throw new NotFoundError(`Map ${mapId} not found`);
    await detachDetailLinks(tx, [mapId], () => map.title);
    await tx.worldMapPin.deleteMany({ where: { mapId } });
    await tx.worldMap.delete({ where: { id: mapId } });
    await writeAudit(tx, {
      projectId,
      action: "world_map.delete",
      actor: UI_ACTOR,
      summary: `Deleted map "${map.title}"`,
      details: { mapId },
    });
  });
}

export async function addWorldMapPin(
  db: Db,
  projectId: string,
  mapId: string,
  input: WorldMapPinLinks & {
    xNorm: number;
    yNorm: number;
    kind?: string | null;
    points?: { x: number; y: number }[] | null;
  },
): Promise<WorldMapPinView> {
  return db.$transaction(async (tx) => {
    await requireLiveMap(tx, projectId, mapId);
    const kind = kindOf(input.kind ?? "point");
    const links = await resolvePinLinks(tx, projectId, mapId, input, kind);
    const shape = shapeForKind(kind, input.points, input.xNorm, input.yNorm);
    const id = newId("wpn");
    await tx.worldMapPin.create({
      data: {
        id,
        mapId,
        projectId,
        recordId: links.recordId,
        targetMapId: links.targetMapId,
        markerGroup: links.markerGroup,
        layerId: links.layerId,
        label: links.label,
        kind,
        points: serializePoints(shape.points),
        xNorm: shape.xNorm,
        yNorm: shape.yNorm,
      },
    });
    await tx.worldMap.update({ where: { id: mapId }, data: { updatedAt: new Date() } });
    await writeAudit(tx, {
      projectId,
      action: "world_map_pin.add",
      actor: UI_ACTOR,
      summary: `Marked "${links.summary}" on a map`,
      details: { mapId, pinId: id, recordId: links.recordId, targetMapId: links.targetMapId, kind, xNorm: shape.xNorm, yNorm: shape.yNorm, pointCount: shape.points.length },
    });
    const view = await getWorldMap(tx, projectId, mapId);
    return view.pins.find((p) => p.id === id)!;
  });
}

/** Changes what a marker opens. Geometry stays put. */
export async function updateWorldMapPin(
  db: Db,
  projectId: string,
  mapId: string,
  pinId: string,
  input: WorldMapPinLinks,
): Promise<WorldMapPinView> {
  return db.$transaction(async (tx) => {
    await requireLiveMap(tx, projectId, mapId);
    const pin = await tx.worldMapPin.findFirst({ where: { id: pinId, mapId, projectId } });
    if (!pin) throw rejected("That pin is not on this map.");
    if (typeof input.expectedRevision === "number" && input.expectedRevision !== pin.revision) throw staleMarker();
    const links = await resolvePinLinks(tx, projectId, mapId, input, kindOf(pin.kind));
    await tx.worldMapPin.update({
      where: { id: pinId },
      data: {
        recordId: links.recordId,
        targetMapId: links.targetMapId,
        markerGroup: links.markerGroup,
        layerId: links.layerId,
        label: links.label,
        revision: { increment: 1 },
      },
    });
    await tx.worldMap.update({ where: { id: mapId }, data: { updatedAt: new Date() } });
    await writeAudit(tx, {
      projectId,
      action: "world_map_pin.update",
      actor: UI_ACTOR,
      summary: `Updated marker "${links.summary}"`,
      details: { mapId, pinId, recordId: links.recordId, targetMapId: links.targetMapId },
    });
    const view = await getWorldMap(tx, projectId, mapId);
    const found = view.pins.find((p) => p.id === pinId);
    if (!found) throw rejected("That pin is not on this map.");
    return found;
  });
}

/** Repositions a point or a label. Never creates or changes PlaceRelation rows. */
export async function moveWorldMapPin(
  db: Db,
  projectId: string,
  mapId: string,
  pinId: string,
  input: { xNorm: number; yNorm: number; expectedRevision?: number | null },
): Promise<WorldMapPinView> {
  return db.$transaction(async (tx) => {
    await requireLiveMap(tx, projectId, mapId);
    const pin = await tx.worldMapPin.findFirst({ where: { id: pinId, mapId, projectId } });
    if (!pin) throw rejected("That pin is not on this map.");
    const kind = kindOf(pin.kind);
    if (kind === "route" || kind === "area") throw rejected("Edit the path to move a route or an area.");
    if (typeof input.expectedRevision === "number" && input.expectedRevision !== pin.revision) throw staleMarker();
    const xNorm = clampNorm(input.xNorm);
    const yNorm = clampNorm(input.yNorm);
    await tx.worldMapPin.update({ where: { id: pinId }, data: { xNorm, yNorm, revision: { increment: 1 } } });
    await tx.worldMap.update({ where: { id: mapId }, data: { updatedAt: new Date() } });
    await writeAudit(tx, {
      projectId,
      action: "world_map_pin.move",
      actor: UI_ACTOR,
      summary: `Moved a map pin`,
      details: { mapId, pinId, xNorm, yNorm },
    });
    const view = await getWorldMap(tx, projectId, mapId);
    const found = view.pins.find((p) => p.id === pinId);
    if (!found) throw rejected("That pin is not on this map.");
    return found;
  });
}

/** Replaces a marker's geometry. Refuses the write when expectedRevision is stale. */
export async function setWorldMapPinGeometry(
  db: Db,
  projectId: string,
  mapId: string,
  pinId: string,
  input: { expectedRevision: number; points: { x: number; y: number }[] },
): Promise<WorldMapPinView> {
  return db.$transaction(async (tx) => {
    await requireLiveMap(tx, projectId, mapId);
    const pin = await tx.worldMapPin.findFirst({ where: { id: pinId, mapId, projectId } });
    if (!pin) throw rejected("That pin is not on this map.");
    if (pin.revision !== input.expectedRevision) throw staleMarker();
    const kind = kindOf(pin.kind);
    const normalized = normalizeShape(kind, input.points);
    if (!normalized.ok) throw rejected(normalized.message);
    const stored = kind === "route" || kind === "area" ? normalized.points : [];
    const anchor = normalized.points[0]!;
    await tx.worldMapPin.update({
      where: { id: pinId },
      data: {
        points: serializePoints(stored),
        xNorm: anchor.x,
        yNorm: anchor.y,
        revision: { increment: 1 },
      },
    });
    await tx.worldMap.update({ where: { id: mapId }, data: { updatedAt: new Date() } });
    await writeAudit(tx, {
      projectId,
      action: "world_map_pin.geometry",
      actor: UI_ACTOR,
      summary: `Updated a map ${kind}`,
      details: { mapId, pinId, kind, pointCount: normalized.points.length },
    });
    const view = await getWorldMap(tx, projectId, mapId);
    const found = view.pins.find((p) => p.id === pinId);
    if (!found) throw rejected("That pin is not on this map.");
    return found;
  });
}

/** Removes the marker from this map only; does not change the linked record or any PlaceRelation. */
export async function removeWorldMapPin(
  db: Db,
  projectId: string,
  mapId: string,
  pinId: string,
  expectedRevision?: number,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await requireLiveMap(tx, projectId, mapId);
    const pin = await tx.worldMapPin.findFirst({ where: { id: pinId, mapId, projectId } });
    if (!pin) throw rejected("That pin is not on this map.");
    if (typeof expectedRevision === "number" && expectedRevision !== pin.revision) throw staleMarker();
    await tx.worldMapPin.delete({ where: { id: pinId } });
    await tx.worldMap.update({ where: { id: mapId }, data: { updatedAt: new Date() } });
    await writeAudit(tx, {
      projectId,
      action: "world_map_pin.remove",
      actor: UI_ACTOR,
      summary: `Removed a map pin`,
      details: { mapId, pinId, recordId: pin.recordId },
    });
  });
}

/** Deletes every map that uses this image (and their pins). Called before image row delete. */
export async function deleteMapsForImageInTx(tx: Tx, projectId: string, imageId: string): Promise<string[]> {
  const maps = await tx.worldMap.findMany({ where: { projectId, imageId }, select: { id: true, title: true } });
  const titles = new Map(maps.map((m) => [m.id, m.title]));
  await detachDetailLinks(tx, maps.map((m) => m.id), (id) => titles.get(id) ?? "Map");
  for (const m of maps) {
    await tx.worldMapPin.deleteMany({ where: { mapId: m.id } });
    await tx.worldMap.delete({ where: { id: m.id } });
    await writeAudit(tx, {
      projectId,
      action: "world_map.delete",
      actor: UI_ACTOR,
      summary: `Deleted map "${m.title}" because its image was removed`,
      details: { mapId: m.id, imageId, reason: "image_removed" },
    });
  }
  return maps.map((m) => m.id);
}

async function requireLiveMap(tx: Tx, projectId: string, mapId: string) {
  const map = await tx.worldMap.findFirst({
    where: { id: mapId, projectId },
    include: { image: { include: { record: { select: { trashedAt: true } } } } },
  });
  if (!map || map.image.record.trashedAt) throw new NotFoundError(`Map ${mapId} not found`);
  return map;
}

async function detachDetailLinks(tx: Tx, mapIds: string[], titleFor: (mapId: string) => string) {
  if (!mapIds.length) return;
  const pins = await tx.worldMapPin.findMany({ where: { targetMapId: { in: mapIds } } });
  for (const pin of pins) {
    if (!pin.targetMapId) continue;
    await tx.worldMapPin.update({
      where: { id: pin.id },
      data: {
        targetMapId: null,
        label: pin.label.trim() || titleFor(pin.targetMapId),
        revision: { increment: 1 },
      },
    });
  }
}

function shapeForKind(
  kind: MarkerKind,
  points: { x: number; y: number }[] | null | undefined,
  xNorm: number,
  yNorm: number,
): { points: NormPoint[]; xNorm: number; yNorm: number } {
  if (kind === "route" || kind === "area") {
    const normalized = normalizeShape(kind, points ?? []);
    if (!normalized.ok) throw rejected(normalized.message);
    return { points: normalized.points, xNorm: normalized.points[0]!.x, yNorm: normalized.points[0]!.y };
  }
  return { points: [], xNorm: clampNorm(xNorm), yNorm: clampNorm(yNorm) };
}

async function resolvePinLinks(tx: Tx, projectId: string, mapId: string, input: WorldMapPinLinks, kind: MarkerKind) {
  const recordId = input.recordId?.trim() || null;
  const targetMapId = input.targetMapId?.trim() || null;
  const label = (input.label ?? "").trim().slice(0, 120);
  if (kind === "point" && !recordId && !targetMapId) throw rejected("Link a reference, a detailed map, or both.");
  if (kind === "label" && !label) throw rejected("Enter the label text.");
  if (targetMapId === mapId) throw rejected("A marker cannot open the map it is already on.");
  const resolvedLayer = await resolveLayerForWrite(tx, mapId, input.layerId, input.markerGroup);
  let recordTitle = "";
  if (recordId) {
    const record = await tx.record.findFirst({
      where: { id: recordId, projectId, trashedAt: null },
      select: { id: true, title: true, type: true },
    });
    if (!record) throw rejected("That place is not in this project.", recordId);
    if (!isRecordType(record.type) || !isLinkableReferenceType(record.type)) {
      throw rejected("Only reference records can be pinned on a map.", recordId);
    }
    recordTitle = record.title;
  }
  let mapTitle = "";
  if (targetMapId) {
    const target = await requireLiveMap(tx, projectId, targetMapId);
    mapTitle = target.title;
  }
  return {
    recordId,
    targetMapId,
    markerGroup: resolvedLayer.markerGroup,
    layerId: resolvedLayer.layerId,
    label,
    summary: [recordTitle, mapTitle, label].filter(Boolean).join(" · ") || "marker",
  };
}

export async function updateWorldMapScale(
  db: Db,
  projectId: string,
  mapId: string,
  input: { scaleLabel: string; scaleBarLength: number | null },
): Promise<WorldMapView> {
  const scaleLabel = input.scaleLabel.trim().slice(0, 120);
  const scaleBarLength =
    input.scaleBarLength == null
      ? null
      : Number.isFinite(input.scaleBarLength)
        ? Math.min(1, Math.max(0.02, input.scaleBarLength))
        : null;
  if (scaleLabel && scaleBarLength == null) throw rejected("Set a bar length when you add a scale label.");
  return db.$transaction(async (tx) => {
    await requireLiveMap(tx, projectId, mapId);
    await tx.worldMap.update({
      where: { id: mapId },
      data: { scaleLabel, scaleBarLength },
    });
    await writeAudit(tx, {
      projectId,
      action: "world_map.scale",
      actor: UI_ACTOR,
      summary: scaleLabel ? `Set map scale to "${scaleLabel}"` : "Cleared the map scale",
      details: { mapId, scaleLabel, scaleBarLength },
    });
    return getWorldMap(tx, projectId, mapId);
  });
}

export async function saveWorldMapLayers(
  db: Db,
  projectId: string,
  mapId: string,
  layers: readonly { id?: string; title: string }[],
): Promise<WorldMapView> {
  const { validateLayerTitles } = await import("./worldMapLayerService");
  const normalized = validateLayerTitles(layers);
  return db.$transaction(async (tx) => {
    await requireLiveMap(tx, projectId, mapId);
    const existing = await tx.worldMapPin.findMany({ where: { mapId, projectId }, select: { id: true, layerId: true } });
    const oldLayers = await listWorldMapLayers(tx, mapId);
    await tx.worldMapLayer.deleteMany({ where: { mapId } });
    const created: WorldMapLayerView[] = [];
    for (const [index, row] of normalized.entries()) {
      const legacy = oldLayers.find((layer) => layer.position === index + 1)?.legacyGroup ?? null;
      const id = newId("wmly");
      await tx.worldMapLayer.create({
        data: {
          id,
          mapId,
          projectId,
          position: index + 1,
          title: row.title,
          legacyGroup: legacy,
        },
      });
      created.push({ id, mapId, position: index + 1, title: row.title, legacyGroup: legacy });
    }
    const fallbackId = created[0]?.id ?? null;
    for (const pin of existing) {
      const still = created.find((layer) => layer.id === pin.layerId);
      await tx.worldMapPin.update({
        where: { id: pin.id },
        data: { layerId: still?.id ?? fallbackId },
      });
    }
    await tx.worldMap.update({ where: { id: mapId }, data: { updatedAt: new Date() } });
    await writeAudit(tx, {
      projectId,
      action: "world_map.layers",
      actor: UI_ACTOR,
      summary: `Updated layers on a map`,
      details: { mapId, layerCount: created.length },
    });
    return getWorldMap(tx, projectId, mapId);
  });
}
