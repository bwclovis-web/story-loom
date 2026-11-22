import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addPlaceRelation } from "@/server/services/placeRelationService";
import { addRecordRelation } from "@/server/services/recordRelationService";
import { createRecord, getRecord, updateRecord } from "@/server/services/recordService";
import { linkReference } from "@/server/services/linkService";
import {
  buildMentionEdges,
  loadProjectAllConnectionsGraph,
  loadProjectRelationshipGraph,
} from "@/server/services/relationshipGraphService";
import { loadCrossRefIndex } from "@/server/services/crossRefService";
import { addRecordImages, recordImagePublicPath, setRecordImagePrimary } from "@/server/services/imageService";
import { buildGeographyForest, subgraphByHops, DEFAULT_GRAPH_KINDS } from "@/world/relationshipGraph";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";
import { makePng } from "../imageFixtures";

describe("relationship views data", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
    const guild = await getRecord(t.db, IDS.project, IDS.world);
    await updateRecord(t.db, IDS.project, {
      recordId: IDS.world,
      expectedRevision: guild.currentRevision,
      fields: { ...guild.fields, kind: "organization" },
    });
    await createRecord(t.db, IDS.project, {
      recordId: "rec_test_quay",
      type: "worldbuilding",
      title: "Salt Quay",
      body: "Docks.",
      fields: { kind: "place", name: "Salt Quay" },
      authorityStatus: "approved",
    });
    await createRecord(t.db, IDS.project, {
      recordId: "rec_test_river",
      type: "worldbuilding",
      title: "Silverwater",
      body: "River.",
      fields: { kind: "place", name: "Silverwater" },
      authorityStatus: "approved",
    });
    await addRecordRelation(t.db, IDS.project, {
      fromRecordId: IDS.dossier,
      toRecordId: IDS.world,
      kind: "member_of",
    });
    await addPlaceRelation(t.db, IDS.project, {
      fromRecordId: "rec_test_quay",
      toRecordId: "rec_test_river",
      kind: "part_of",
    });
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("loads project edges for the relationships page", async () => {
    const graph = await loadProjectRelationshipGraph(t.db, IDS.project);
    expect(graph.edges).toHaveLength(2);
    const sub = subgraphByHops(graph.nodes, graph.edges, IDS.dossier, 1, new Set(DEFAULT_GRAPH_KINDS));
    expect(sub.nodes.some((n) => n.id === IDS.world)).toBe(true);
    const geo = buildGeographyForest(graph.nodes, graph.edges);
    const river = geo.find((t) => t.id === "rec_test_river");
    expect(river?.children[0]?.id).toBe("rec_test_quay");
  });

  it("loads all-connections edges for links and manuscript names", async () => {
    const chapter = await getRecord(t.db, IDS.project, IDS.chapter);
    await updateRecord(t.db, IDS.project, {
      recordId: IDS.chapter,
      expectedRevision: chapter.currentRevision,
      body: `${chapter.body}\n\nAldric met the guild at the quay.`,
      unlockProtected: true,
    });
    await linkReference(t.db, IDS.project, IDS.chapter, IDS.world);
    const all = await loadProjectAllConnectionsGraph(t.db, IDS.project);
    expect(all.edges.some((e) => e.family === "link")).toBe(true);
    const index = await loadCrossRefIndex(t.db, IDS.project);
    const mentions = buildMentionEdges(index);
    expect(mentions.some((e) => e.kind === "named_in")).toBe(true);
    expect(all.edges.length).toBeGreaterThan(2);
  });

  it("attaches profile image URLs to graph nodes when set", async () => {
    const [first, second] = await addRecordImages(
      t.db,
      IDS.project,
      IDS.dossier,
      [
        { filename: "a.png", bytes: makePng(8, 8) },
        { filename: "b.png", bytes: makePng(8, 8) },
      ],
      { confirmProtected: false },
    );
    await setRecordImagePrimary(t.db, IDS.project, IDS.dossier, second.id, { confirmProtected: false });
    const graph = await loadProjectRelationshipGraph(t.db, IDS.project);
    const dossier = graph.nodes.find((n) => n.id === IDS.dossier);
    expect(dossier?.profileImageUrl).toBe(recordImagePublicPath(IDS.project, second.id));
    expect(dossier?.profileImageUrl).not.toBe(recordImagePublicPath(IDS.project, first.id));
    const guild = graph.nodes.find((n) => n.id === IDS.world);
    expect(guild?.profileImageUrl ?? null).toBeNull();
  });
});