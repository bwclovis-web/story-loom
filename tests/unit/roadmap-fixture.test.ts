import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listContinuityLedger } from "@/server/services/continuityService";
import { createTestDb, type TestDb } from "../helpers";
import { ROADMAP_IDS, ROADMAP_SERIES, seedRoadmapSeries } from "../helpers/roadmapFixture";

describe("roadmap fixture (Phase 0)", () => {
  let t: TestDb;

  beforeEach(async () => {
    t = await createTestDb();
  });

  afterEach(() => t.cleanup());

  it("seeds an invented two-book series on an isolated database", async () => {
    const ids = await seedRoadmapSeries(t.db);
    expect(ids.book1).toBe(ROADMAP_IDS.book1);

    const projects = await t.db.project.findMany({ orderBy: { id: "asc" } });
    expect(projects).toHaveLength(2);
    expect(projects.every((p) => p.seriesName === ROADMAP_SERIES)).toBe(true);

    const records = await t.db.record.findMany({ where: { projectId: ROADMAP_IDS.book1 } });
    expect(records.map((r) => r.id).sort()).toEqual(
      [
        ROADMAP_IDS.chapter,
        ROADMAP_IDS.continuityNote,
        ROADMAP_IDS.decision,
        ROADMAP_IDS.dossierApproved,
        ROADMAP_IDS.dossierDraft,
        ROADMAP_IDS.place,
        ROADMAP_IDS.scene,
      ].sort(),
    );

    const scene = records.find((r) => r.id === ROADMAP_IDS.scene);
    expect(scene?.parentRecordId).toBe(ROADMAP_IDS.chapter);
  });

  it("exposes Continuity Ledger items without writing", async () => {
    await seedRoadmapSeries(t.db);
    const before = await t.db.auditEntry.count();
    const items = await listContinuityLedger(t.db, ROADMAP_IDS.book1, { includeSuppressed: true });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.key && item.href && item.kind)).toBe(true);
    expect(await t.db.auditEntry.count()).toBe(before);
  });
});
