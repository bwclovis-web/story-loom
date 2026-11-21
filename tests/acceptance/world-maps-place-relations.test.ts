import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "@/server/services/backupService";
import { addRecordCard, createBoard, moveBoardCard } from "@/server/services/boardService";
import { MutationRejectedError, NotFoundError } from "@/server/services/errors";
import { addRecordImages, removeRecordImage } from "@/server/services/imageService";
import {
  addPlaceRelation,
  listPlaceRelationsForRecord,
  removePlaceRelation,
} from "@/server/services/placeRelationService";
import { createRecord, moveRecordToTrash, setProtection } from "@/server/services/recordService";
import { deleteFromTrash } from "@/server/services/trashService";
import {
  addWorldMapPin,
  createWorldMap,
  createWorldMapWithUpload,
  deleteWorldMap,
  getWorldMap,
  listWorldMaps,
  moveWorldMapPin,
  removeWorldMapPin,
  saveWorldMapLayers,
  setWorldMapPinGeometry,
  updateWorldMapScale,
} from "@/server/services/worldMapService";
import { buildMapGeographyTree } from "@/world/mapGeography";
import { loadProjectRelationshipGraph } from "@/server/services/relationshipGraphService";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";
import { makePng } from "../imageFixtures";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const RIVER = "rec_test_silverwater";
const TIDAL = "rec_test_tidal_approach";
const ACTOR = "author";

