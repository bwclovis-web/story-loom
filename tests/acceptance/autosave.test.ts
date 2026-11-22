import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AUTOSAVE_COALESCE_MS, autosaveRecord, tipRevisionSourceKind } from "@/server/services/autosaveService";
import { setRecordProtection } from "@/server/services/mutationService";
import { getRecord, listRevisions, updateRecord } from "@/server/services/recordService";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";

describe("unlocked autosave", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(() => t.cleanup());

  it("refuses protected records", async () => {
    const chapter = await getRecord(t.db, IDS.project, IDS.chapter);
    expect(chapter.protected).toBe(true);
    await expect(
      autosaveRecord(t.db, IDS.project, {
        recordId: IDS.chapter,
        expectedRevision: chapter.currentRevision,
        title: chapter.title,
        body: "should not save",
        fields: {},
      }),
    ).rejects.toMatchObject({ name: "MutationRejectedError" });
  });

  it("creates an autosave revision then coalesces the tip", async () => {
    await setRecordProtection(t.db, {
      projectId: IDS.project,
      recordId: IDS.chapter,
      protected: false,
      actor: "author",
    });
    const chapter = await getRecord(t.db, IDS.project, IDS.chapter);

    const first = await autosaveRecord(t.db, IDS.project, {
      recordId: IDS.chapter,
      expectedRevision: chapter.currentRevision,
      title: chapter.title,
      body: "First unlocked draft.",
      fields: {},
    });
    expect(first.coalesced).toBe(false);
    expect(first.revision).toBe(chapter.currentRevision + 1);
    expect(await tipRevisionSourceKind(t.db, IDS.chapter)).toBe("autosave");

    const second = await autosaveRecord(t.db, IDS.project, {
      recordId: IDS.chapter,
      expectedRevision: first.revision,
      title: chapter.title,
      body: "First unlocked draft. Then more.",
      fields: {},
    });
    expect(second.coalesced).toBe(true);
    expect(second.revision).toBe(first.revision);

    const revisions = await listRevisions(t.db, IDS.chapter);
    const tip = revisions.find((r) => r.revisionNumber === first.revision);
    expect(tip?.body).toBe("First unlocked draft. Then more.");
    expect(tip?.source.kind).toBe("autosave");
    expect(revisions.filter((r) => r.source.kind === "autosave")).toHaveLength(1);
  });

  it("starts a new autosave revision after a manual save", async () => {
    await setRecordProtection(t.db, {
      projectId: IDS.project,
      recordId: IDS.chapter,
      protected: false,
      actor: "author",
    });
    let chapter = await getRecord(t.db, IDS.project, IDS.chapter);

    const auto = await autosaveRecord(t.db, IDS.project, {
      recordId: IDS.chapter,
      expectedRevision: chapter.currentRevision,
      title: chapter.title,
      body: "Autosaved once.",
      fields: {},
    });
    await updateRecord(t.db, IDS.project, {
      recordId: IDS.chapter,
      expectedRevision: auto.revision,
      title: chapter.title,
      body: "Manual save after autosave.",
      fields: {},
    });
    chapter = await getRecord(t.db, IDS.project, IDS.chapter);
    const again = await autosaveRecord(t.db, IDS.project, {
      recordId: IDS.chapter,
      expectedRevision: chapter.currentRevision,
      title: chapter.title,
      body: "Autosaved again after manual save.",
      fields: {},
    });
    expect(again.coalesced).toBe(false);
    expect(again.revision).toBe(chapter.currentRevision + 1);
    expect(AUTOSAVE_COALESCE_MS).toBeGreaterThan(0);
  });
});
