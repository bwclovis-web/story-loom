import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getManuscriptSnapshot } from "@/server/services/manuscriptSnapshotService";
import { NotFoundError } from "@/server/services/errors";
import { CHAPTER_PROSE, createTestDb, IDS, seedProject, type TestDb } from "../helpers";

describe("manuscript snapshot for split view", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("returns saved manuscript text for a chapter", async () => {
    const snapshot = await getManuscriptSnapshot(t.db, IDS.project, IDS.chapter);
    expect(snapshot.id).toBe(IDS.chapter);
    expect(snapshot.body).toBe(CHAPTER_PROSE);
    expect(snapshot.kind).toBe("chapter");
  });

  it("refuses a missing record", async () => {
    await expect(getManuscriptSnapshot(t.db, IDS.project, "missing-record")).rejects.toBeInstanceOf(NotFoundError);
  });
});