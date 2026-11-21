import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addRecordImages } from "@/server/services/imageService";
import { createRecord } from "@/server/services/recordService";
import {
  createStoryEvent,
  linkStoryEventLocation,
  linkStoryEventScene,
  loadStoryTimeline,
  orderStoryEvents,
} from "@/server/services/storyEventService";
import { saveWorldCalendar } from "@/server/services/worldCalendarService";
import { addWorldMapPin, createWorldMap, getWorldMap, updateWorldMapScale } from "@/server/services/worldMapService";
import { distanceFromScale, normalizedLength } from "@/world/mapScale";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";
import { makePng } from "../imageFixtures";

describe("timeline board and map scale", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("loads ages, lanes, and notes from stored events without writing them back", async () => {
    await saveWorldCalendar(t.db, IDS.project, {
      title: "Harbor years",
      expectedRevision: 0,
      months: [{ position: 1, name: "Tide", daysInMonth: 30 }],
      eras: [],
    });
    await createRecord(t.db, IDS.project, {
      recordId: "rec_test_quay",
      type: "worldbuilding",
      title: "The Quay",
      fields: { kind: "place", name: "The Quay" },
      authorityStatus: "approved",
    });
    await createRecord(t.db, IDS.project, {
      recordId: "rec_test_keep",
      type: "worldbuilding",
      title: "The Keep",
      fields: { kind: "place", name: "The Keep" },
      authorityStatus: "approved",
    });
    await createRecord(t.db, IDS.project, {
      recordId: "rec_test_ch2",
      type: "manuscript_chapter",
      title: "Chapter 2",
      body: "Later.",
      authorityStatus: "draft",
    });
    const birth = await createStoryEvent(t.db, IDS.project, {
      title: "Mara's birth",
      structuredDate: { eraId: null, year: 1, monthPosition: 1, day: 1 },
    });
    const oath = await createStoryEvent(t.db, IDS.project, {
      title: "The oath",
      structuredDate: { eraId: null, year: 13, monthPosition: 1, day: 1 },
    });
    const dawn = await createStoryEvent(t.db, IDS.project, {
      title: "Dawn",
      structuredDate: { eraId: null, year: 20, monthPosition: 1, day: 1 },
    });
    await linkStoryEventLocation(t.db, IDS.project, birth.id, IDS.dossier, 0);
    await linkStoryEventLocation(t.db, IDS.project, oath.id, IDS.dossier, 0);
    await linkStoryEventLocation(t.db, IDS.project, dawn.id, IDS.dossier, 0);
    await linkStoryEventLocation(t.db, IDS.project, dawn.id, "rec_test_quay", 1);
    await linkStoryEventLocation(t.db, IDS.project, dawn.id, "rec_test_keep", 2);
    const beforeOrder = await loadStoryTimeline(t.db, IDS.project, { eventId: oath.id });
    await orderStoryEvents(t.db, IDS.project, {
      eventId: oath.id,
      otherEventId: dawn.id,
      direction: "before",
      expectedRevision: beforeOrder.selected!.revision,
    });
    const dawnRow = await t.db.storyEvent.findUniqueOrThrow({ where: { id: dawn.id } });
    const oathRow = await t.db.storyEvent.findUniqueOrThrow({ where: { id: oath.id } });
    await linkStoryEventScene(t.db, IDS.project, dawn.id, IDS.chapter, dawnRow.revision);
    await linkStoryEventScene(t.db, IDS.project, oath.id, "rec_test_ch2", oathRow.revision);
    const loaded = await loadStoryTimeline(t.db, IDS.project, { eventId: oath.id });
    const age = loaded.board.marks.find((mark) => mark.eventId === oath.id && mark.laneId === IDS.dossier);
    expect(age?.ageYears).toBe(12);
    expect(loaded.board.lanes.some((lane) => lane.id === "rec_test_quay" && lane.kind === "location")).toBe(true);
    expect(loaded.board.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "same_date",
          character: "Mara Venn",
          places: expect.arrayContaining(["The Quay", "The Keep"]),
        }),
        expect.objectContaining({ kind: "reveal_order", earlierTitle: "The oath", laterTitle: "Dawn" }),
      ]),
    );
    expect(await t.db.record.count({ where: { id: IDS.dossier } })).toBe(1);
  });

  it("estimates a route from the stored scale bar", async () => {
    const [image] = await addRecordImages(
      t.db,
      IDS.project,
      IDS.world,
      [{ filename: "coast.png", bytes: makePng(40, 20) }],
      { confirmProtected: false },
    );
    const map = await createWorldMap(t.db, IDS.project, { title: "Coast chart", imageId: image.id });
    await updateWorldMapScale(t.db, IDS.project, map.id, { scaleLabel: "10 miles", scaleBarLength: 0.25 });
    await addWorldMapPin(t.db, IDS.project, map.id, {
      xNorm: 0,
      yNorm: 0.5,
      kind: "route",
      points: [
        { x: 0, y: 0.5 },
        { x: 0.25, y: 0.5 },
      ],
      label: "Coast road",
    });
    const loaded = await getWorldMap(t.db, IDS.project, map.id);
    const route = loaded.pins.find((pin) => pin.kind === "route")!;
    const reading = distanceFromScale(
      normalizedLength(route.points, { width: loaded.imageWidth, height: loaded.imageHeight }),
      loaded.scaleBarLength,
      loaded.scaleLabel,
    );
    expect(reading).toEqual({ value: 10, unit: "miles" });
  });
});
