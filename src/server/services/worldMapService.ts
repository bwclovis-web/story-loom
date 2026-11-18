import { newId } from "@/domain/ids";
import { errorIssue } from "@/domain/issues";
import { isLinkableReferenceType, isRecordType, RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import { isAuthorityStatus, type AuthorityStatus } from "@/domain/statuses";
import type { Db, DbOrTx, Tx } from "../db";
import { writeAudit } from "./auditService";
import { MutationRejectedError, NotFoundError } from "./errors";

/*
 * World maps: an existing RecordImage as backdrop with pins to World records.
 * Pin xNorm/yNorm are fractions of image width/height (0–1) so alignment survives
 * resize. Several maps may pin the same place. Moving pins never creates or
 * changes PlaceRelation rows.
 *
 * Trash:
 * - Soft-trashed image host record → map omitted from lists / NotFound on open.
 * - Soft-trashed pin target → pin kept but marked unavailable (not opened in rail).
 * - Permanent image delete → maps using that image are deleted (with pins).
 * - Permanent record delete → pins for that record are deleted.
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
  recordId: string;
  xNorm: number;
  yNorm: number;
  title: string;
  typeLabel: string;
  authorityStatus: AuthorityStatus;
  /** True when the linked record is in the Trash (pin kept until permanent delete). */
  unavailable: boolean;
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
  pins: WorldMapPinView[];
}

function rejected(message: string, recordId?: string): MutationRejectedError {
  return new MutationRejectedError([errorIssue("INVALID_REFERENCE", message, recordId ? { recordId } : {})]);
}

function clampNorm(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
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
    pins: map.pins.flatMap((p) => {
      if (!isRecordType(p.record.type) || !isAuthorityStatus(p.record.authorityStatus)) return [];
      return [
        {
          id: p.id,
          mapId: p.mapId,
          recordId: p.recordId,
          xNorm: p.xNorm,
          yNorm: p.yNorm,
          title: p.record.title,
          typeLabel: RECORD_TYPE_LABELS[p.record.type],
          authorityStatus: p.record.authorityStatus,
          unavailable: p.record.trashedAt !== null,
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
  input: { recordId: string; xNorm: number; yNorm: number },
): Promise<WorldMapPinView> {
  return db.$transaction(async (tx) => {
    await requireLiveMap(tx, projectId, mapId);
    const record = await tx.record.findFirst({
      where: { id: input.recordId, projectId, trashedAt: null },
      select: { id: true, title: true, type: true, authorityStatus: true },
    });
    if (!record) throw rejected("That place is not in this project.", input.recordId);
    if (!isRecordType(record.type) || !isLinkableReferenceType(record.type)) {
      throw rejected("Only reference records can be pinned on a map.", input.recordId);
    }
    const id = newId("wpn");
    const xNorm = clampNorm(input.xNorm);
    const yNorm = clampNorm(input.yNorm);
    await tx.worldMapPin.create({
      data: { id, mapId, projectId, recordId: record.id, xNorm, yNorm },
    });
    await tx.worldMap.update({ where: { id: mapId }, data: { updatedAt: new Date() } });
    await writeAudit(tx, {
      projectId,
      action: "world_map_pin.add",
      actor: UI_ACTOR,
      summary: `Pinned "${record.title}" on a map`,
      details: { mapId, pinId: id, recordId: record.id, xNorm, yNorm },
    });
    const view = await getWorldMap(tx, projectId, mapId);
    return view.pins.find((p) => p.id === id)!;
  });
}

/** Repositions a pin. Never creates or changes PlaceRelation rows. */
export async function moveWorldMapPin(
  db: Db,
  projectId: string,
  mapId: string,
  pinId: string,
  input: { xNorm: number; yNorm: number },
): Promise<WorldMapPinView> {
  return db.$transaction(async (tx) => {
    await requireLiveMap(tx, projectId, mapId);
    const pin = await tx.worldMapPin.findFirst({ where: { id: pinId, mapId, projectId } });
    if (!pin) throw rejected("That pin is not on this map.");
    const xNorm = clampNorm(input.xNorm);
    const yNorm = clampNorm(input.yNorm);
    await tx.worldMapPin.update({ where: { id: pinId }, data: { xNorm, yNorm } });
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

/** Removes the pin from this map only; does not change the linked record or any PlaceRelation. */
export async function removeWorldMapPin(db: Db, projectId: string, mapId: string, pinId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await requireLiveMap(tx, projectId, mapId);
    const pin = await tx.worldMapPin.findFirst({ where: { id: pinId, mapId, projectId } });
    if (!pin) throw rejected("That pin is not on this map.");
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
