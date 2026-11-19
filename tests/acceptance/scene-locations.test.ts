import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "@/server/services/backupService";
import { startAuthorRewrite } from "@/server/services/draftService";
import { MutationRejectedError } from "@/server/services/errors";
import { addRecordImages } from "@/server/services/imageService";
import { createRecord, moveRecordInBook, moveRecordToTrash, restoreRecordsFromTrash } from "@/server/services/recordService";
import {
  assignSceneLocation,
  listSceneLocationsForManuscript,
  listScenesForLocation,
  removeSceneLocation,
  setSceneLocationPrimary,
} from "@/server/services/sceneLocationService";
import { deleteFromTrash } from "@/server/services/trashService";
import { addWorldMapPin, createWorldMap, getWorldMap } from "@/server/services/worldMapService";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";
import { makePng } from "../imageFixtures";

const SCENE = "rec_test_quay_scene";
const CHAPTER_TWO = "rec_test_ch02";
const RIVER = "rec_test_silverwater";
const ACTOR = "author";

describe("scene locations", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
    await createRecord(t.db, IDS.project, {
      recordId: RIVER,
      type: "worldbuilding",
      title: "Silverwater",
      body: "The river below the quay.",
      authorityStatus: "approved",
    });
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("assigns several locations with one optional primary and leaves the manuscript revision alone", async () => {
    const before = await t.db.record.findUniqueOrThrow({ where: { id: IDS.chapter }, select: { currentRevision: true } });
    const revisions = await t.db.revision.count({ where: { recordId: IDS.chapter } });
    const first = await assignSceneLocation(t.db, IDS.project, IDS.chapter, IDS.world, {
      isPrimary: false,
      expectedFingerprint: "",
    });
    expect(first.locations.map((location) => location.title)).toEqual(["The Salt Guild"]);
    expect(first.locations[0]!.isPrimary).toBe(false);

    const second = await assignSceneLocation(t.db, IDS.project, IDS.chapter, RIVER, {
      isPrimary: true,
      expectedFingerprint: first.fingerprint,
    });
    expect(second.locations.find((location) => location.locationRecordId === RIVER)?.isPrimary).toBe(true);
    expect(second.locations.find((location) => location.locationRecordId === IDS.world)?.isPrimary).toBe(false);

    const guild = second.locations.find((location) => location.locationRecordId === IDS.world)!;
    const primary = await setSceneLocationPrimary(t.db, IDS.project, IDS.chapter, guild.id, {
      isPrimary: true,
      expectedFingerprint: second.fingerprint,
    });
    expect(primary.locations.filter((location) => location.isPrimary).map((location) => location.locationRecordId)).toEqual([
      IDS.world,
    ]);
    const cleared = await setSceneLocationPrimary(t.db, IDS.project, IDS.chapter, guild.id, {
      isPrimary: false,
      expectedFingerprint: primary.fingerprint,
    });
    expect(cleared.locations.every((location) => !location.isPrimary)).toBe(true);

    const after = await t.db.record.findUniqueOrThrow({ where: { id: IDS.chapter }, select: { currentRevision: true } });
    expect(after.currentRevision).toBe(before.currentRevision);
    expect(await t.db.revision.count({ where: { recordId: IDS.chapter } })).toBe(revisions);
    expect(await t.db.recordLink.count()).toBe(0);
    expect(await t.db.placeRelation.count()).toBe(0);
    expect(await t.db.establishedFact.count()).toBe(0);

    await expect(
      assignSceneLocation(t.db, IDS.project, IDS.chapter, RIVER, {
        isPrimary: false,
        expectedFingerprint: "",
      }),
    ).rejects.toBeInstanceOf(MutationRejectedError);
    expect((await listSceneLocationsForManuscript(t.db, IDS.project, IDS.chapter)).locations).toHaveLength(2);

    await expect(
      assignSceneLocation(t.db, IDS.project, IDS.world, IDS.chapter, {
        isPrimary: false,
        expectedFingerprint: "",
      }),
    ).rejects.toBeInstanceOf(MutationRejectedError);
    await expect(
      assignSceneLocation(t.db, IDS.project, IDS.dossier, IDS.world, {
        isPrimary: false,
        expectedFingerprint: "",
      }),
    ).rejects.toBeInstanceOf(MutationRejectedError);
  });

  it("lists a chapter-only book, then scenes, in manuscript order for each draft", async () => {
    const chapterOnly = await listScenesForLocation(t.db, IDS.project, IDS.world);
    expect(chapterOnly.scenes).toEqual([]);
    expect(chapterOnly.drafts).toEqual([]);
    expect(chapterOnly.books).toEqual([]);

    await assignSceneLocation(t.db, IDS.project, IDS.chapter, IDS.world, {
      isPrimary: true,
      expectedFingerprint: "",
    });
    const onlyChapter = await listScenesForLocation(t.db, IDS.project, IDS.world);
    expect(onlyChapter.scenes.map((scene) => scene.recordId)).toEqual([IDS.chapter]);
    expect(onlyChapter.scenes[0]!.type).toBe("manuscript_chapter");
    expect(onlyChapter.scenes[0]!.isPrimary).toBe(true);
    expect(onlyChapter.scenes[0]!.draftId).toBeNull();

    await createRecord(t.db, IDS.project, {
      recordId: CHAPTER_TWO,
      type: "manuscript_chapter",
      title: "Chapter 2",
      body: "Later.",
      authorityStatus: "draft",
    });
    await moveRecordInBook(t.db, IDS.project, { recordId: CHAPTER_TWO, parentRecordId: null, index: 0 });
    await createRecord(t.db, IDS.project, {
      recordId: SCENE,
      type: "manuscript_scene",
      title: "The quay",
      body: "Salt on the stones.",
      authorityStatus: "draft",
      parentRecordId: IDS.chapter,
    });
    const chapterSet = await listSceneLocationsForManuscript(t.db, IDS.project, CHAPTER_TWO);
    await assignSceneLocation(t.db, IDS.project, CHAPTER_TWO, IDS.world, {
      isPrimary: false,
      expectedFingerprint: chapterSet.fingerprint,
    });
    const sceneSet = await listSceneLocationsForManuscript(t.db, IDS.project, SCENE);
    await assignSceneLocation(t.db, IDS.project, SCENE, IDS.world, {
      isPrimary: false,
      expectedFingerprint: sceneSet.fingerprint,
    });

    const ordered = await listScenesForLocation(t.db, IDS.project, IDS.world);
    expect(ordered.scenes.map((scene) => scene.recordId)).toEqual([CHAPTER_TWO, IDS.chapter, SCENE]);
    expect(ordered.scenes[2]!.chapterTitle).toBe("Chapter 1");

    await t.db.manuscriptGroup.create({
      data: { id: "grp_test_book", projectId: IDS.project, label: "Book One", position: 0 },
    });
    await t.db.record.update({ where: { id: IDS.chapter }, data: { groupId: "grp_test_book" } });
    const inBook = await listScenesForLocation(t.db, IDS.project, IDS.world, { draft: "all", book: "grp_test_book" });
    expect(inBook.scenes.map((scene) => scene.recordId)).toEqual([IDS.chapter, SCENE]);
    const ungrouped = await listScenesForLocation(t.db, IDS.project, IDS.world, { draft: "all", book: "ungrouped" });
    expect(ungrouped.scenes.map((scene) => scene.recordId)).toEqual([CHAPTER_TWO]);

    const rewrite = await startAuthorRewrite(t.db, IDS.project);
    const authorChapter = rewrite.openRecordId!;
    const authorSet = await listSceneLocationsForManuscript(t.db, IDS.project, authorChapter);
    await assignSceneLocation(t.db, IDS.project, authorChapter, IDS.world, {
      isPrimary: true,
      expectedFingerprint: authorSet.fingerprint,
    });
    const zeroOnly = await listScenesForLocation(t.db, IDS.project, IDS.world, {
      draft: rewrite.zeroDraft.id,
      book: "all",
    });
    expect(zeroOnly.scenes.every((scene) => scene.draftId === rewrite.zeroDraft.id)).toBe(true);
    expect(zeroOnly.scenes.map((scene) => scene.title)).toEqual(["Chapter 2", "Chapter 1", "The quay"]);
    const authorOnly = await listScenesForLocation(t.db, IDS.project, IDS.world, {
      draft: rewrite.authorDraft.id,
      book: "all",
    });
    expect(authorOnly.scenes.map((scene) => scene.recordId)).toEqual([authorChapter]);
    const both = await listScenesForLocation(t.db, IDS.project, IDS.world);
    expect(both.scenes.findIndex((scene) => scene.draftId === rewrite.zeroDraft.id)).toBeLessThan(
      both.scenes.findIndex((scene) => scene.draftId === rewrite.authorDraft.id),
    );
  });

  it("keeps a trashed target, refuses a stale rewrite, and restores the link with the route", async () => {
    const set = await assignSceneLocation(t.db, IDS.project, IDS.chapter, IDS.world, {
      isPrimary: true,
      expectedFingerprint: "",
    });
    await createRecord(t.db, IDS.project, {
      recordId: SCENE,
      type: "manuscript_scene",
      title: "The quay",
      body: "Salt on the stones.",
      authorityStatus: "draft",
      parentRecordId: IDS.chapter,
    });
    await assignSceneLocation(t.db, IDS.project, SCENE, IDS.world, { isPrimary: false, expectedFingerprint: "" });
    const [img] = await addRecordImages(
      t.db,
      IDS.project,
      IDS.world,
      [{ filename: "quay.png", bytes: makePng(20, 20) }],
      { confirmProtected: false },
    );
    const map = await createWorldMap(t.db, IDS.project, { title: "Quay chart", imageId: img.id });
    const route = await addWorldMapPin(t.db, IDS.project, map.id, {
      recordId: IDS.world,
      kind: "route",
      points: [
        { x: 0.1, y: 0.2 },
        { x: 0.4, y: 0.2 },
        { x: 0.4, y: 0.6 },
      ],
      xNorm: 0.1,
      yNorm: 0.2,
    });

    const viewBefore = await getWorldMap(t.db, IDS.project, map.id);
    expect(viewBefore.pins[0]!.points).toEqual(route.points);
    expect(viewBefore.pins[0]!.revision).toBe(route.revision);

    const trashed = await moveRecordToTrash(t.db, IDS.project, SCENE, true);
    expect((await listScenesForLocation(t.db, IDS.project, IDS.world)).scenes.map((scene) => scene.recordId)).toEqual([
      IDS.chapter,
    ]);
    expect(await t.db.sceneLocation.count({ where: { manuscriptRecordId: SCENE } })).toBe(1);
    await restoreRecordsFromTrash(t.db, IDS.project, trashed.batchId);
    expect((await listScenesForLocation(t.db, IDS.project, IDS.world)).scenes.map((scene) => scene.title)).toEqual([
      "Chapter 1",
      "The quay",
    ]);

    await moveRecordToTrash(t.db, IDS.project, IDS.world, false);
    const hiddenPlace = await listSceneLocationsForManuscript(t.db, IDS.project, IDS.chapter);
    expect(hiddenPlace.locations[0]!.unavailable).toBe(true);
    await expect(
      removeSceneLocation(t.db, IDS.project, IDS.chapter, set.locations[0]!.id, ""),
    ).rejects.toBeInstanceOf(MutationRejectedError);
    expect(await t.db.sceneLocation.count({ where: { manuscriptRecordId: IDS.chapter } })).toBe(1);

    const backup = await createWorkspaceBackup(t.db, IDS.workspace);
    expect(backup.sceneLocations?.some((row) => row.isPrimary === true)).toBe(true);
    expect(backup.sceneLocations?.every((row) => !("storyDate" in row))).toBe(true);
    expect(backup.worldMapPins?.[0]?.kind).toBe("route");
    expect(backup.worldMapPins?.[0]?.points).toEqual([
      { x: 0.1, y: 0.2 },
      { x: 0.4, y: 0.2 },
      { x: 0.4, y: 0.6 },
    ]);
    expect(backup.counts.sceneLocations).toBe(backup.sceneLocations?.length);

    const target = await createTestDb();
    try {
      const restored = await restoreWorkspaceBackup(target.db, backup, { idStrategy: "remap" });
      expect(restored.ok).toBe(true);
      if (!restored.ok) return;
      const projectId = restored.projects[0]!.id;
      const locations = await target.db.sceneLocation.findMany({ where: { projectId } });
      expect(locations).toHaveLength(2);
      expect(locations.filter((row) => row.isPrimary)).toHaveLength(1);
      expect(locations.every((row) => row.revision === 0)).toBe(true);
      const maps = await target.db.worldMap.findMany({ where: { projectId } });
      const pins = await target.db.worldMapPin.findMany({ where: { mapId: maps[0]!.id } });
      expect(JSON.parse(pins[0]!.points)).toEqual(route.points);
    } finally {
      await target.cleanup();
    }

    const batch = (await t.db.record.findUniqueOrThrow({ where: { id: IDS.world } })).trashBatchId!;
    const backupsDir = mkdtempSync(`${tmpdir()}/wordly-scene-loc-`);
    const outcome = await deleteFromTrash(
      t.db,
      { kind: "records", projectId: IDS.project, batchId: batch },
      { databaseFile: t.file, backupsDir, actor: ACTOR },
    );
    expect(outcome.ok).toBe(true);
    expect(await t.db.sceneLocation.count({ where: { locationRecordId: IDS.world } })).toBe(0);
    expect(await t.db.worldMap.count({ where: { id: map.id } })).toBe(0);
  });
});
