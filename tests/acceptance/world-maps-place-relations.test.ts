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
import { createRecord, moveRecordToTrash } from "@/server/services/recordService";
import { deleteFromTrash } from "@/server/services/trashService";
import {
  addWorldMapPin,
  createWorldMap,
  getWorldMap,
  listWorldMaps,
  moveWorldMapPin,
  removeWorldMapPin,
} from "@/server/services/worldMapService";
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
      const riverId = riverPin!.recordId;
      const tidalId = view.pins.find((p) => p.title === "Tidal approach")!.recordId;
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
