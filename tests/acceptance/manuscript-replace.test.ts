import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getRecord, updateRecord } from "@/server/services/recordService";
import { applyManuscriptReplace, previewManuscriptReplace } from "@/server/services/manuscriptReplaceService";
import { matchId } from "@/writing/findReplace";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";

describe("manuscript replace", () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await createTestDb();
    await seedProject(t.db);
    const base = await getRecord(t.db, IDS.project, IDS.chapter);
    await updateRecord(t.db, IDS.project, {
      recordId: IDS.chapter,
      expectedRevision: 1,
      body: `${base.body} Ledger twice: ledger.`,
      unlockProtected: true,
    });
  });

  afterAll(async () => {
    await t.cleanup();
  });

  it("previews and applies selected matches across one chapter", async () => {
    const preview = await previewManuscriptReplace(t.db, {
      projectId: IDS.project,
      find: "ledger",
      replace: "tome",
      matchCase: false,
      wholeWord: true,
      hasDrafts: false,
    });
    expect(preview.matches.length).toBeGreaterThan(0);
    const ids = preview.matches.map((m) => m.id);

    const batch = await applyManuscriptReplace(t.db, {
      projectId: IDS.project,
      find: "ledger",
      replace: "tome",
      matchCase: false,
      wholeWord: true,
      selectedMatchIds: ids,
      recordRevisions: Object.fromEntries(
        [...new Set(preview.matches.map((m) => m.recordId))].map((id) => [
          id,
          preview.matches.find((m) => m.recordId === id)!.expectedRevision,
        ]),
      ),
      unlockProtected: true,
      hasDrafts: false,
    });
    expect(batch.outcomes.length).toBe(1);
    const chapter = await getRecord(t.db, IDS.project, IDS.chapter);
    expect(chapter.body.toLowerCase()).not.toContain("ledger");
    expect(chapter.body.toLowerCase()).toContain("tome");
  });

  it("refuses stale revision", async () => {
    const chapter = await getRecord(t.db, IDS.project, IDS.chapter);
    const preview = await previewManuscriptReplace(t.db, {
      projectId: IDS.project,
      find: "Mara",
      replace: "Elin",
      matchCase: false,
      wholeWord: false,
      hasDrafts: false,
    });
    const id = preview.matches[0]?.id;
    expect(id).toBeTruthy();
    const staleRev = chapter.currentRevision;
    await updateRecord(t.db, IDS.project, {
      recordId: IDS.chapter,
      expectedRevision: staleRev,
      body: `${chapter.body}\n`,
      unlockProtected: true,
    });
    await expect(
      applyManuscriptReplace(t.db, {
        projectId: IDS.project,
        find: "Mara",
        replace: "Elin",
        matchCase: false,
        wholeWord: false,
        selectedMatchIds: [id!],
        recordRevisions: { [IDS.chapter]: staleRev },
        unlockProtected: true,
        hasDrafts: false,
      }),
    ).rejects.toThrow();
  });

  it("builds stable match ids", async () => {
    const chapter = await getRecord(t.db, IDS.project, IDS.chapter);
    expect(matchId(chapter.id, "body", 0, 4)).toBe(`${chapter.id}:body:0:4`);
  });
});