import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addImageCard, addNoteCard, createBoard, GEOGRAPHY_TEMPLATE_NOTES } from "@/server/services/boardService";
import { MutationRejectedError } from "@/server/services/errors";
import { createProject, createWorkspace } from "@/server/services/projectService";
import { setProtection } from "@/server/services/recordService";
import { createWorldMapWithNewReference, createWorldMapWithUpload } from "@/server/services/worldMapService";
import * as layerService from "@/server/services/worldMapLayerService";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";
import { makePng } from "../imageFixtures";

async function emptyProject(db: TestDb["db"]) {
  await createWorkspace(db, { id: "wsp_empty_setup", name: "Empty setup" });
  return createProject(db, { id: "prj_empty_setup", workspaceId: "wsp_empty_setup", title: "Empty project" });
}

describe("Map and board setup", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await t.cleanup();
  });

  it("creates a draft reference and map for a project with no references", async () => {
    const project = await emptyProject(t.db);
    const beforeRecords = await t.db.record.count({ where: { projectId: project.id } });
    expect(beforeRecords).toBe(0);

    const map = await createWorldMapWithNewReference(t.db, project.id, {
      title: "Harbour chart",
      referenceTitle: "Harbour chart image",
      type: "worldbuilding",
      authorityStatus: "draft",
      file: { filename: "harbour.png", bytes: makePng(16, 10) },
    });

    expect(map.title).toBe("Harbour chart");
    expect(map.hostRecordTitle).toBe("Harbour chart image");
    const record = await t.db.record.findFirstOrThrow({ where: { projectId: project.id, title: "Harbour chart image" } });
    expect(record.type).toBe("worldbuilding");
    expect(record.authorityStatus).toBe("draft");
    expect(record.protected).toBe(false);
    expect(record.body).toBe("");
    expect(record.fields).toBe("{}");
    expect(JSON.parse(record.fields)).not.toHaveProperty("kind");
    expect(await t.db.recordImage.count({ where: { recordId: record.id } })).toBe(1);
    expect(await t.db.worldMap.count({ where: { projectId: project.id } })).toBe(1);
    expect(await t.db.record.count({ where: { projectId: project.id, type: { in: ["manuscript_chapter", "manuscript_scene"] } } })).toBe(0);
  });

  it("stores approved only when the author chooses it, and does not infer a place kind from the title", async () => {
    const project = await emptyProject(t.db);
    await createWorldMapWithNewReference(t.db, project.id, {
      title: "Place map",
      referenceTitle: "Place map",
      type: "research_note",
      authorityStatus: "approved",
      file: { filename: "place.png", bytes: makePng(8, 8) },
    });
    const record = await t.db.record.findFirstOrThrow({ where: { projectId: project.id } });
    expect(record.type).toBe("research_note");
    expect(record.authorityStatus).toBe("approved");
    expect(record.fields).toBe("{}");
  });

  it("rejects invalid setup before writing, and rolls back a new reference when the map cannot be finished", async () => {
    await seedProject(t.db);
    await setProtection(t.db, IDS.project, IDS.world, true);
    const recordsBefore = await t.db.record.count({ where: { projectId: IDS.project } });
    const imagesBefore = await t.db.recordImage.count({ where: { projectId: IDS.project } });
    const mapsBefore = await t.db.worldMap.count({ where: { projectId: IDS.project } });
    const protectedBefore = await t.db.record.findUniqueOrThrow({ where: { id: IDS.world } });

    await expect(
      createWorldMapWithNewReference(t.db, IDS.project, {
        title: "   ",
        referenceTitle: "Quay",
        type: "worldbuilding",
        authorityStatus: "draft",
        file: { filename: "quay.png", bytes: makePng(8, 8) },
      }),
    ).rejects.toBeInstanceOf(MutationRejectedError);
    await expect(
      createWorldMapWithNewReference(t.db, IDS.project, {
        title: "Quay",
        referenceTitle: " ",
        type: "worldbuilding",
        authorityStatus: "draft",
        file: { filename: "quay.png", bytes: makePng(8, 8) },
      }),
    ).rejects.toBeInstanceOf(MutationRejectedError);
    await expect(
      createWorldMapWithNewReference(t.db, IDS.project, {
        title: "Quay",
        referenceTitle: "Quay",
        type: "manuscript_chapter",
        authorityStatus: "draft",
        file: { filename: "quay.png", bytes: makePng(8, 8) },
      }),
    ).rejects.toBeInstanceOf(MutationRejectedError);
    await expect(
      createWorldMapWithNewReference(t.db, IDS.project, {
        title: "Quay",
        referenceTitle: "Quay",
        type: "worldbuilding",
        authorityStatus: "canon",
        file: { filename: "quay.png", bytes: makePng(8, 8) },
      }),
    ).rejects.toBeInstanceOf(MutationRejectedError);
    await expect(
      createWorldMapWithNewReference(t.db, IDS.project, {
        title: "Quay",
        referenceTitle: "Quay",
        type: "worldbuilding",
        authorityStatus: "draft",
        file: { filename: "notes.txt", bytes: new Uint8Array([1, 2, 3]) },
      }),
    ).rejects.toBeInstanceOf(MutationRejectedError);

    await expect(
      createWorldMapWithUpload(t.db, IDS.project, {
        title: "Protected quay",
        recordId: IDS.world,
        confirmProtected: false,
        file: { filename: "quay.png", bytes: makePng(8, 8) },
      }),
    ).rejects.toBeInstanceOf(MutationRejectedError);

    vi.spyOn(layerService, "seedDefaultMapLayers").mockRejectedValueOnce(new Error("layer seed failed"));
    await expect(
      createWorldMapWithNewReference(t.db, IDS.project, {
        title: "Broken chart",
        referenceTitle: "Broken chart image",
        type: "worldbuilding",
        authorityStatus: "draft",
        file: { filename: "broken.png", bytes: makePng(8, 8) },
      }),
    ).rejects.toThrow("layer seed failed");

    expect(await t.db.record.count({ where: { projectId: IDS.project } })).toBe(recordsBefore);
    expect(await t.db.recordImage.count({ where: { projectId: IDS.project } })).toBe(imagesBefore);
    expect(await t.db.worldMap.count({ where: { projectId: IDS.project } })).toBe(mapsBefore);
    const protectedAfter = await t.db.record.findUniqueOrThrow({ where: { id: IDS.world } });
    expect(protectedAfter.currentRevision).toBe(protectedBefore.currentRevision);
    expect(protectedAfter.body).toBe(protectedBefore.body);
    expect(protectedAfter.authorityStatus).toBe(protectedBefore.authorityStatus);
    expect(await t.db.record.findFirst({ where: { projectId: IDS.project, title: "Broken chart image" } })).toBeNull();
  });

  it("adds a note on a blank board with no references, and geography creates only board notes", async () => {
    const project = await emptyProject(t.db);
    const blank = await createBoard(t.db, project.id, { title: "First board", templateKey: "blank" });
    expect(blank.cards).toEqual([]);
    const note = await addNoteCard(t.db, project.id, blank.id, {
      noteTitle: "First note",
      noteBody: "Written on the board.",
      x: 20,
      y: 30,
    });
    expect(note.kind).toBe("note");
    expect(note.recordId).toBeNull();
    expect(await t.db.record.count({ where: { projectId: project.id } })).toBe(0);
    await expect(addImageCard(t.db, project.id, blank.id, { imageId: "img_missing", x: 1, y: 1 })).rejects.toBeInstanceOf(
      MutationRejectedError,
    );
    expect(await t.db.boardCard.count({ where: { boardId: blank.id } })).toBe(1);

    await seedProject(t.db);
    const recordsBefore = await t.db.record.count({ where: { projectId: IDS.project } });
    const relationsBefore = await t.db.placeRelation.count({ where: { projectId: IDS.project } });
    const geo = await createBoard(t.db, IDS.project, { title: "Regions", templateKey: "geography" });
    expect(geo.cards.map((card) => card.noteTitle)).toEqual(GEOGRAPHY_TEMPLATE_NOTES.map((note) => note.noteTitle));
    expect(geo.cards.every((card) => card.kind === "note" && card.recordId === null)).toBe(true);
    expect(await t.db.record.count({ where: { projectId: IDS.project } })).toBe(recordsBefore);
    expect(await t.db.placeRelation.count({ where: { projectId: IDS.project } })).toBe(relationsBefore);
  });
});
