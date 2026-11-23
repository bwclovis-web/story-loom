import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addImageCard,
  addNoteCard,
  addRecordCard,
  createBoard,
  getBoard,
} from "@/server/services/boardService";
import { MutationRejectedError } from "@/server/services/errors";
import { addRecordImages } from "@/server/services/imageService";
import { addPlaceRelation } from "@/server/services/placeRelationService";
import { createProject, createWorkspace } from "@/server/services/projectService";
import { addRecordRelation } from "@/server/services/recordRelationService";
import { createRecord } from "@/server/services/recordService";
import { loadReferenceInspector } from "@/server/services/referenceInspectorService";
import { loadProjectRelationshipGraph } from "@/server/services/relationshipGraphService";
import { listAvailableReferences } from "@/server/services/seriesBibleService";
import { addWorldMapPin, createWorldMap, getWorldMap } from "@/server/services/worldMapService";
import { filterBoardCardsByTaxonomy, filterPlaceableRecords } from "@/world/taxonomyDiscovery";
import { RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import { createTestDb, type TestDb } from "../helpers";
import { makePng } from "../imageFixtures";

/**
 * W6A Station fixture: Book One owns a series-shared station with Locations
 * primary and Technology → Transportation secondary; Book Two discovers it.
 */
describe("W6A taxonomy discovery on maps, boards, and relationships", () => {
  let t: TestDb;
  const workspaceId = "wsp_w6a";
  const bookOne = "prj_w6a_b1";
  const bookTwo = "prj_w6a_b2";
  const bookThree = "prj_w6a_other";
  const stationId = "rec_w6a_station";

  beforeEach(async () => {
    t = await createTestDb();
    await createWorkspace(t.db, { id: workspaceId, name: "W6A Workspace" });
    await createProject(t.db, { id: bookOne, workspaceId, title: "Book One" });
    await createProject(t.db, { id: bookTwo, workspaceId, title: "Book Two" });
    await createProject(t.db, { id: bookThree, workspaceId, title: "Unrelated" });
    await t.db.project.update({
      where: { id: bookOne },
      data: { seriesName: "Salt Cycle", bookName: "Book One" },
    });
    await t.db.project.update({
      where: { id: bookTwo },
      data: { seriesName: "Salt Cycle", bookName: "Book Two" },
    });
    await createRecord(t.db, bookOne, {
      recordId: stationId,
      type: "worldbuilding",
      title: "Saltmarsh Station",
      body: "A shared transit hub.",
      fields: {
        kind: "place",
        taxonomy: {
          version: 1,
          primary: { category: "locations" },
          secondary: [{ category: "technology", subcategory: "transportation" }],
        },
      },
      authorityStatus: "approved",
      worldScope: "series",
    });
  });

  afterEach(async () => {
    await t.cleanup();
  });

  it("finds the station once for both category paths in Book Two pickers", async () => {
    const available = await listAvailableReferences(t.db, bookTwo, { linkableOnly: true });
    const placeable = available.map((entry) => ({
      id: entry.record.id,
      title: entry.record.title,
      typeLabel: RECORD_TYPE_LABELS[entry.record.type],
      homeLabel: entry.home?.bookName ?? null,
      worldScope: entry.worldScope,
      taxonomy: entry.taxonomy,
    }));
    const byLocations = filterPlaceableRecords(placeable, { category: "locations" });
    const byTransport = filterPlaceableRecords(placeable, {
      category: "technology",
      subcategory: "transportation",
    });
    expect(byLocations.filter((r) => r.id === stationId)).toHaveLength(1);
    expect(byTransport.filter((r) => r.id === stationId)).toHaveLength(1);
    expect(byLocations.find((r) => r.id === stationId)?.homeLabel).toBe("Book One");
  });

  it("links map pins and board cards to the original station id and keeps two pins through filtering", async () => {
    await createRecord(t.db, bookTwo, {
      recordId: "rec_w6a_map_host",
      type: "worldbuilding",
      title: "Map host",
      body: "",
      fields: { kind: "place" },
      authorityStatus: "draft",
    });
    const [image] = await addRecordImages(
      t.db,
      bookTwo,
      "rec_w6a_map_host",
      [{ filename: "coast.png", bytes: makePng(16, 16) }],
      { confirmProtected: false },
    );
    const map = await createWorldMap(t.db, bookTwo, { title: "Coast", imageId: image.id });
    const pinA = await addWorldMapPin(t.db, bookTwo, map.id, {
      recordId: stationId,
      xNorm: 0.2,
      yNorm: 0.3,
      kind: "point",
    });
    const pinB = await addWorldMapPin(t.db, bookTwo, map.id, {
      recordId: stationId,
      xNorm: 0.7,
      yNorm: 0.8,
      kind: "point",
    });
    expect(pinA.recordId).toBe(stationId);
    expect(pinB.recordId).toBe(stationId);
    expect(pinA.home?.projectId).toBe(bookOne);

    const loaded = await getWorldMap(t.db, bookTwo, map.id);
    const stationPins = loaded.pins.filter((pin) => pin.recordId === stationId);
    expect(stationPins).toHaveLength(2);
    expect(stationPins.every((pin) => !pin.unavailable)).toBe(true);
  });

  it("keeps station, image, and note board cards and positions after taxonomy filter clear", async () => {
    await createRecord(t.db, bookTwo, {
      recordId: "rec_w6a_local",
      type: "worldbuilding",
      title: "Local guild crest",
      body: "",
      fields: { kind: "organization" },
      authorityStatus: "draft",
    });
    const [img] = await addRecordImages(
      t.db,
      bookTwo,
      "rec_w6a_local",
      [{ filename: "crest.png", bytes: makePng(12, 12) }],
      { confirmProtected: false },
    );
    const board = await createBoard(t.db, bookTwo, { title: "Transit board", templateKey: "blank" });
    const stationCard = await addRecordCard(t.db, bookTwo, board.id, {
      recordId: stationId,
      x: 12,
      y: 24,
    });
    const imageCard = await addImageCard(t.db, bookTwo, board.id, {
      imageId: img.id,
      x: 100,
      y: 120,
    });
    const noteCard = await addNoteCard(t.db, bookTwo, board.id, {
      noteTitle: "Ticket booth",
      noteBody: "Notes only.",
      x: 200,
      y: 220,
    });
    expect(stationCard.recordId).toBe(stationId);
    expect(stationCard.home?.projectId).toBe(bookOne);

    const available = await listAvailableReferences(t.db, bookTwo, { linkableOnly: true });
    const taxonomyById = new Map(available.map((entry) => [entry.record.id, entry.taxonomy]));
    const loaded = await getBoard(t.db, bookTwo, board.id);
    const filtered = filterBoardCardsByTaxonomy(
      loaded.cards,
      { category: "technology", subcategory: "transportation" },
      taxonomyById,
      "all",
    );
    expect(filtered.map((c) => c.id)).toEqual([stationCard.id]);

    const cleared = filterBoardCardsByTaxonomy(
      loaded.cards,
      { category: null, subcategory: null },
      taxonomyById,
      "all",
    );
    expect(cleared).toHaveLength(3);
    expect(cleared.find((c) => c.id === stationCard.id)).toMatchObject({ x: 12, y: 24 });
    expect(cleared.find((c) => c.id === imageCard.id)).toMatchObject({ x: 100, y: 120 });
    expect(cleared.find((c) => c.id === noteCard.id)).toMatchObject({ x: 200, y: 220 });
  });

  it("inspects the station from Book Two with Book One as home and isolates unrelated books", async () => {
    const inspector = await loadReferenceInspector(t.db, bookTwo, stationId);
    expect(inspector.ok).toBe(true);
    if (inspector.ok) {
      expect(inspector.model.seriesHome?.projectId).toBe(bookOne);
      expect(inspector.model.taxonomy?.primaryCategory).toBe("locations");
      expect(inspector.model.taxonomy?.secondaryCategories).toContain("technology");
    }

    const unrelated = await listAvailableReferences(t.db, bookThree, { linkableOnly: true });
    expect(unrelated.some((entry) => entry.record.id === stationId)).toBe(false);
    const unrelatedGraph = await loadProjectRelationshipGraph(t.db, bookThree);
    expect(unrelatedGraph.nodes.some((node) => node.id === stationId)).toBe(false);
  });

  it("rejects disallowed relationship endpoints and series scope separately from discovery", async () => {
    await createRecord(t.db, bookTwo, {
      recordId: "rec_w6a_note",
      type: "research_note",
      title: "Field scrap",
      body: "",
      fields: {},
      authorityStatus: "draft",
    });
    await expect(
      addRecordRelation(t.db, bookTwo, {
        fromRecordId: stationId,
        toRecordId: "rec_w6a_note",
        kind: "member_of",
      }),
    ).rejects.toBeInstanceOf(MutationRejectedError);

    await createRecord(t.db, bookOne, {
      recordId: "rec_w6a_quay",
      type: "worldbuilding",
      title: "Quay",
      body: "",
      fields: { kind: "place" },
      authorityStatus: "approved",
      worldScope: "book",
    });
    await expect(
      addPlaceRelation(t.db, bookOne, {
        fromRecordId: "rec_w6a_quay",
        toRecordId: stationId,
        kind: "part_of",
        scope: "series",
      }),
    ).rejects.toBeInstanceOf(MutationRejectedError);
  });
});
