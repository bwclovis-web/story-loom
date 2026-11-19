import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceBackupV1 } from "@/backup/format.v1";
import { sha256, stableStringify } from "@/domain/json";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "@/server/services/backupService";
import { startAuthorRewrite } from "@/server/services/draftService";
import { MutationRejectedError } from "@/server/services/errors";
import { addRecordImages } from "@/server/services/imageService";
import { createRecord, updateRecord } from "@/server/services/recordService";
import { assignSceneLocation, listSceneLocationsForManuscript } from "@/server/services/sceneLocationService";
import {
  addStoryEventEvidence,
  createStoryEvent,
  linkStoryEventLocation,
  linkStoryEventScene,
  listEventsForLocation,
  loadStoryTimeline,
  orderStoryEvents,
  updateStoryEvent,
} from "@/server/services/storyEventService";
import { addWorldMapPin, createWorldMap, getWorldMap } from "@/server/services/worldMapService";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";
import { makePng } from "../imageFixtures";

const SCENE = "rec_test_quay_scene";
const LATER = "rec_test_later_chapter";

describe("story events", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("keeps unknown time, several reveals, and chronology apart from the manuscript", async () => {
    const before = await t.db.record.findUniqueOrThrow({ where: { id: IDS.chapter }, select: { currentRevision: true, body: true } });
    const empty = await loadStoryTimeline(t.db, IDS.project);
    expect(empty.events).toEqual([]);

    const fire = await createStoryEvent(t.db, IDS.project, { title: "The fire", planned: true });
    const quarrel = await createStoryEvent(t.db, IDS.project, { title: "The quarrel", timeLabel: "" });
    await createRecord(t.db, IDS.project, {
      recordId: LATER,
      type: "manuscript_chapter",
      title: "Chapter 2",
      body: "The quay was already ash.",
      authorityStatus: "draft",
    });
    await createRecord(t.db, IDS.project, {
      recordId: SCENE,
      type: "manuscript_scene",
      title: "The quarrel",
      body: "They argued on the stones.",
      authorityStatus: "draft",
      parentRecordId: IDS.chapter,
    });
    const fireDetail = await loadStoryTimeline(t.db, IDS.project, { eventId: fire.id });
    await linkStoryEventScene(t.db, IDS.project, fire.id, LATER, fireDetail.selected!.revision);
    const afterFirst = await loadStoryTimeline(t.db, IDS.project, { eventId: fire.id });
    await linkStoryEventScene(t.db, IDS.project, fire.id, SCENE, afterFirst.selected!.revision);
    const quarrelDetail = await loadStoryTimeline(t.db, IDS.project, { eventId: quarrel.id });
    await linkStoryEventScene(t.db, IDS.project, quarrel.id, IDS.chapter, quarrelDetail.selected!.revision);
    const orderedFire = await loadStoryTimeline(t.db, IDS.project, { eventId: fire.id });
    await orderStoryEvents(t.db, IDS.project, {
      eventId: fire.id,
      otherEventId: quarrel.id,
      direction: "before",
      expectedRevision: orderedFire.selected!.revision,
    });

    const timeline = await loadStoryTimeline(t.db, IDS.project);
    expect(timeline.events.map((event) => event.title)).toEqual(["The fire", "The quarrel"]);
    expect(timeline.events[0]!.planned).toBe(true);
    expect(timeline.events[0]!.timeLabel).toBe("");
    expect(timeline.events[1]!.timeLabel).toBe("");
    const revealed = await loadStoryTimeline(t.db, IDS.project, { eventId: fire.id });
    expect(revealed.selected!.scenes.map((scene) => scene.recordId).sort()).toEqual([LATER, SCENE].sort());
    const after = await t.db.record.findUniqueOrThrow({ where: { id: IDS.chapter }, select: { currentRevision: true, body: true } });
    expect(after.currentRevision).toBe(before.currentRevision);
    expect(after.body).toBe(before.body);
    expect(await t.db.sceneLocation.count()).toBe(0);
    expect(await t.db.establishedFact.count()).toBe(0);

    const circle = await loadStoryTimeline(t.db, IDS.project, { eventId: quarrel.id });
    await expect(
      orderStoryEvents(t.db, IDS.project, {
        eventId: quarrel.id,
        otherEventId: fire.id,
        direction: "before",
        expectedRevision: circle.selected!.revision,
      }),
    ).rejects.toBeInstanceOf(MutationRejectedError);
    expect(await t.db.storyEventOrder.count()).toBe(1);

    await expect(
      updateStoryEvent(t.db, IDS.project, fire.id, {
        title: "The fire",
        summary: "",
        timeLabel: "",
        planned: true,
        draftScope: "all",
        expectedRevision: 0,
      }),
    ).rejects.toBeInstanceOf(MutationRejectedError);
    expect((await t.db.storyEvent.findUniqueOrThrow({ where: { id: fire.id } })).title).toBe("The fire");
  });

  it("filters drafts, marks stale evidence, and leaves markers and scene locations alone", async () => {
    const body = "Salt on the stones before dawn.";
    await updateRecord(t.db, IDS.project, { recordId: IDS.chapter, expectedRevision: 1, body, unlockProtected: true });
    const pinned = await t.db.record.findUniqueOrThrow({ where: { id: IDS.chapter }, select: { currentRevision: true, body: true } });
    const event = await createStoryEvent(t.db, IDS.project, { title: "Before dawn", planned: true });
    const detail = await loadStoryTimeline(t.db, IDS.project, { eventId: event.id });
    const start = pinned.body.indexOf("Salt");
    await addStoryEventEvidence(t.db, IDS.project, event.id, {
      sourceRecordId: IDS.chapter,
      passageStart: start,
      passageEnd: start + "Salt".length,
      expectedRevision: detail.selected!.revision,
    });
    const unchanged = await t.db.record.findUniqueOrThrow({ where: { id: IDS.chapter }, select: { currentRevision: true, body: true } });
    expect(unchanged).toEqual(pinned);
    await updateRecord(t.db, IDS.project, {
      recordId: IDS.chapter,
      expectedRevision: pinned.currentRevision,
      body: "Salt on the stones after the rewrite.",
      unlockProtected: true,
    });
    const stale = await loadStoryTimeline(t.db, IDS.project, { eventId: event.id });
    expect(stale.selected!.evidence[0]!.needsRecheck).toBe(true);
    expect(stale.selected!.evidence[0]!.passageExcerpt).toBe("Salt");
    expect(stale.selected!.planned).toBe(true);

    const rewrite = await startAuthorRewrite(t.db, IDS.project);
    const scoped = await createStoryEvent(t.db, IDS.project, { title: "Zero only", draftScope: rewrite.zeroDraft.id });
    const author = await loadStoryTimeline(t.db, IDS.project, { draft: rewrite.authorDraft.id });
    expect(author.events.map((item) => item.id)).toContain(event.id);
    expect(author.events.map((item) => item.id)).not.toContain(scoped.id);
    const zero = await loadStoryTimeline(t.db, IDS.project, { draft: rewrite.zeroDraft.id });
    expect(zero.events.map((item) => item.id)).toEqual(expect.arrayContaining([event.id, scoped.id]));

    const set = await listSceneLocationsForManuscript(t.db, IDS.project, IDS.chapter);
    await assignSceneLocation(t.db, IDS.project, IDS.chapter, IDS.world, { isPrimary: true, expectedFingerprint: set.fingerprint });
    const [img] = await addRecordImages(t.db, IDS.project, IDS.world, [{ filename: "quay.png", bytes: makePng(20, 20) }], {
      confirmProtected: false,
    });
    const first = await createWorldMap(t.db, IDS.project, { title: "Quay chart", imageId: img.id });
    const second = await createWorldMap(t.db, IDS.project, { title: "Harbour chart", imageId: img.id });
    const pin = await addWorldMapPin(t.db, IDS.project, first.id, { recordId: IDS.world, xNorm: 0.42, yNorm: 0.55 });
    await addWorldMapPin(t.db, IDS.project, second.id, { recordId: IDS.world, xNorm: 0.2, yNorm: 0.3 });
    const linked = await loadStoryTimeline(t.db, IDS.project, { eventId: event.id });
    await linkStoryEventLocation(t.db, IDS.project, event.id, IDS.world, linked.selected!.revision);
    const map = await getWorldMap(t.db, IDS.project, first.id);
    expect(map.pins.find((item) => item.id === pin.id)?.points).toEqual([]);
    expect(map.pins.find((item) => item.id === pin.id)?.xNorm).toBe(0.42);
    const shown = await loadStoryTimeline(t.db, IDS.project, { eventId: event.id });
    expect(shown.selected!.locations[0]!.maps).toHaveLength(2);
    expect(await listEventsForLocation(t.db, IDS.project, IDS.world)).toEqual([
      expect.objectContaining({ id: event.id, planned: true, timeLabel: "" }),
    ]);
    const locations = await listSceneLocationsForManuscript(t.db, IDS.project, IDS.chapter);
    expect(locations.locations.map((location) => location.locationRecordId)).toEqual([IDS.world]);

    const backup = await createWorkspaceBackup(t.db, IDS.workspace);
    expect(backup.storyEvents?.some((item) => item.planned)).toBe(true);
    expect(backup.storyEvents?.every((item) => !("timeLabel" in item) || item.timeLabel)).toBe(true);
    expect(JSON.stringify(backup)).not.toContain("storyDate");
    const restored = await createTestDb();
    try {
      const outcome = await restoreWorkspaceBackup(restored.db, backup, { idStrategy: "remap" });
      expect(outcome.ok).toBe(true);
      const copy = await restored.db.storyEvent.findMany({ orderBy: { title: "asc" } });
      expect(copy.map((item) => item.title).sort()).toEqual(["Before dawn", "Zero only"]);
      expect(await restored.db.storyEventEvidence.count()).toBe(1);
      expect(await restored.db.storyEventOrder.count()).toBe(0);
    } finally {
      await restored.cleanup();
    }
  });

  it("restores events in both modes and still accepts a backup without them", async () => {
    const body = "Salt on the stones before dawn.";
    await updateRecord(t.db, IDS.project, { recordId: IDS.chapter, expectedRevision: 1, body, unlockProtected: true });
    const pinned = await t.db.record.findUniqueOrThrow({ where: { id: IDS.chapter }, select: { currentRevision: true, body: true } });
    await createRecord(t.db, IDS.project, {
      recordId: SCENE,
      type: "manuscript_scene",
      title: "The quay",
      body: "They argued on the stones.",
      authorityStatus: "draft",
      parentRecordId: IDS.chapter,
    });
    await createRecord(t.db, IDS.project, {
      recordId: LATER,
      type: "manuscript_chapter",
      title: "Chapter 2",
      body: "The quay was already ash.",
      authorityStatus: "draft",
    });
    const rewrite = await startAuthorRewrite(t.db, IDS.project);
    const fire = await createStoryEvent(t.db, IDS.project, { title: "The fire", planned: true, draftScope: rewrite.zeroDraft.id });
    const quarrel = await createStoryEvent(t.db, IDS.project, { title: "The quarrel", timeLabel: "before dawn" });
    const unplaced = await createStoryEvent(t.db, IDS.project, { title: "Unplaced", draftScope: "unscoped" });
    let detail = await loadStoryTimeline(t.db, IDS.project, { eventId: fire.id });
    await linkStoryEventLocation(t.db, IDS.project, fire.id, IDS.world, detail.selected!.revision);
    detail = await loadStoryTimeline(t.db, IDS.project, { eventId: fire.id });
    await linkStoryEventScene(t.db, IDS.project, fire.id, LATER, detail.selected!.revision);
    detail = await loadStoryTimeline(t.db, IDS.project, { eventId: fire.id });
    await linkStoryEventScene(t.db, IDS.project, fire.id, SCENE, detail.selected!.revision);
    detail = await loadStoryTimeline(t.db, IDS.project, { eventId: quarrel.id });
    await linkStoryEventScene(t.db, IDS.project, quarrel.id, IDS.chapter, detail.selected!.revision);
    detail = await loadStoryTimeline(t.db, IDS.project, { eventId: fire.id });
    await orderStoryEvents(t.db, IDS.project, {
      eventId: fire.id,
      otherEventId: quarrel.id,
      direction: "before",
      expectedRevision: detail.selected!.revision,
    });
    detail = await loadStoryTimeline(t.db, IDS.project, { eventId: fire.id });
    const start = pinned.body.indexOf("Salt");
    await addStoryEventEvidence(t.db, IDS.project, fire.id, {
      sourceRecordId: IDS.chapter,
      passageStart: start,
      passageEnd: start + "Salt".length,
      expectedRevision: detail.selected!.revision,
    });
    const originalEvidence = await t.db.storyEventEvidence.findFirstOrThrow();
    const backup = await createWorkspaceBackup(t.db, IDS.workspace);
    const before = await t.db.record.findUniqueOrThrow({ where: { id: IDS.chapter }, select: { currentRevision: true, body: true } });

    const remapped = await createTestDb();
    const preserved = await createTestDb();
    const older = await createTestDb();
    const legacy = await createTestDb();
    try {
      expect((await restoreWorkspaceBackup(remapped.db, backup, { idStrategy: "remap" })).ok).toBe(true);
      await expectStoryCopy(remapped.db, { remapDraft: true, zeroDraftId: rewrite.zeroDraft.id });
      expect((await restoreWorkspaceBackup(preserved.db, backup, { idStrategy: "preserve" })).ok).toBe(true);
      const sameFire = await preserved.db.storyEvent.findFirstOrThrow({ where: { title: "The fire" } });
      expect(sameFire.id).toBe(fire.id);
      expect(sameFire.draftScope).toBe(rewrite.zeroDraft.id);
      expect(sameFire.planned).toBe(true);
      expect(sameFire.timeLabel).toBe("");
      const sameQuarrel = await preserved.db.storyEvent.findFirstOrThrow({ where: { title: "The quarrel" } });
      expect(sameQuarrel.id).toBe(quarrel.id);
      expect(sameQuarrel.draftScope).toBe("all");
      expect(sameQuarrel.timeLabel).toBe("before dawn");
      expect((await preserved.db.storyEvent.findFirstOrThrow({ where: { title: "Unplaced" } })).id).toBe(unplaced.id);
      expect((await preserved.db.storyEvent.findFirstOrThrow({ where: { title: "Unplaced" } })).draftScope).toBe("unscoped");
      const preservedOrder = await preserved.db.storyEventOrder.findFirstOrThrow();
      expect(preservedOrder.earlierEventId).toBe(fire.id);
      expect(preservedOrder.laterEventId).toBe(quarrel.id);
      const preservedEvidence = await preserved.db.storyEventEvidence.findFirstOrThrow();
      expect(preservedEvidence.revisionNumber).toBe(originalEvidence.revisionNumber);
      expect(preservedEvidence.passageStart).toBe(originalEvidence.passageStart);
      expect(preservedEvidence.passageEnd).toBe(originalEvidence.passageEnd);
      expect(preservedEvidence.passageExcerpt).toBe("Salt");
      expect(preservedEvidence.contentHash).toBe(originalEvidence.contentHash);
      expect(await preserved.db.storyEventScene.count()).toBe(3);
      expect(await preserved.db.storyEventLocation.count()).toBe(1);

      const stripped = withoutStoryEvents(backup);
      expect(stripped.storyEvents).toBeUndefined();
      expect((await restoreWorkspaceBackup(older.db, stripped, { idStrategy: "preserve" })).ok).toBe(true);
      expect(await older.db.storyEvent.count()).toBe(0);
      expect(await older.db.storyEventOrder.count()).toBe(0);
      const restoredChapters = await older.db.record.findMany({ where: { title: "Chapter 1" } });
      expect(restoredChapters.some((chapter) => chapter.body === body)).toBe(true);

      const early = readFileSync(path.resolve(__dirname, "../fixtures/legacy/early-shape.v1.backup.json"), "utf8");
      expect((await restoreWorkspaceBackup(legacy.db, early, { idStrategy: "preserve" })).ok).toBe(true);
      expect(await legacy.db.storyEvent.count()).toBe(0);
      expect(await legacy.db.record.count()).toBeGreaterThan(0);
    } finally {
      await remapped.cleanup();
      await preserved.cleanup();
      await older.cleanup();
      await legacy.cleanup();
    }
    const after = await t.db.record.findUniqueOrThrow({ where: { id: IDS.chapter }, select: { currentRevision: true, body: true } });
    expect(after).toEqual(before);
  });
});

