import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadCrossRefIndex } from "@/server/services/crossRefService";
import { listMentionedBy } from "@/server/services/mentionedByService";
import { searchUnifiedProject } from "@/server/services/projectUnifiedSearchService";
import { createTestDb, IDS, seedProject, snapshotState, type TestDb } from "../helpers";

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
  await seedProject(t.db);
});

afterEach(async () => {
  await t.cleanup();
});

describe("project search and mentioned-by", () => {
  it("finds manuscript and reference hits without changing the database", async () => {
    const before = await snapshotState(t.db);
    const hits = await searchUnifiedProject(t.db, {
      projectId: IDS.project,
      query: "Mara",
      hasDrafts: false,
      draftId: null,
    });
    const after = await snapshotState(t.db);
    expect(after).toEqual(before);

    const sources = new Set(hits.map((h) => h.source));
    expect(sources.has("manuscript")).toBe(true);
    expect(sources.has("record")).toBe(true);
    expect(hits.some((h) => h.id === IDS.chapter && h.source === "manuscript")).toBe(true);
    expect(hits.some((h) => h.id === IDS.dossier)).toBe(true);
  });

  it("lists manuscript name hits in Mentioned by for a dossier", async () => {
    const index = await loadCrossRefIndex(t.db, IDS.project);
    const items = await listMentionedBy(t.db, IDS.project, IDS.dossier, index);
    expect(items.some((i) => i.kind === "manuscript_name" && i.title === "Chapter 1")).toBe(true);
  });
});