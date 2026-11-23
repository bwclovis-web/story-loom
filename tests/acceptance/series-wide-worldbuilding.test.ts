import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addRecordCard, createBoard, getBoard } from "@/server/services/boardService";
import { createProject, createWorkspace } from "@/server/services/projectService";
import { addPlaceRelation, listPlaceRelationsForRecord } from "@/server/services/placeRelationService";
import { createRecord } from "@/server/services/recordService";
import { loadReferenceInspector } from "@/server/services/referenceInspectorService";
import { loadProjectRelationshipGraph } from "@/server/services/relationshipGraphService";
import { listAvailableReferences, resolveAvailableReference } from "@/server/services/seriesBibleService";
import {
  listAvailableWorldKindTemplates,
  saveWorldKindTemplate,
  setWorldKindTemplateScope,
} from "@/server/services/worldKindTemplateService";
import { addWorldMapPin, createWorldMap, getWorldMap } from "@/server/services/worldMapService";
import { createTestDb, type TestDb } from "../helpers";

/**
 * Five-book series acceptance for World Hub W4: shared refs on maps/boards,
 * relation scope, template home isolation, and unavailable after unshare.
 */
describe("series-wide worldbuilding (W4)", () => {
  let t: TestDb;
  const workspaceId = "wsp_w4_series";
  const bookIds = ["prj_w4_b1", "prj_w4_b2", "prj_w4_b3", "prj_w4_b4", "prj_w4_b5"] as const;

  beforeEach(async () => {
    t = await createTestDb();
    await createWorkspace(t.db, { id: workspaceId, name: "W4 Series Workspace" });
    for (let i = 0; i < bookIds.length; i += 1) {
      await createProject(t.db, { id: bookIds[i]!, workspaceId, title: `W4 Book ${i + 1}` });
      await t.db.project.update({
        where: { id: bookIds[i]! },
        data: { seriesName: "W4 Salt Cycle", bookName: `Book ${i + 1}` },
      });
    }
  });

  afterEach(async () => {
    await t.cleanup();
  });

  it("resolves series-shared refs across five books and pins/cards without copying", async () => {
    await createRecord(t.db, bookIds[0], {
      type: "worldbuilding",
      title: "Harbour",
      body: "Salt harbour.",
      fields: { kind: "place" },
      authorityStatus: "approved",
      recordId: "rec_w4_harbour",
      worldScope: "series",
    });
    await createRecord(t.db, bookIds[0], {
      type: "character_dossier",
      title: "Mara",
      body: "Keeper.",
      fields: { name: "Mara" },
      authorityStatus: "approved",
      recordId: "rec_w4_mara",
      worldScope: "series",
    });
    await createRecord(t.db, bookIds[0], {
      type: "worldbuilding",
      title: "Quay",
      body: "",
      fields: { kind: "place" },
      authorityStatus: "approved",
      recordId: "rec_w4_quay",
      worldScope: "series",
    });

    for (const sibling of bookIds.slice(1)) {
      const available = await resolveAvailableReference(t.db, sibling, "rec_w4_harbour");
      expect(available?.isShared).toBe(true);
      expect(available?.home?.projectId).toBe(bookIds[0]);
      const listed = await listAvailableReferences(t.db, sibling, { linkableOnly: true });
      expect(listed.some((row) => row.record.id === "rec_w4_harbour" && row.isShared)).toBe(true);
    }

    await createRecord(t.db, bookIds[1], {
      type: "worldbuilding",
      title: "Map host",
      body: "",
      fields: { kind: "place" },
      authorityStatus: "draft",
      recordId: "rec_w4_map_host",
    });
    await t.db.recordImage.create({
      data: {
        id: "img_w4_map",
        projectId: bookIds[1],
        recordId: "rec_w4_map_host",
        name: "coast.png",
        originalFilename: "coast.png",
        mimeType: "image/png",
        byteSize: 8,
        width: 10,
        height: 10,
        contentHash: "a".repeat(64),
        data: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        position: 0,
      },
    });
    const map = await createWorldMap(t.db, bookIds[1], { title: "Coast", imageId: "img_w4_map" });
    const pin = await addWorldMapPin(t.db, bookIds[1], map.id, {
      recordId: "rec_w4_harbour",
      xNorm: 0.4,
      yNorm: 0.5,
      kind: "point",
    });
    expect(pin.recordId).toBe("rec_w4_harbour");
    expect(pin.home?.projectId).toBe(bookIds[0]);
    expect(pin.unavailable).toBe(false);

    const board = await createBoard(t.db, bookIds[2], { title: "Cast", templateKey: "blank" });
    const card = await addRecordCard(t.db, bookIds[2], board.id, {
      recordId: "rec_w4_mara",
      x: 40,
      y: 60,
    });
    expect(card.home?.projectId).toBe(bookIds[0]);
    expect(card.unavailable).toBe(false);

    const inspector = await loadReferenceInspector(t.db, bookIds[3], "rec_w4_mara");
    expect(inspector.ok).toBe(true);
    if (inspector.ok) {
      expect(inspector.model.seriesHome?.projectId).toBe(bookIds[0]);
      expect(inspector.model.worldScope).toBe("series");
    }

    await addPlaceRelation(t.db, bookIds[0], {
      fromRecordId: "rec_w4_quay",
      toRecordId: "rec_w4_harbour",
      kind: "part_of",
      scope: "series",
    });
    const fromBookFive = await listPlaceRelationsForRecord(t.db, bookIds[4], "rec_w4_quay");
    expect(fromBookFive.outgoing.some((row) => row.scope === "series" && row.toRecordId === "rec_w4_harbour")).toBe(
      true,
    );

    const graph = await loadProjectRelationshipGraph(t.db, bookIds[4]);
    expect(graph.edges.some((edge) => edge.fromRecordId === "rec_w4_quay" && edge.scope === "series")).toBe(true);
    expect(graph.nodes.some((node) => node.id === "rec_w4_harbour" && node.homeProjectId === bookIds[0])).toBe(true);

    await t.db.record.update({ where: { id: "rec_w4_harbour" }, data: { worldScope: "book" } });
    const after = await getWorldMap(t.db, bookIds[1], map.id);
    expect(after.pins.find((p) => p.recordId === "rec_w4_harbour")?.unavailable).toBe(true);

    await t.db.record.update({ where: { id: "rec_w4_mara" }, data: { worldScope: "book" } });
    const boardAfter = await getBoard(t.db, bookIds[2], board.id);
    expect(boardAfter.cards.find((c) => c.recordId === "rec_w4_mara")?.unavailable).toBe(true);
  });

  it("keeps custom kind templates home-isolated and optionally series-shared", async () => {
    await saveWorldKindTemplate(t.db, {
      projectId: bookIds[0],
      kind: "TideMark",
      fields: [{ key: "phase", label: "Phase", multiline: false }],
      worldScope: "series",
    });
    await saveWorldKindTemplate(t.db, {
      projectId: bookIds[1],
      kind: "TideMark",
      fields: [{ key: "localPhase", label: "Local phase", multiline: false }],
    });

    const localBookTwo = await listAvailableWorldKindTemplates(t.db, bookIds[1]);
    expect(localBookTwo.find((row) => row.kind === "TideMark" && !row.home)?.fields[0]?.key).toBe("localPhase");

    const avail = await listAvailableWorldKindTemplates(t.db, bookIds[2]);
    expect(avail.find((row) => row.kind === "TideMark")?.home?.projectId).toBe(bookIds[0]);
    expect(avail.find((row) => row.kind === "TideMark")?.fields[0]?.key).toBe("phase");

    await setWorldKindTemplateScope(t.db, {
      projectId: bookIds[0],
      kind: "TideMark",
      worldScope: "book",
    });
    const afterUnshare = await listAvailableWorldKindTemplates(t.db, bookIds[2]);
    expect(afterUnshare.some((row) => row.kind === "TideMark")).toBe(false);
  });
});
