import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { JsonObject } from "@/domain/json";
import {
  emptyWorldProfile,
  readWorldProfile,
  type WorldFieldHistoryChange,
  type WorldProfile,
} from "@/domain/worldProfile";
import { resolveWorldFieldsAtPoint } from "@/domain/worldProfileHistory";
import { renderWorldContextSlice } from "@/domain/worldWritingContext";
import { createProject, createWorkspace } from "@/server/services/projectService";
import { createRecord, getRecord, updateRecord } from "@/server/services/recordService";
import { addPlaceRelation } from "@/server/services/placeRelationService";
import { createStoryEvent, linkStoryEventScene, orderStoryEvents } from "@/server/services/storyEventService";
import { saveWorldProfileOverlay } from "@/server/services/worldProfileUpgradeService";
import { buildWorldBibleExportModel } from "@/server/services/worldBibleModel";
import { renderWorldBibleProfileMarkdown } from "@/server/services/worldBibleProfileRender";
import { withRecordTaxonomy } from "@/world/taxonomy";
import { createTestDb, type TestDb } from "../helpers";

const WSP = "wsp_w5f";
const BOOK = "prj_w5f_book";
const WORKSHOP = "rec_w5f_workshop";
const ROOM = "rec_w5f_room";
const CHAPTER = "rec_w5f_chapter";
const SCENE_EARLY = "rec_w5f_scene_early";
const SCENE_LATER = "rec_w5f_scene_later";

const ENTRANCES = [
  { line: "Street door", gloss: "the lane" },
  { line: "Rear exit", gloss: "the alley" },
];
const DOORWAYS = [{ line: "Workshop door", gloss: "the adjoining workshop", recordId: WORKSHOP }];
const SIGHTLINES = [{ line: "Window", gloss: "the lane below the sill" }];
const BARRED = [{ line: "Workshop door", gloss: "barred from the inside", recordId: WORKSHOP }];

function historyChange(
  partial: Partial<WorldFieldHistoryChange> & Pick<WorldFieldHistoryChange, "id" | "fieldPath" | "value">,
): WorldFieldHistoryChange {
  return {
    definitionId: "category:locations",
    storage: "profile",
    presence: "set",
    approval: "approved",
    planned: false,
    provenance: { origin: "author", note: "" },
    bookProjectId: BOOK,
    storyEventId: null,
    chapterRecordId: null,
    sceneRecordId: null,
    sequence: null,
    worldScope: "series",
    note: "",
    supersedesId: null,
    correctionNote: "",
    correctedAt: null,
    ...partial,
  };
}

function countLabel(markdown: string, label: string): number {
  return markdown.split(`**${label}:**`).length - 1;
}

