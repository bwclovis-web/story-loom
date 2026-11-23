import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listContinuityLedger,
  summarizeStoryHealth,
  suppressContinuityIssue,
} from "@/server/services/continuityService";
import { createTestDb, type TestDb } from "../helpers";
import { ROADMAP_IDS, seedRoadmapSeries } from "../helpers/roadmapFixture";

describe("Story Health (Phase 1)", () => {
  let t: TestDb;

  beforeEach(async () => {
    t = await createTestDb();
    await seedRoadmapSeries(t.db);
  });

  afterEach(() => t.cleanup());

  it("summarizes open Continuity Ledger findings without writing", async () => {
    const beforeAudits = await t.db.auditEntry.count();
    const items = await listContinuityLedger(t.db, ROADMAP_IDS.book1, { includeSuppressed: true });
    const health = summarizeStoryHealth(items);

    expect(items.length).toBeGreaterThan(0);
    expect(health.openCount).toBeGreaterThan(0);
    expect(health.next).toBeTruthy();
    expect(health.next?.href).toMatch(/^\/projects\//);
    expect(health.status === "attention" || health.status === "critical").toBe(true);
    expect(await t.db.auditEntry.count()).toBe(beforeAudits);
  });

  it("updates the summary when a finding is suppressed, without editing prose", async () => {
    const items = await listContinuityLedger(t.db, ROADMAP_IDS.book1, { includeSuppressed: true });
    const target = items.find((item) => !item.suppressed);
    expect(target).toBeTruthy();

    const chapterBefore = await t.db.record.findFirstOrThrow({ where: { id: ROADMAP_IDS.chapter } });
    await suppressContinuityIssue(t.db, ROADMAP_IDS.book1, {
      issueKey: target!.key,
      reason: "intentional",
    });

    const after = await listContinuityLedger(t.db, ROADMAP_IDS.book1, { includeSuppressed: true });
    const health = summarizeStoryHealth(after);
    expect(health.suppressedCount).toBeGreaterThanOrEqual(1);
    expect(after.find((item) => item.key === target!.key)?.suppressed).toBe(true);
    expect(health.openCount).toBe(items.filter((i) => !i.suppressed).length - 1);

    const chapterAfter = await t.db.record.findFirstOrThrow({ where: { id: ROADMAP_IDS.chapter } });
    expect(chapterAfter.body).toBe(chapterBefore.body);
    expect(chapterAfter.currentRevision).toBe(chapterBefore.currentRevision);
  });
});
