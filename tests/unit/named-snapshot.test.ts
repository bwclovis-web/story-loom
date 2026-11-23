import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getRecord } from "@/server/services/recordService";
import { labelRevision, takeNamedSnapshot } from "@/server/services/revisionLabelService";
import { MutationRejectedError, StaleRevisionError } from "@/server/services/errors";
import { createTestDb, type TestDb } from "../helpers";
import { ROADMAP_CHAPTER_BODY, ROADMAP_IDS, seedRoadmapSeries } from "../helpers/roadmapFixture";

describe("takeNamedSnapshot (Phase 3)", () => {
  let t: TestDb;

  beforeEach(async () => {
    t = await createTestDb();
    await seedRoadmapSeries(t.db);
  });

  afterEach(() => t.cleanup());

  it("labels the tip without writing a new revision when content is unchanged", async () => {
    const before = await getRecord(t.db, ROADMAP_IDS.book1, ROADMAP_IDS.chapter);
    const auditsBefore = await t.db.auditEntry.count();
    const result = await takeNamedSnapshot(t.db, ROADMAP_IDS.book1, {
      recordId: ROADMAP_IDS.chapter,
      expectedRevision: before.currentRevision,
      title: before.title,
      body: before.body,
      fields: before.fields,
      label: "Dry ledger beat",
    });
    expect(result).toEqual({
      revision: before.currentRevision,
      label: "Dry ledger beat",
      createdRevision: false,
    });
    const tip = await t.db.revision.findUnique({
      where: {
        recordId_revisionNumber: {
          recordId: ROADMAP_IDS.chapter,
          revisionNumber: before.currentRevision,
        },
      },
    });
    expect(tip?.label).toBe("Dry ledger beat");
    expect(await getRecord(t.db, ROADMAP_IDS.book1, ROADMAP_IDS.chapter)).toMatchObject({
      currentRevision: before.currentRevision,
      body: ROADMAP_CHAPTER_BODY,
    });
    expect(await t.db.auditEntry.count()).toBeGreaterThan(auditsBefore);
  });

  it("saves a protected manuscript change then labels the new tip", async () => {
    const before = await getRecord(t.db, ROADMAP_IDS.book1, ROADMAP_IDS.chapter);
    expect(before.protected).toBe(true);
    const nextBody = `${before.body}\n\nMara closed the ledger.`;
    const result = await takeNamedSnapshot(t.db, ROADMAP_IDS.book1, {
      recordId: ROADMAP_IDS.chapter,
      expectedRevision: before.currentRevision,
      title: before.title,
      body: nextBody,
      fields: before.fields,
      unlockProtected: true,
      label: "Before the quay",
    });
    expect(result.createdRevision).toBe(true);
    expect(result.revision).toBe(before.currentRevision + 1);
    expect(result.label).toBe("Before the quay");
    const after = await getRecord(t.db, ROADMAP_IDS.book1, ROADMAP_IDS.chapter);
    expect(after.body).toBe(nextBody);
    expect(after.currentRevision).toBe(result.revision);
    const tip = await t.db.revision.findUnique({
      where: {
        recordId_revisionNumber: { recordId: ROADMAP_IDS.chapter, revisionNumber: result.revision },
      },
    });
    expect(tip?.label).toBe("Before the quay");
  });

  it("refuses protected content changes without unlock", async () => {
    const before = await getRecord(t.db, ROADMAP_IDS.book1, ROADMAP_IDS.chapter);
    await expect(
      takeNamedSnapshot(t.db, ROADMAP_IDS.book1, {
        recordId: ROADMAP_IDS.chapter,
        expectedRevision: before.currentRevision,
        title: before.title,
        body: `${before.body}\nextra`,
        fields: before.fields,
        label: "Should fail",
      }),
    ).rejects.toBeInstanceOf(MutationRejectedError);
    const after = await getRecord(t.db, ROADMAP_IDS.book1, ROADMAP_IDS.chapter);
    expect(after.currentRevision).toBe(before.currentRevision);
  });

  it("refuses a stale expected revision", async () => {
    const before = await getRecord(t.db, ROADMAP_IDS.book1, ROADMAP_IDS.chapter);
    await expect(
      takeNamedSnapshot(t.db, ROADMAP_IDS.book1, {
        recordId: ROADMAP_IDS.chapter,
        expectedRevision: before.currentRevision - 1,
        title: before.title,
        body: before.body,
        fields: before.fields,
        label: "Stale",
      }),
    ).rejects.toBeInstanceOf(StaleRevisionError);
  });

  it("requires a non-empty snapshot name", async () => {
    const before = await getRecord(t.db, ROADMAP_IDS.book1, ROADMAP_IDS.chapter);
    await expect(
      takeNamedSnapshot(t.db, ROADMAP_IDS.book1, {
        recordId: ROADMAP_IDS.chapter,
        expectedRevision: before.currentRevision,
        title: before.title,
        body: before.body,
        fields: before.fields,
        label: "   ",
      }),
    ).rejects.toBeInstanceOf(MutationRejectedError);
  });

  it("can rename an existing labelled revision without rewriting prose", async () => {
    const before = await getRecord(t.db, ROADMAP_IDS.book1, ROADMAP_IDS.chapter);
    await labelRevision(t.db, ROADMAP_IDS.book1, {
      recordId: ROADMAP_IDS.chapter,
      revisionNumber: before.currentRevision,
      label: "First name",
    });
    await labelRevision(t.db, ROADMAP_IDS.book1, {
      recordId: ROADMAP_IDS.chapter,
      revisionNumber: before.currentRevision,
      label: "Second name",
    });
    const tip = await t.db.revision.findUnique({
      where: {
        recordId_revisionNumber: {
          recordId: ROADMAP_IDS.chapter,
          revisionNumber: before.currentRevision,
        },
      },
    });
    expect(tip?.label).toBe("Second name");
    expect((await getRecord(t.db, ROADMAP_IDS.book1, ROADMAP_IDS.chapter)).body).toBe(ROADMAP_CHAPTER_BODY);
  });
});
