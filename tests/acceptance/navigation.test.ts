import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProject, listProjectSummaries } from "@/server/services/projectService";
import { listRecordNav } from "@/server/services/recordService";
import { countOpenReviewItems } from "@/server/services/reviewService";
import { countWords } from "@/writing/wordCount";
import { CHAPTER_PROSE, createTestDb, IDS, seedProject, snapshotState, type TestDb } from "../helpers";

/* Navigation data: real counts from the database, read without changing anything. Invented content only. */

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
  await seedProject(t.db);
});
afterEach(async () => {
  await t.cleanup();
});

describe("project summaries", () => {
  it("report real record, chapter and word counts per project", async () => {
    await createProject(t.db, { id: "prj_empty", workspaceId: IDS.workspace, title: "Empty book" });
    const summaries = await listProjectSummaries(t.db);
    expect(summaries).toEqual([
      {
        id: IDS.project,
        title: "Test novel",
        workspaceId: IDS.workspace,
        workspaceName: "Test workspace",
        recordCount: 5,
        chapterCount: 1,
        manuscriptWords: countWords(CHAPTER_PROSE),
      },
      {
        id: "prj_empty",
        title: "Empty book",
        workspaceId: IDS.workspace,
        workspaceName: "Test workspace",
        recordCount: 0,
        chapterCount: 0,
        manuscriptWords: 0,
      },
    ]);
  });

  it("list records for navigation without their text and without writing", async () => {
    const before = await snapshotState(t.db);
    const entries = await listRecordNav(t.db, IDS.project);
    expect(entries.map((e) => e.id).sort()).toEqual(
      [IDS.chapter, IDS.outline, IDS.dossier, IDS.world, IDS.decision].sort(),
    );
    for (const e of entries) expect(Object.keys(e).sort()).toEqual(["createdAt", "id", "parentRecordId", "position", "title", "type"]);
    expect(await listRecordNav(t.db, "prj_missing")).toEqual([]);
    expect(await countOpenReviewItems(t.db, IDS.project)).toBe(0);
    expect(await snapshotState(t.db)).toEqual(before);
  });
});