describe("W5D building and room sections", () => {
  let t: TestDb;

  beforeEach(async () => {
    t = await createTestDb();
    await createWorkspace(t.db, { id: WSP, name: "W5F Workspace" });
    await createProject(t.db, { id: BOOK, workspaceId: WSP, title: "W5F Book" });
  }, 15_000);

  afterEach(async () => {
    await t.cleanup();
  });

  it("saves a workshop entrance and a room window without repeating layout, access, or containment", async () => {
    await createRecord(t.db, BOOK, {
      recordId: WORKSHOP,
      type: "worldbuilding",
      title: "Copper Lane Workshop",
      body: "A cooper's workshop.",
      fields: withRecordTaxonomy(
        { kind: "place" },
        { version: 1, primary: { category: "locations", subcategory: "buildings" } },
      ),
      authorityStatus: "approved",
    });
    await createRecord(t.db, BOOK, {
      recordId: ROOM,
      type: "worldbuilding",
      title: "Fitting Room",
      body: "The room beside the workshop.",
      fields: withRecordTaxonomy(
        { kind: "place" },
        { version: 1, primary: { category: "locations", subcategory: "rooms" } },
      ),
      authorityStatus: "approved",
    });
    await addPlaceRelation(t.db, BOOK, { fromRecordId: ROOM, toRecordId: WORKSHOP, kind: "part_of" });

    const workshopProfile: WorldProfile = {
      ...emptyWorldProfile(),
      definitionId: "category:locations",
      enabledSections: ["locations:buildings"],
      values: {
        layout: "One bench along the north wall.",
        access: "The street door is the public way in.",
        entrances: ENTRANCES,
      },
    };
    const roomProfile: WorldProfile = {
      ...emptyWorldProfile(),
      definitionId: "category:locations",
      enabledSections: ["locations:rooms"],
      values: {
        layout: "A narrow room with one window.",
        access: "Enter from the workshop.",
        doorways: DOORWAYS,
        sightlines: SIGHTLINES,
      },
    };
    await saveWorldProfileOverlay(t.db, {
      projectId: BOOK,
      recordId: WORKSHOP,
      expectedRevision: 1,
      profile: workshopProfile,
    });
    await saveWorldProfileOverlay(t.db, {
      projectId: BOOK,
      recordId: ROOM,
      expectedRevision: 1,
      profile: roomProfile,
    });

    const savedRoom = readWorldProfile((await getRecord(t.db, BOOK, ROOM)).fields);
    expect(savedRoom.profile.values.doorways).toEqual(DOORWAYS);
    expect(savedRoom.profile.values.sightlines).toEqual(SIGHTLINES);

    const hidden: WorldProfile = { ...savedRoom.profile, enabledSections: [] };
    const roomRecord = await getRecord(t.db, BOOK, ROOM);
    await saveWorldProfileOverlay(t.db, {
      projectId: BOOK,
      recordId: ROOM,
      expectedRevision: roomRecord.currentRevision,
      profile: hidden,
    });
    const hiddenRead = readWorldProfile((await getRecord(t.db, BOOK, ROOM)).fields);
    expect(hiddenRead.profile.enabledSections).toEqual([]);
    expect(hiddenRead.profile.values.doorways).toEqual(DOORWAYS);
    expect(hiddenRead.profile.definitionId).toBe("category:locations");

    const shown: WorldProfile = { ...hiddenRead.profile, enabledSections: ["locations:rooms"] };
    const hiddenRecord = await getRecord(t.db, BOOK, ROOM);
    await saveWorldProfileOverlay(t.db, {
      projectId: BOOK,
      recordId: ROOM,
      expectedRevision: hiddenRecord.currentRevision,
      profile: shown,
    });

    const beforeTaxonomy = await getRecord(t.db, BOOK, ROOM);
    await updateRecord(t.db, BOOK, {
      recordId: ROOM,
      expectedRevision: beforeTaxonomy.currentRevision,
      fields: withRecordTaxonomy(beforeTaxonomy.fields as JsonObject, {
        version: 1,
        primary: { category: "locations", subcategory: "rooms" },
        secondary: [{ category: "locations", subcategory: "buildings" }],
      }),
    });
    const afterTaxonomy = readWorldProfile((await getRecord(t.db, BOOK, ROOM)).fields);
    expect(afterTaxonomy.profile.definitionId).toBe("category:locations");
    expect(afterTaxonomy.profile.enabledSections).toEqual(["locations:rooms"]);
    expect(afterTaxonomy.profile.values.sightlines).toEqual(SIGHTLINES);

    const model = await buildWorldBibleExportModel(t.db, BOOK, { recordIds: [WORKSHOP, ROOM] });
    const workshopEntry = model.entries.find((entry) => entry.record.id === WORKSHOP);
    const roomEntry = model.entries.find((entry) => entry.record.id === ROOM);
    const workshopMd = renderWorldBibleProfileMarkdown(workshopEntry!, model);
    const roomMd = renderWorldBibleProfileMarkdown(roomEntry!, model);

    expect(workshopMd).toContain("Street door — the lane");
    expect(workshopMd).toContain("Rear exit — the alley");
    expect(workshopMd.indexOf("Street door")).toBeLessThan(workshopMd.indexOf("Rear exit"));
    expect(roomMd).toContain("Workshop door — the adjoining workshop (Copper Lane Workshop)");
    expect(roomMd).toContain("Window — the lane below the sill");
    expect(countLabel(workshopMd, "Layout")).toBe(1);
    expect(countLabel(workshopMd, "Access")).toBe(1);
    expect(countLabel(roomMd, "Layout")).toBe(1);
    expect(countLabel(roomMd, "Access")).toBe(1);
    expect(countLabel(roomMd, "Part of")).toBe(1);
    expect(workshopMd).not.toContain("**Part of:**");
    expect(roomMd).not.toContain("**Entrances and exits:**");
    expect(workshopMd).not.toContain("**Doorways and connections:**");
    expect(workshopMd).not.toContain("**Sightlines:**");
  });

  it("keeps a later barred doorway out of an earlier scene", async () => {
    const early = await createStoryEvent(t.db, BOOK, { title: "Morning delivery" });
    const later = await createStoryEvent(t.db, BOOK, { title: "After the bar" });
    await orderStoryEvents(t.db, BOOK, {
      eventId: early.id,
      otherEventId: later.id,
      direction: "before",
      expectedRevision: 0,
    });
    await createRecord(t.db, BOOK, {
      recordId: CHAPTER,
      type: "manuscript_chapter",
      title: "Copper Lane",
      body: "Chapter shell.",
      authorityStatus: "draft",
    });
    await createRecord(t.db, BOOK, {
      recordId: SCENE_EARLY,
      type: "manuscript_scene",
      title: "Before the bar",
      body: "The door still opens.",
      authorityStatus: "draft",
      parentRecordId: CHAPTER,
    });
    await createRecord(t.db, BOOK, {
      recordId: SCENE_LATER,
      type: "manuscript_scene",
      title: "After the bar",
      body: "The door is shut.",
      authorityStatus: "draft",
      parentRecordId: CHAPTER,
    });
    const earlyRow = await t.db.storyEvent.findFirstOrThrow({ where: { id: early.id } });
    const laterRow = await t.db.storyEvent.findFirstOrThrow({ where: { id: later.id } });
    await linkStoryEventScene(t.db, BOOK, early.id, SCENE_EARLY, earlyRow.revision);
    await linkStoryEventScene(t.db, BOOK, later.id, SCENE_LATER, laterRow.revision);

    await createRecord(t.db, BOOK, {
      recordId: WORKSHOP,
      type: "worldbuilding",
      title: "Copper Lane Workshop",
      body: "A cooper's workshop.",
      fields: withRecordTaxonomy(
        { kind: "place" },
        { version: 1, primary: { category: "locations", subcategory: "buildings" } },
      ),
      authorityStatus: "approved",
    });
    await createRecord(t.db, BOOK, {
      recordId: ROOM,
      type: "worldbuilding",
      title: "Fitting Room",
      body: "The room beside the workshop.",
      fields: withRecordTaxonomy(
        { kind: "place" },
        { version: 1, primary: { category: "locations", subcategory: "rooms" } },
      ),
      authorityStatus: "approved",
    });
    const profile: WorldProfile = {
      ...emptyWorldProfile(),
      definitionId: "category:locations",
      enabledSections: ["locations:rooms"],
      values: { doorways: DOORWAYS, sightlines: SIGHTLINES },
      fieldHistory: [
        historyChange({
          id: "wfh_w5f_door",
          fieldPath: "values.doorways",
          value: BARRED,
          storyEventId: later.id,
        }),
      ],
    };
    await saveWorldProfileOverlay(t.db, {
      projectId: BOOK,
      recordId: ROOM,
      expectedRevision: 1,
      profile,
    });

    const earlyExport = await buildWorldBibleExportModel(
      t.db,
      BOOK,
      { recordIds: [ROOM] },
      { mode: "point", storyPointRecordId: SCENE_EARLY, bookProjectId: BOOK, approvedOnly: true },
    );
    const earlyText = earlyExport.entries.flatMap((entry) => entry.fields.map((field) => field.value)).join("\n");
    expect(earlyText).not.toMatch(/barred/i);

    const laterExport = await buildWorldBibleExportModel(
      t.db,
      BOOK,
      { recordIds: [ROOM, WORKSHOP] },
      { mode: "point", storyPointRecordId: SCENE_LATER, bookProjectId: BOOK, approvedOnly: true },
    );
    const laterDoor = laterExport.entries.find((entry) => entry.record.id === ROOM)?.fields.find((field) => field.key === "doorways")
      ?.value ?? "";
    expect(laterDoor).toContain("barred from the inside");
    expect(laterDoor).toContain("Copper Lane Workshop");

    const saved = readWorldProfile((await getRecord(t.db, BOOK, ROOM)).fields).profile;
    const orderEdges = [{ earlierId: early.id, laterId: later.id }];
    const earlyPoint = {
      bookProjectId: BOOK,
      storyEventId: early.id,
      chapterRecordId: CHAPTER,
      sceneRecordId: SCENE_EARLY,
      sequence: null,
      boundary: "at_point" as const,
    };
    const laterPoint = { ...earlyPoint, storyEventId: later.id, sceneRecordId: SCENE_LATER };
    expect(
      resolveWorldFieldsAtPoint(saved, earlyPoint, orderEdges, { fieldPaths: ["values.doorways"] }).fields[
        "values.doorways"
      ]?.presence,
    ).toBe("unknown");
    const laterResolved = resolveWorldFieldsAtPoint(saved, laterPoint, orderEdges, {
      fieldPaths: ["values.doorways"],
    });
    expect(laterResolved.fields["values.doorways"]?.presence === "set"
      ? laterResolved.fields["values.doorways"].formatted
      : "").toContain("barred from the inside");

    const drafting = renderWorldContextSlice({
      title: "Fitting Room",
      recordId: ROOM,
      fields: (await getRecord(t.db, BOOK, ROOM)).fields,
      mode: "drafting",
      point: earlyPoint,
      edges: orderEdges,
      viewingProjectId: BOOK,
    });
    expect(drafting.text).not.toMatch(/barred/i);
  });
});
