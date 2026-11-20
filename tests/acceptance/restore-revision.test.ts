import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getRecord, listRevisions, restoreRecordFromRevision, updateRecord } from "@/server/services/recordService";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";

describe("restore revision", () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await createTestDb();
    await seedProject(t.db);
    await updateRecord(t.db, IDS.project, {
      recordId: IDS.chapter,
      expectedRevision: 1,
      body: "Revised opening.",
      unlockProtected: true,
    });
  });

  afterAll(async () => {
    await t.cleanup();
  });

  it("writes an older revision as a new revision without changing canon status", async () => {
    const before = await getRecord(t.db, IDS.project, IDS.chapter);
    expect(before.currentRevision).toBe(2);
    expect(before.body).toBe("Revised opening.");
    expect(before.authorityStatus).toBe("draft");

    const batch = await restoreRecordFromRevision(t.db, IDS.project, {
      recordId: IDS.chapter,
      expectedRevision: 2,
      fromRevisionNumber: 1,
      unlockProtected: true,
    });
    expect(batch.outcomes[0]?.newRevision).toBe(3);

    const after = await getRecord(t.db, IDS.project, IDS.chapter);
    const rev1 = (await listRevisions(t.db, IDS.chapter)).find((r) => r.revisionNumber === 1);
    expect(rev1?.body).toBeTruthy();
    expect(after.body).toBe(rev1!.body);
    expect(after.authorityStatus).toBe("draft");
    expect(after.currentRevision).toBe(3);

    const revisions = await listRevisions(t.db, IDS.chapter);
    expect(revisions[0]?.revisionNumber).toBe(3);
    expect(revisions[0]?.source.kind).toBe("restore");
    expect(revisions[0]?.source.conversationLabel).toBe("revision 1");
    expect(revisions.some((r) => r.revisionNumber === 1 && r.body === rev1!.body)).toBe(true);
    expect(revisions.some((r) => r.revisionNumber === 2 && r.body === "Revised opening.")).toBe(true);
  });

  it("can restore structured fields when asked", async () => {
    await updateRecord(t.db, IDS.project, {
      recordId: IDS.dossier,
      expectedRevision: 1,
      fields: { name: "Mara Venn", age: 31 },
    });
    const mara = await getRecord(t.db, IDS.project, IDS.dossier);
    await restoreRecordFromRevision(t.db, IDS.project, {
      recordId: IDS.dossier,
      expectedRevision: mara.currentRevision,
      fromRevisionNumber: 1,
      includeFields: true,
    });
    const restored = await getRecord(t.db, IDS.project, IDS.dossier);
    expect(restored.fields.age).toBe(30);
  });

  it("refuses when content already matches", async () => {
    const dossier = await getRecord(t.db, IDS.project, IDS.dossier);
    await expect(
      restoreRecordFromRevision(t.db, IDS.project, {
        recordId: IDS.dossier,
        expectedRevision: dossier.currentRevision,
        fromRevisionNumber: dossier.currentRevision - 1,
      }),
    ).rejects.toThrow();
  });
});