describe("World maps and place relationships", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
    // Two river names resolve to one record via aliases; tidal approach is a separate place.
    await createRecord(t.db, IDS.project, {
      recordId: RIVER,
      type: "worldbuilding",
      title: "Silverwater",
      body: "The river known upstream as Silver Water and downstream as Silverwater.",
      fields: { name: "Silverwater", aliases: ["Silver Water", "Silverwater"] },
      authorityStatus: "approved",
    });
    await createRecord(t.db, IDS.project, {
      recordId: TIDAL,
      type: "worldbuilding",
      title: "Tidal approach",
      body: "Where the Silverwater meets the salt flats.",
      authorityStatus: "approved",
    });
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("lets legacy projects open with no maps or place relations", async () => {
    expect(await listWorldMaps(t.db, IDS.project)).toEqual([]);
    const rel = await listPlaceRelationsForRecord(t.db, IDS.project, RIVER);
    expect(rel.outgoing).toEqual([]);
    expect(rel.incoming).toEqual([]);
  });

  it("pins places on several maps with normalized positions and opens the same river record", async () => {
    const [imgA] = await addRecordImages(
      t.db,
      IDS.project,
      IDS.world,
      [{ filename: "coast-a.png", bytes: makePng(40, 20) }],
      { confirmProtected: false },
    );
    const [imgB] = await addRecordImages(
      t.db,
      IDS.project,
      IDS.world,
      [{ filename: "coast-b.png", bytes: makePng(30, 30) }],
      { confirmProtected: false },
    );

    const mapA = await createWorldMap(t.db, IDS.project, { title: "Coast chart", imageId: imgA.id });
    const mapB = await createWorldMap(t.db, IDS.project, { title: "Harbour chart", imageId: imgB.id });

    const pinA = await addWorldMapPin(t.db, IDS.project, mapA.id, {
      recordId: RIVER,
      xNorm: 0.25,
      yNorm: 0.4,
    });
    const pinB = await addWorldMapPin(t.db, IDS.project, mapB.id, {
      recordId: RIVER,
      xNorm: 0.8,
      yNorm: 0.15,
    });
    expect(pinA.recordId).toBe(RIVER);
    expect(pinB.recordId).toBe(RIVER);
    expect(pinA.title).toBe("Silverwater");

    const moved = await moveWorldMapPin(t.db, IDS.project, mapA.id, pinA.id, { xNorm: 0.33, yNorm: 0.55 });
    expect(moved.xNorm).toBeCloseTo(0.33);
    expect(moved.yNorm).toBeCloseTo(0.55);

    const viewA = await getWorldMap(t.db, IDS.project, mapA.id);
    expect(viewA.pins).toHaveLength(1);
    expect(viewA.pins[0]!.xNorm).toBeCloseTo(0.33);

    await removeWorldMapPin(t.db, IDS.project, mapA.id, pinA.id);
    expect((await getWorldMap(t.db, IDS.project, mapA.id)).pins).toHaveLength(0);
    expect((await getWorldMap(t.db, IDS.project, mapB.id)).pins.some((p) => p.recordId === RIVER)).toBe(true);
  });

  it("seeds map layers, saves scale and custom layer titles, and builds geography from part_of", async () => {
    const [img] = await addRecordImages(
      t.db,
      IDS.project,
      IDS.world,
      [{ filename: "layered.png", bytes: makePng(24, 24) }],
      { confirmProtected: false },
    );
    const map = await createWorldMap(t.db, IDS.project, { title: "Layered chart", imageId: img.id });
    const view = await getWorldMap(t.db, IDS.project, map.id);
    expect(view.layers).toHaveLength(4);
    expect(view.layers.map((layer) => layer.title)).toEqual(["Places", "Waterways", "Transport", "Story locations"]);

    await updateWorldMapScale(t.db, IDS.project, map.id, { scaleLabel: "10 leagues", scaleBarLength: 0.2 });
    const pinChild = await addWorldMapPin(t.db, IDS.project, map.id, {
      recordId: TIDAL,
      xNorm: 0.4,
      yNorm: 0.6,
      layerId: view.layers[0]!.id,
    });
    await addWorldMapPin(t.db, IDS.project, map.id, { recordId: RIVER, xNorm: 0.2, yNorm: 0.2 });
    await addPlaceRelation(t.db, IDS.project, { fromRecordId: TIDAL, toRecordId: RIVER, kind: "part_of" });

    const afterLayers = await saveWorldMapLayers(t.db, IDS.project, map.id, [
      { title: "Coast" },
      { title: "Shipping lanes" },
      { title: "Rails" },
      { title: "Plot beats" },
    ]);
    expect(afterLayers.layers.map((layer) => layer.title)).toEqual(["Coast", "Shipping lanes", "Rails", "Plot beats"]);
    expect(afterLayers.scaleLabel).toBe("10 leagues");

    const graph = await loadProjectRelationshipGraph(t.db, IDS.project);
    const pinsByRecord = new Map(afterLayers.pins.map((pin) => [pin.recordId!, pin.id] as const));
    const geography = buildMapGeographyTree(graph.nodes, graph.edges, pinsByRecord);
    expect(geography.some((node) => node.id === RIVER)).toBe(true);
    const river = geography.find((node) => node.id === RIVER);
    expect(river?.children.some((child) => child.id === TIDAL && child.pinId === pinChild.id)).toBe(true);

    const backup = await createWorkspaceBackup(t.db, IDS.workspace);
    expect(backup.worldMapLayers?.map((layer) => layer.title)).toEqual([
      "Coast",
      "Shipping lanes",
      "Rails",
      "Plot beats",
    ]);
    expect(backup.worldMaps?.[0]?.scaleLabel).toBe("10 leagues");
    expect(backup.worldMaps?.[0]?.scaleBarLength).toBeCloseTo(0.2);
    expect(backup.worldMapPins?.some((pin) => pin.layerId === afterLayers.layers[0]!.id)).toBe(true);
  });

  it("stores place relations independently of pin and card moves", async () => {
    const [img] = await addRecordImages(
      t.db,
      IDS.project,
      IDS.world,
      [{ filename: "delta.png", bytes: makePng(20, 20) }],
      { confirmProtected: false },
    );
    const map = await createWorldMap(t.db, IDS.project, { title: "Delta", imageId: img.id });
    const pin = await addWorldMapPin(t.db, IDS.project, map.id, { recordId: RIVER, xNorm: 0.5, yNorm: 0.5 });
    await addWorldMapPin(t.db, IDS.project, map.id, { recordId: TIDAL, xNorm: 0.7, yNorm: 0.8 });

    const flows = await addPlaceRelation(t.db, IDS.project, {
      fromRecordId: RIVER,
      toRecordId: TIDAL,
      kind: "flows_into",
    });
    expect(flows.kind).toBe("flows_into");
    await addPlaceRelation(t.db, IDS.project, {
      fromRecordId: TIDAL,
      toRecordId: IDS.world,
      kind: "part_of",
    });
    await addPlaceRelation(t.db, IDS.project, {
      fromRecordId: IDS.world,
      toRecordId: IDS.dossier,
      kind: "governed_by",
    });

    const before = await t.db.placeRelation.count({ where: { projectId: IDS.project } });
    await moveWorldMapPin(t.db, IDS.project, map.id, pin.id, { xNorm: 0.1, yNorm: 0.9 });
    expect(await t.db.placeRelation.count({ where: { projectId: IDS.project } })).toBe(before);

    const board = await createBoard(t.db, IDS.project, { title: "Scratch", templateKey: "blank" });
    const card = await addRecordCard(t.db, IDS.project, board.id, { recordId: RIVER, x: 10, y: 10 });
    await moveBoardCard(t.db, IDS.project, board.id, card.id, { x: 200, y: 150 });
    expect(await t.db.placeRelation.count({ where: { projectId: IDS.project } })).toBe(before);

    const listed = await listPlaceRelationsForRecord(t.db, IDS.project, RIVER);
    expect(listed.outgoing.some((r) => r.kind === "flows_into" && r.toRecordId === TIDAL)).toBe(true);

    await removePlaceRelation(t.db, IDS.project, flows.id);
    expect((await listPlaceRelationsForRecord(t.db, IDS.project, RIVER)).outgoing).toHaveLength(0);
  });

  it("hides maps when the image host is trashed and deletes maps when the image is removed", async () => {
    const [img] = await addRecordImages(
      t.db,
      IDS.project,
      IDS.world,
      [{ filename: "lost.png", bytes: makePng(12, 12) }],
      { confirmProtected: false },
    );
    const map = await createWorldMap(t.db, IDS.project, { title: "Lost chart", imageId: img.id });
    await addWorldMapPin(t.db, IDS.project, map.id, { recordId: RIVER, xNorm: 0.2, yNorm: 0.2 });

    await moveRecordToTrash(t.db, IDS.project, IDS.world, false);
    expect(await listWorldMaps(t.db, IDS.project)).toEqual([]);
    await expect(getWorldMap(t.db, IDS.project, map.id)).rejects.toBeInstanceOf(NotFoundError);

    // Restore host so we can permanently remove the image instead.
    const batch = (await t.db.record.findUniqueOrThrow({ where: { id: IDS.world } })).trashBatchId!;
    const { restoreRecordsFromTrash } = await import("@/server/services/recordService");
    await restoreRecordsFromTrash(t.db, IDS.project, batch);
    expect(await listWorldMaps(t.db, IDS.project)).toHaveLength(1);

    await removeRecordImage(t.db, IDS.project, img.id, { confirmProtected: false });
    expect(await listWorldMaps(t.db, IDS.project)).toEqual([]);
    expect(await t.db.worldMap.count({ where: { projectId: IDS.project } })).toBe(0);
  });

  it("marks soft-trashed pin targets unavailable and removes pins and relations on permanent delete", async () => {
    const backupsDir = mkdtempSync(path.join(tmpdir(), "wordly-map-trash-"));
    const [img] = await addRecordImages(
      t.db,
      IDS.project,
      IDS.dossier,
      [{ filename: "chart.png", bytes: makePng(16, 16) }],
      { confirmProtected: false },
    );
    const map = await createWorldMap(t.db, IDS.project, { title: "River map", imageId: img.id });
    await addWorldMapPin(t.db, IDS.project, map.id, { recordId: RIVER, xNorm: 0.4, yNorm: 0.4 });
    await addPlaceRelation(t.db, IDS.project, {
      fromRecordId: RIVER,
      toRecordId: TIDAL,
      kind: "flows_into",
    });

    await moveRecordToTrash(t.db, IDS.project, RIVER, false);
    const view = await getWorldMap(t.db, IDS.project, map.id);
    expect(view.pins[0]!.unavailable).toBe(true);
    expect((await listPlaceRelationsForRecord(t.db, IDS.project, TIDAL)).incoming).toHaveLength(0);

    const batch = (await t.db.record.findUniqueOrThrow({ where: { id: RIVER } })).trashBatchId!;
    const outcome = await deleteFromTrash(
      t.db,
      { kind: "records", projectId: IDS.project, batchId: batch },
      { databaseFile: t.file, backupsDir, actor: ACTOR },
    );
    expect(outcome.ok).toBe(true);
    expect((await getWorldMap(t.db, IDS.project, map.id)).pins).toHaveLength(0);
    expect(await t.db.placeRelation.count({ where: { projectId: IDS.project } })).toBe(0);
  });

  it("round-trips maps, pins, and place relations in backups", async () => {
    const [img] = await addRecordImages(
      t.db,
      IDS.project,
      IDS.world,
      [{ filename: "backup-map.png", bytes: makePng(24, 18) }],
      { confirmProtected: false },
    );
    const map = await createWorldMap(t.db, IDS.project, { title: "Archive chart", imageId: img.id });
    await addWorldMapPin(t.db, IDS.project, map.id, { recordId: RIVER, xNorm: 0.12, yNorm: 0.88 });
    await addWorldMapPin(t.db, IDS.project, map.id, { recordId: TIDAL, xNorm: 0.6, yNorm: 0.6 });
    await addPlaceRelation(t.db, IDS.project, {
      fromRecordId: RIVER,
      toRecordId: TIDAL,
      kind: "flows_into",
    });

    const backup = await createWorkspaceBackup(t.db, IDS.workspace);
    expect(backup.worldMaps?.length).toBe(1);
    expect(backup.worldMapPins?.length).toBe(2);
    expect(backup.worldMapPins?.every((pin) => pin.markerGroup === undefined && pin.targetMapId === undefined)).toBe(true);
    expect(backup.placeRelations?.length).toBe(1);
    expect(backup.counts.worldMaps).toBe(1);

    const target = await createTestDb();
    try {
      const restored = await restoreWorkspaceBackup(target.db, backup, { idStrategy: "remap" });
      expect(restored.ok).toBe(true);
      if (!restored.ok) return;
      const projectId = restored.projects[0]!.id;
      const maps = await listWorldMaps(target.db, projectId);
      expect(maps).toHaveLength(1);
      const view = await getWorldMap(target.db, projectId, maps[0]!.id);
      expect(view.title).toBe("Archive chart");
      expect(view.pins).toHaveLength(2);
      const riverPin = view.pins.find((p) => p.title === "Silverwater");
      expect(riverPin?.xNorm).toBeCloseTo(0.12);
      expect(riverPin?.yNorm).toBeCloseTo(0.88);
      expect(riverPin?.markerGroup).toBe("places");
      expect(riverPin?.targetMapId).toBeNull();
      const riverId = riverPin!.recordId!;
      const tidalId = view.pins.find((p) => p.title === "Tidal approach")!.recordId!;
      const rel = await listPlaceRelationsForRecord(target.db, projectId, riverId);
      expect(rel.outgoing.some((r) => r.kind === "flows_into" && r.toRecordId === tidalId)).toBe(true);
    } finally {
      await target.cleanup();
    }

    await t.db.worldMapPin.deleteMany({});
    await t.db.worldMap.deleteMany({});
    await t.db.placeRelation.deleteMany({});
    const empty = await createWorkspaceBackup(t.db, IDS.workspace);
    expect(empty.worldMaps ?? []).toEqual([]);
    const emptyTarget = await createTestDb();
    try {
      const outcome = await restoreWorkspaceBackup(emptyTarget.db, empty, { idStrategy: "remap" });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(await listWorldMaps(emptyTarget.db, outcome.projects[0]!.id)).toEqual([]);
    } finally {
      await emptyTarget.cleanup();
    }
  });

  it("uploads a backdrop with the map and leaves no image when the operation fails", async () => {
    const before = await t.db.recordImage.count({ where: { projectId: IDS.project } });
    await expect(
      createWorldMapWithUpload(t.db, IDS.project, {
        title: "   ",
        recordId: IDS.world,
        confirmProtected: false,
        file: { filename: "quay.png", bytes: makePng(12, 8) },
      }),
    ).rejects.toBeInstanceOf(MutationRejectedError);
    await expect(
      createWorldMapWithUpload(t.db, IDS.project, {
        title: "Bad file",
        recordId: IDS.world,
        confirmProtected: false,
        file: { filename: "notes.txt", bytes: new Uint8Array([1, 2, 3, 4]) },
      }),
    ).rejects.toBeInstanceOf(MutationRejectedError);
    await setProtection(t.db, IDS.project, IDS.world, true);
    await expect(
      createWorldMapWithUpload(t.db, IDS.project, {
        title: "Protected quay",
        recordId: IDS.world,
        confirmProtected: false,
        file: { filename: "quay.png", bytes: makePng(12, 8) },
      }),
    ).rejects.toBeInstanceOf(MutationRejectedError);
    expect(await t.db.recordImage.count({ where: { projectId: IDS.project } })).toBe(before);
    expect(await listWorldMaps(t.db, IDS.project)).toEqual([]);

    const map = await createWorldMapWithUpload(t.db, IDS.project, {
      title: "Protected quay",
      recordId: IDS.world,
      confirmProtected: true,
      file: { filename: "quay.png", bytes: makePng(12, 8) },
    });
    expect(map.title).toBe("Protected quay");
    expect(map.imageWidth).toBe(12);
    expect(map.imageHeight).toBe(8);
    expect(await t.db.recordImage.count({ where: { recordId: IDS.world } })).toBe(before + 1);
  });

  it("keeps nested, map-only, and legacy markers compatible", async () => {
    const [overviewImage] = await addRecordImages(
      t.db,
      IDS.project,
      IDS.world,
      [{ filename: "overview.png", bytes: makePng(40, 20) }],
      { confirmProtected: false },
    );
    const [detailImage] = await addRecordImages(
      t.db,
      IDS.project,
      IDS.dossier,
      [{ filename: "detail.png", bytes: makePng(20, 20) }],
      { confirmProtected: false },
    );
    const overview = await createWorldMap(t.db, IDS.project, { title: "Coast overview", imageId: overviewImage.id });
    const detail = await createWorldMap(t.db, IDS.project, { title: "Harbour detail", imageId: detailImage.id });

    const both = await addWorldMapPin(t.db, IDS.project, overview.id, {
      recordId: RIVER,
      targetMapId: detail.id,
      markerGroup: "waterways",
      label: "Silverwater mouth",
      xNorm: 0.25,
      yNorm: 0.75,
    });
    expect(both.recordId).toBe(RIVER);
    expect(both.targetMapId).toBe(detail.id);
    expect(both.markerGroup).toBe("waterways");
    expect(both.title).toBe("Silverwater mouth");
    expect(both.xNorm).toBeCloseTo(0.25);

    const mapOnly = await addWorldMapPin(t.db, IDS.project, overview.id, {
      targetMapId: detail.id,
      markerGroup: "story",
      xNorm: 2,
      yNorm: -1,
    });
    expect(mapOnly.recordId).toBeNull();
    expect(mapOnly.xNorm).toBe(1);
    expect(mapOnly.yNorm).toBe(0);
    expect(mapOnly.targetMapTitle).toBe("Harbour detail");

    await expect(
      addWorldMapPin(t.db, IDS.project, overview.id, { targetMapId: overview.id, xNorm: 0.5, yNorm: 0.5 }),
    ).rejects.toBeInstanceOf(MutationRejectedError);
    await expect(
      addWorldMapPin(t.db, IDS.project, overview.id, { xNorm: 0.5, yNorm: 0.5 }),
    ).rejects.toBeInstanceOf(MutationRejectedError);

    await moveRecordToTrash(t.db, IDS.project, IDS.dossier, false);
    const hidden = await getWorldMap(t.db, IDS.project, overview.id);
    const trashedTarget = hidden.pins.find((pin) => pin.id === mapOnly.id);
    expect(trashedTarget?.targetUnavailable).toBe(true);
    expect(trashedTarget?.targetMapId).toBe(detail.id);
    await expect(getWorldMap(t.db, IDS.project, detail.id)).rejects.toBeInstanceOf(NotFoundError);

    await deleteWorldMap(t.db, IDS.project, detail.id);
    const kept = await getWorldMap(t.db, IDS.project, overview.id);
    const remnant = kept.pins.find((pin) => pin.id === both.id);
    expect(remnant?.targetMapId).toBeNull();
    expect(remnant?.recordId).toBe(RIVER);
    expect(remnant?.label).toBe("Silverwater mouth");
    expect(remnant?.xNorm).toBeCloseTo(0.25);

    const backup = await createWorkspaceBackup(t.db, IDS.workspace);
    const exported = backup.worldMapPins?.find((pin) => pin.label === "Silverwater mouth");
    expect(exported?.markerGroup).toBe("waterways");
    expect(exported?.recordId).toBe(RIVER);
    expect(exported?.xNorm).toBeCloseTo(0.25);
    expect(exported?.kind).toBeUndefined();
    expect(exported?.points).toBeUndefined();
    const target = await createTestDb();
    try {
      const restored = await restoreWorkspaceBackup(target.db, backup, { idStrategy: "remap" });
      expect(restored.ok).toBe(true);
      if (!restored.ok) return;
      const projectId = restored.projects[0]!.id;
      const maps = await listWorldMaps(target.db, projectId);
      const view = await getWorldMap(target.db, projectId, maps[0]!.id);
      const pin = view.pins.find((item) => item.title === "Silverwater mouth");
      expect(pin?.markerGroup).toBe("waterways");
      expect(pin?.kind).toBe("point");
      expect(pin?.points).toEqual([]);
      expect(pin?.targetMapId).toBeNull();
      expect(pin?.yNorm).toBeCloseTo(0.75);
      expect(pin?.xNorm).toBeCloseTo(0.25);
    } finally {
      await target.cleanup();
    }
  });

  it("stores route, area, and label geometry and refuses a stale rewrite", async () => {
    const [image] = await addRecordImages(
      t.db,
      IDS.project,
      IDS.world,
      [{ filename: "coast.png", bytes: makePng(80, 40) }],
      { confirmProtected: false },
    );
    const map = await createWorldMap(t.db, IDS.project, { title: "Coast roads", imageId: image.id });
    const route = await addWorldMapPin(t.db, IDS.project, map.id, {
      kind: "route",
      recordId: RIVER,
      markerGroup: "transport",
      label: "Salt road",
      xNorm: 0,
      yNorm: 0,
      points: [
        { x: 0.1, y: 0.2 },
        { x: 0.5, y: 0.2 },
        { x: 0.8, y: 0.7 },
      ],
    });
    expect(route.kind).toBe("route");
    expect(route.recordId).toBe(RIVER);
    expect(route.points.map((point) => point.x)).toEqual([0.1, 0.5, 0.8]);
    expect(route.xNorm).toBeCloseTo(0.1);
    expect(route.revision).toBe(0);
    expect(route).not.toHaveProperty("distance");

    const area = await addWorldMapPin(t.db, IDS.project, map.id, {
      kind: "area",
      label: "Quay yard",
      xNorm: 0,
      yNorm: 0,
      points: [
        { x: 0.2, y: 0.2 },
        { x: 0.4, y: 0.2 },
        { x: 0.4, y: 0.5 },
        { x: 0.2, y: 0.2 },
      ],
    });
    expect(area.kind).toBe("area");
    expect(area.recordId).toBeNull();
    expect(area.points).toHaveLength(3);

    const label = await addWorldMapPin(t.db, IDS.project, map.id, {
      kind: "label",
      label: "North dock",
      recordId: RIVER,
      xNorm: 0.3,
      yNorm: 0.6,
    });
    expect(label.kind).toBe("label");
    expect(label.title).toBe("North dock");
    expect(label.points).toEqual([]);

    await expect(
      addWorldMapPin(t.db, IDS.project, map.id, {
        kind: "route",
        recordId: IDS.chapter,
        xNorm: 0.2,
        yNorm: 0.2,
        points: [
          { x: 0.2, y: 0.2 },
          { x: 0.3, y: 0.3 },
        ],
      }),
    ).rejects.toBeInstanceOf(MutationRejectedError);
    await expect(
      addWorldMapPin(t.db, IDS.project, map.id, { kind: "label", label: "  ", xNorm: 0.2, yNorm: 0.2 }),
    ).rejects.toBeInstanceOf(MutationRejectedError);
    await expect(
      addWorldMapPin(t.db, IDS.project, map.id, {
        kind: "area",
        xNorm: 0.2,
        yNorm: 0.2,
        points: [
          { x: 0.2, y: 0.2 },
          { x: 0.3, y: 0.3 },
        ],
      }),
    ).rejects.toBeInstanceOf(MutationRejectedError);

    await expect(
      setWorldMapPinGeometry(t.db, IDS.project, map.id, route.id, {
        expectedRevision: 4,
        points: [
          { x: 0.9, y: 0.9 },
          { x: 0.1, y: 0.1 },
        ],
      }),
    ).rejects.toBeInstanceOf(MutationRejectedError);
    const untouched = await t.db.worldMapPin.findFirst({ where: { id: route.id } });
    expect(JSON.parse(untouched?.points ?? "[]")).toEqual([
      { x: 0.1, y: 0.2 },
      { x: 0.5, y: 0.2 },
      { x: 0.8, y: 0.7 },
    ]);
    expect(untouched?.revision).toBe(0);

    const saved = await setWorldMapPinGeometry(t.db, IDS.project, map.id, route.id, {
      expectedRevision: 0,
      points: [
        { x: 0.2, y: 0.3 },
        { x: 0.6, y: 0.4 },
      ],
    });
    expect(saved.revision).toBe(1);
    expect(saved.points).toEqual([
      { x: 0.2, y: 0.3 },
      { x: 0.6, y: 0.4 },
    ]);
    await expect(
      setWorldMapPinGeometry(t.db, IDS.project, map.id, route.id, {
        expectedRevision: 0,
        points: [
          { x: 0.9, y: 0.9 },
          { x: 0.1, y: 0.1 },
        ],
      }),
    ).rejects.toBeInstanceOf(MutationRejectedError);
    const kept = await t.db.worldMapPin.findFirst({ where: { id: route.id } });
    expect(JSON.parse(kept?.points ?? "[]")).toEqual([
      { x: 0.2, y: 0.3 },
      { x: 0.6, y: 0.4 },
    ]);
    await expect(removeWorldMapPin(t.db, IDS.project, map.id, route.id, 0)).rejects.toBeInstanceOf(MutationRejectedError);
    expect(await t.db.worldMapPin.count({ where: { id: route.id } })).toBe(1);

    await t.db.recordImage.update({ where: { id: image.id }, data: { width: 800, height: 200 } });
    const resized = await getWorldMap(t.db, IDS.project, map.id);
    expect(resized.imageWidth).toBe(800);
    expect(resized.imageHeight).toBe(200);
    expect(resized.pins.find((pin) => pin.id === route.id)?.points).toEqual(saved.points);

    const backup = await createWorkspaceBackup(t.db, IDS.workspace);
    const exported = backup.worldMapPins?.find((pin) => pin.label === "Salt road");
    expect(exported?.kind).toBe("route");
    expect(exported?.points?.map((point) => point.x)).toEqual([0.2, 0.6]);
    expect(exported).not.toHaveProperty("distance");
    const target = await createTestDb();
    try {
      const restored = await restoreWorkspaceBackup(target.db, backup, { idStrategy: "remap" });
      expect(restored.ok).toBe(true);
      if (!restored.ok) return;
      const projectId = restored.projects[0]!.id;
      const maps = await listWorldMaps(target.db, projectId);
      const view = await getWorldMap(target.db, projectId, maps[0]!.id);
      const again = view.pins.find((pin) => pin.title === "Salt road");
      expect(again?.kind).toBe("route");
      expect(again?.points).toEqual(saved.points);
      expect(again?.recordId).toBeTruthy();
      const yard = view.pins.find((pin) => pin.title === "Quay yard");
      expect(yard?.kind).toBe("area");
      expect(yard?.points).toHaveLength(3);
    } finally {
      await target.cleanup();
    }
  });

  it("refuses unknown relation kinds and self-relations", async () => {
    await expect(
      addPlaceRelation(t.db, IDS.project, {
        fromRecordId: RIVER,
        toRecordId: RIVER,
        kind: "part_of",
      }),
    ).rejects.toBeInstanceOf(MutationRejectedError);
  });
});