async function expectStoryCopy(db: TestDb["db"], options: { remapDraft: boolean; zeroDraftId: string }) {
  const events = await db.storyEvent.findMany();
  const fire = events.find((event) => event.title === "The fire");
  const quarrel = events.find((event) => event.title === "The quarrel");
  const unplaced = events.find((event) => event.title === "Unplaced");
  expect(fire?.planned).toBe(true);
  expect(fire?.timeLabel).toBe("");
  expect(quarrel?.draftScope).toBe("all");
  expect(quarrel?.timeLabel).toBe("before dawn");
  expect(unplaced?.draftScope).toBe("unscoped");
  const zero = await db.manuscriptDraft.findFirstOrThrow({ where: { kind: "zero_draft" } });
  expect(fire?.draftScope).toBe(zero.id);
  if (options.remapDraft) expect(fire?.draftScope).not.toBe(options.zeroDraftId);
  const titles = new Map(events.map((event) => [event.id, event.title]));
  const order = await db.storyEventOrder.findFirstOrThrow();
  expect(titles.get(order.earlierEventId)).toBe("The fire");
  expect(titles.get(order.laterEventId)).toBe("The quarrel");
  const place = await db.storyEventLocation.findFirstOrThrow({ include: { location: true, event: true } });
  expect(place.event.title).toBe("The fire");
  expect(place.location.title).toBe("The Salt Guild");
  const scenes = await db.storyEventScene.findMany({ include: { manuscript: true, event: true } });
  expect(scenes.filter((row) => row.event.title === "The fire").map((row) => row.manuscript.title).sort()).toEqual(["Chapter 2", "The quay"]);
  const evidence = await db.storyEventEvidence.findFirstOrThrow();
  expect(evidence.passageExcerpt).toBe("Salt");
  expect(evidence.revisionNumber).toBeGreaterThan(0);
  expect(evidence.contentHash).toHaveLength(64);
}

function withoutStoryEvents(backup: WorkspaceBackupV1): WorkspaceBackupV1 {
  const {
    checksum: _checksum,
    storyEvents: _events,
    storyEventLocations: _locations,
    storyEventScenes: _scenes,
    storyEventOrders: _orders,
    storyEventEvidence: _evidence,
    counts,
    ...rest
  } = backup;
  const {
    storyEvents: _eventCount,
    storyEventLocations: _locationCount,
    storyEventScenes: _sceneCount,
    storyEventOrders: _orderCount,
    storyEventEvidence: _evidenceCount,
    ...countRest
  } = counts;
  const body = { ...rest, counts: countRest };
  return { ...body, checksum: sha256(stableStringify(body)) };
}
