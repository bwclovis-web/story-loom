import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProject, createWorkspace } from "@/server/services/projectService";
import {
  createWorldMap,
  createWorldMapWithNewReference,
  deleteWorldMap,
  listWorldMaps,
  updateWorldMapDetails,
} from "@/server/services/worldMapService";
import { createTestDb, type TestDb } from "../helpers";
import { makePng } from "../imageFixtures";

async function emptyProject(db: TestDb["db"], id = "maps_lib") {
  await createWorkspace(db, { id: `wsp_${id}`, name: "Maps lib" });
  return createProject(db, { id: `prj_${id}`, workspaceId: `wsp_${id}`, title: "Maps library project" });
}

describe("Maps landing library", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("lists maps with optional classification and keeps host image after delete", async () => {
    const project = await emptyProject(t.db);
    const created = await createWorldMapWithNewReference(t.db, project.id, {
      title: "Harbour chart",
      referenceTitle: "Harbour chart image",
      type: "worldbuilding",
      authorityStatus: "draft",
      classification: "city",
      file: { filename: "harbour.png", bytes: makePng(16, 10) },
    });
    expect(created.classification).toBe("city");

    const listed = await listWorldMaps(t.db, project.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.classification).toBe("city");
    expect(listed[0]?.hostRecordTitle).toBe("Harbour chart image");
    expect(listed[0]?.imageId).toBe(created.imageId);

    await updateWorldMapDetails(t.db, project.id, created.id, { title: "Harbour", classification: "region" });
    const renamed = await listWorldMaps(t.db, project.id);
    expect(renamed[0]?.title).toBe("Harbour");
    expect(renamed[0]?.classification).toBe("region");

    const imagesBefore = await t.db.recordImage.count({ where: { projectId: project.id } });
    const recordsBefore = await t.db.record.count({ where: { projectId: project.id } });
    await deleteWorldMap(t.db, project.id, created.id);
    expect(await listWorldMaps(t.db, project.id)).toEqual([]);
    expect(await t.db.recordImage.count({ where: { projectId: project.id } })).toBe(imagesBefore);
    expect(await t.db.record.count({ where: { projectId: project.id } })).toBe(recordsBefore);
  });

  it("creates from an existing reference image and isolates projects", async () => {
    const project = await emptyProject(t.db, "maps_lib_a");
    const first = await createWorldMapWithNewReference(t.db, project.id, {
      title: "Coast",
      referenceTitle: "Coast atlas",
      type: "worldbuilding",
      authorityStatus: "draft",
      file: { filename: "coast.png", bytes: makePng(12, 8) },
    });
    expect(first.classification).toBeNull();

    const again = await createWorldMap(t.db, project.id, {
      title: "Coast overview",
      imageId: first.imageId,
      classification: "world",
    });
    expect(again.classification).toBe("world");
    expect(again.imageId).toBe(first.imageId);
    expect(again.hostRecordId).toBe(first.hostRecordId);

    const sibling = await createProject(t.db, {
      id: "prj_maps_lib_b",
      workspaceId: "wsp_maps_lib_a",
      title: "Other book",
    });
    expect(await listWorldMaps(t.db, sibling.id)).toEqual([]);
    expect(await listWorldMaps(t.db, project.id)).toHaveLength(2);
  });
});
