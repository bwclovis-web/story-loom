import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "@/server/services/backupService";
import { createProject, createWorkspace } from "@/server/services/projectService";
import {
  createRecord,
  getRecord,
  listWorldIndex,
  updateRecord,
} from "@/server/services/recordService";
import {
  createSmartCollection,
  deleteSmartCollection,
  getSmartCollection,
  listSmartCollections,
  updateSmartCollection,
} from "@/server/services/smartCollectionService";
import { addWorldMapPin, createWorldMap, getWorldMap } from "@/server/services/worldMapService";
import { addRecordImages } from "@/server/services/imageService";
import {
  collectionFilterFromWorldHubQuery,
  applyWorldCollectionFilter,
  worldHubQueryFromCollectionFilter,
} from "@/world/worldHubCollections";
import { projectWorldHubRecord } from "@/world/hubDiscovery";
import { createTestDb, type TestDb } from "../helpers";
import { makePng } from "../imageFixtures";

/**
 * Saved World Hub Collections: Book Two Technology → Transportation
 * includes Book One’s series-shared Saltmarsh Station once (secondary membership).
 */
describe("Saved World Hub Collections", () => {
  let t: TestDb;
  const workspaceId = "wsp_whc";
  const bookOne = "prj_whc_b1";
  const bookTwo = "prj_whc_b2";
  const bookOther = "prj_whc_other";
  const stationId = "rec_whc_station";
  const ferryId = "rec_whc_ferry";

  beforeEach(async () => {
    t = await createTestDb();
    await createWorkspace(t.db, { id: workspaceId, name: "World Collections Workspace" });
    await createProject(t.db, { id: bookOne, workspaceId, title: "Book One" });
    await createProject(t.db, { id: bookTwo, workspaceId, title: "Book Two" });
    await createProject(t.db, { id: bookOther, workspaceId, title: "Other Series" });
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

  function hubRecordsFor(projectId: string) {
    return listWorldIndex(t.db, projectId).then((rows) =>
      rows.map(({ record, home }) =>
        projectWorldHubRecord({
          id: record.id,
          title: record.title,
          type: record.type,
          authorityStatus: record.authorityStatus,
          protected: record.protected,
          currentRevision: record.currentRevision,
          worldScope: record.worldScope,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          fields: record.fields,
          home,
        }),
      ),
    );
  }

  const transportQuery = {
    type: null,
    kind: null,
    q: "",
    list: true,
    category: "technology" as const,
    subcategory: "transportation",
    tag: null,
    customKind: null,
    unclassified: false,
    scope: null,
    status: null,
    protected: null,
    sort: "updated" as const,
    view: "list" as const,
  };

  it("saves Transport references, opens restored filters, and shows Saltmarsh once with two map pins", async () => {
    await createRecord(t.db, bookTwo, {
      recordId: "rec_whc_map_host",
      type: "worldbuilding",
      title: "Map host",
      body: "",
      fields: { kind: "place" },
      authorityStatus: "draft",
    });
    const [image] = await addRecordImages(
      t.db,
      bookTwo,
      "rec_whc_map_host",
      [{ filename: "coast.png", bytes: makePng(16, 16) }],
      { confirmProtected: false },
    );
    const map = await createWorldMap(t.db, bookTwo, { title: "Coast", imageId: image.id });
    await addWorldMapPin(t.db, bookTwo, map.id, {
      recordId: stationId,
      xNorm: 0.2,
      yNorm: 0.3,
      kind: "point",
    });
    await addWorldMapPin(t.db, bookTwo, map.id, {
      recordId: stationId,
      xNorm: 0.7,
      yNorm: 0.8,
      kind: "point",
    });

    const collection = await createSmartCollection(t.db, bookTwo, {
      title: "Transport references",
      scope: "world",
      filter: collectionFilterFromWorldHubQuery(transportQuery),
    });
    expect(collection.scope).toBe("world");
    expect(collection.filter.category).toBe("technology");
    expect(collection.filter.subcategory).toBe("transportation");

    const restored = worldHubQueryFromCollectionFilter(collection.filter);
    expect(restored.category).toBe("technology");
    expect(restored.subcategory).toBe("transportation");

    const matched = applyWorldCollectionFilter(await hubRecordsFor(bookTwo), collection.filter);
    expect(matched.map((r) => r.id)).toEqual([stationId]);
    expect(matched[0]?.home?.projectId).toBe(bookOne);

    const loadedMap = await getWorldMap(t.db, bookTwo, map.id);
    expect(loadedMap.pins.filter((pin) => pin.recordId === stationId)).toHaveLength(2);
  });

  it("reevaluates membership when a second reference is added and Saltmarsh loses Transportation", async () => {
    const collection = await createSmartCollection(t.db, bookTwo, {
      title: "Transport references",
      scope: "world",
      filter: collectionFilterFromWorldHubQuery(transportQuery),
    });

    await createRecord(t.db, bookTwo, {
      recordId: ferryId,
      type: "worldbuilding",
      title: "Harbor Ferry",
      body: "Local boat.",
      fields: {
        kind: "place",
        taxonomy: {
          version: 1,
          primary: { category: "technology", subcategory: "transportation" },
        },
      },
      authorityStatus: "draft",
      worldScope: "book",
    });

    let matched = applyWorldCollectionFilter(await hubRecordsFor(bookTwo), collection.filter);
    expect(matched.map((r) => r.id).sort()).toEqual([ferryId, stationId]);

    const station = await getRecord(t.db, bookOne, stationId);
    await updateRecord(t.db, bookOne, {
      recordId: stationId,
      expectedRevision: station.currentRevision,
      fields: {
        ...station.fields,
        taxonomy: {
          version: 1,
          primary: { category: "locations" },
        },
      },
    });

    matched = applyWorldCollectionFilter(await hubRecordsFor(bookTwo), collection.filter);
    expect(matched.map((r) => r.id)).toEqual([ferryId]);
  });

  it("keeps the saved filter until Update collection; empty collections stay open; projects stay isolated", async () => {
    const collection = await createSmartCollection(t.db, bookTwo, {
      title: "Transport references",
      scope: "world",
      filter: collectionFilterFromWorldHubQuery(transportQuery),
    });

    const locationsFilter = collectionFilterFromWorldHubQuery({
      ...transportQuery,
      category: "locations",
      subcategory: null,
    });
    // Experimenting does not write until updateSmartCollection.
    expect(collection.filter.category).toBe("technology");
    const reopened = await getSmartCollection(t.db, bookTwo, collection.id);
    expect(reopened.filter.category).toBe("technology");
    expect(reopened.filter.subcategory).toBe("transportation");

    await updateSmartCollection(t.db, bookTwo, collection.id, { filter: locationsFilter });
    const updated = await getSmartCollection(t.db, bookTwo, collection.id);
    expect(updated.filter.category).toBe("locations");
    expect(updated.filter.subcategory).toBeUndefined();

    const emptyish = await createSmartCollection(t.db, bookTwo, {
      title: "Empty magic",
      scope: "world",
      filter: collectionFilterFromWorldHubQuery({
        ...transportQuery,
        category: "magic",
        subcategory: null,
      }),
    });
    const emptyMatches = applyWorldCollectionFilter(await hubRecordsFor(bookTwo), emptyish.filter);
    expect(emptyMatches).toHaveLength(0);
    expect(await getSmartCollection(t.db, bookTwo, emptyish.id)).toBeTruthy();

    expect(await listSmartCollections(t.db, bookOne, "world")).toHaveLength(0);
    expect(await listSmartCollections(t.db, bookOther, "world")).toHaveLength(0);
    expect(await listSmartCollections(t.db, bookTwo, "world")).toHaveLength(2);

    const manuscript = await createSmartCollection(t.db, bookTwo, {
      title: "Rough scenes",
      scope: "manuscript",
      filter: { query: "tide" },
    });
    expect(manuscript.scope).toBe("manuscript");
    expect((await listSmartCollections(t.db, bookTwo, "manuscript")).map((c) => c.id)).toContain(manuscript.id);
  });

  it("survives workspace backup/restore and deletes without removing records or pins", async () => {
    await createRecord(t.db, bookTwo, {
      recordId: "rec_whc_map_host2",
      type: "worldbuilding",
      title: "Map host 2",
      body: "",
      fields: { kind: "place" },
      authorityStatus: "draft",
    });
    const [image] = await addRecordImages(
      t.db,
      bookTwo,
      "rec_whc_map_host2",
      [{ filename: "bay.png", bytes: makePng(16, 16) }],
      { confirmProtected: false },
    );
    const map = await createWorldMap(t.db, bookTwo, { title: "Bay", imageId: image.id });
    await addWorldMapPin(t.db, bookTwo, map.id, {
      recordId: stationId,
      xNorm: 0.4,
      yNorm: 0.5,
      kind: "point",
    });

    const collection = await createSmartCollection(t.db, bookTwo, {
      title: "Transport references",
      scope: "world",
      filter: collectionFilterFromWorldHubQuery(transportQuery),
    });
    await createSmartCollection(t.db, bookTwo, {
      title: "Rough scenes",
      scope: "manuscript",
      filter: { query: "tide" },
    });

    const backup = await createWorkspaceBackup(t.db, workspaceId);
    expect(backup.smartCollections?.some((c) => c.id === collection.id && c.scope === "world")).toBe(true);

    const target = await createTestDb();
    try {
      const outcome = await restoreWorkspaceBackup(target.db, backup, { idStrategy: "preserve" });
      expect(outcome.ok).toBe(true);
      const restored = await getSmartCollection(target.db, bookTwo, collection.id);
      expect(restored.title).toBe("Transport references");
      expect(restored.filter.category).toBe("technology");
      expect(restored.scope).toBe("world");
      const manuscript = await listSmartCollections(target.db, bookTwo, "manuscript");
      expect(manuscript).toHaveLength(1);
    } finally {
      await target.cleanup();
    }

    await deleteSmartCollection(t.db, bookTwo, collection.id);
    await expect(getSmartCollection(t.db, bookTwo, collection.id)).rejects.toThrow();
    expect(await getRecord(t.db, bookOne, stationId)).toBeTruthy();
    const pins = (await getWorldMap(t.db, bookTwo, map.id)).pins.filter((pin) => pin.recordId === stationId);
    expect(pins).toHaveLength(1);
  });
});
