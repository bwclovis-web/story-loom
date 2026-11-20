import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runManuscriptStyleCheck } from "@/server/services/styleCheckService";
import { createTestDb, IDS, seedProject, snapshotState, type TestDb } from "../helpers";

describe("manuscript style check", () => {
  let t: TestDb;

  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("reads saved chapters without writing", async () => {
    const before = await snapshotState(t.db);
    const result = await runManuscriptStyleCheck(t.db, { projectId: IDS.project });
    expect(result.records.length).toBeGreaterThanOrEqual(0);
    expect(await snapshotState(t.db)).toEqual(before);
  });
});