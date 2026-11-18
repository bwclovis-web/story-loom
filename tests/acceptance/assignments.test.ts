import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyAssignments,
  getAssignmentSnapshot,
  previewAssignments,
} from "@/server/services/assignmentService";
import { createRecord, getRecord } from "@/server/services/recordService";
import { CHAPTER_PROSE, createTestDb, IDS, seedProject, type TestDb } from "../helpers";

describe("Series/Book/Draft assignments", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("leaves an unassigned project unchanged and still readable", async () => {
    const snap = await getAssignmentSnapshot(t.db, IDS.project);
    expect(snap.plan.seriesName).toBeNull();
    expect(snap.plan.bookName).toBeNull();
    expect(snap.plan.draftKind).toBeNull();
    expect(snap.plan.groups).toEqual([]);
    expect(snap.assignmentRevision).toBe(0);

    const chapter = await getRecord(t.db, IDS.project, IDS.chapter);
    expect(chapter.body).toBe(CHAPTER_PROSE);
    expect(chapter.currentRevision).toBe(1);
  });

  it("previews and applies assignments atomically without rewriting content", async () => {
    const scene = await createRecord(t.db, IDS.project, {
      type: "manuscript_scene",
      title: "Scene A",
      body: "Mara opens the ledger.",
      authorityStatus: "draft",
      parentRecordId: IDS.chapter,
    });
    const sceneId = scene.outcomes[0].recordId;

    const preview = await previewAssignments(t.db, IDS.project, {
      seriesName: "Saltmarsh Annals",
      bookName: "The Wet Ledger",
      draftKind: "zero_draft",
      groups: [{ label: "Act I", position: 0, chapterIds: [IDS.chapter] }],
      worldScopes: [
        { recordId: IDS.dossier, scope: "series" },
        { recordId: IDS.world, scope: "book" },
      ],
    });
    expect(preview.issues).toEqual([]);
    expect(preview.previewToken).toMatch(/^[0-9a-f]{64}$/);
    expect(preview.plan.groups[0].sceneIds).toEqual([sceneId]);
    expect(preview.changes.noEffectiveChange).toBe(false);

    const before = await getRecord(t.db, IDS.project, IDS.chapter);
    const applied = await applyAssignments(t.db, IDS.project, {
      plan: preview.plan,
      previewToken: preview.previewToken,
    });
    expect(applied).toMatchObject({ status: "applied", assignmentRevision: 1 });

    const project = await t.db.project.findUniqueOrThrow({ where: { id: IDS.project } });
    expect(project.seriesName).toBe("Saltmarsh Annals");
    expect(project.bookName).toBe("The Wet Ledger");
    expect(project.draftKind).toBe("zero_draft");
    expect(project.assignmentRevision).toBe(1);

    const group = await t.db.manuscriptGroup.findFirstOrThrow({ where: { projectId: IDS.project } });
    expect(group.label).toBe("Act I");
    const chapter = await t.db.record.findUniqueOrThrow({ where: { id: IDS.chapter } });
    const sceneRow = await t.db.record.findUniqueOrThrow({ where: { id: sceneId } });
    expect(chapter.groupId).toBe(group.id);
    expect(sceneRow.groupId).toBe(group.id);
    expect(chapter.body).toBe(before.body);
    expect(chapter.currentRevision).toBe(before.currentRevision);

    const dossier = await t.db.record.findUniqueOrThrow({ where: { id: IDS.dossier } });
    const world = await t.db.record.findUniqueOrThrow({ where: { id: IDS.world } });
    expect(dossier.worldScope).toBe("series");
    expect(world.worldScope).toBe("book");
    expect(dossier.body).toContain("Archivist");
  });

  it("rejects a stale preview and treats an identical rerun as already_applied", async () => {
    const preview = await previewAssignments(t.db, IDS.project, {
      seriesName: "Series One",
      draftKind: "author_manuscript",
      groups: [],
      worldScopes: [],
    });
    expect(preview.issues).toEqual([]);

    const first = await applyAssignments(t.db, IDS.project, {
      plan: preview.plan,
      previewToken: preview.previewToken,
    });
    expect(first.status).toBe("applied");

    const stale = await applyAssignments(t.db, IDS.project, {
      plan: preview.plan,
      previewToken: preview.previewToken,
    });
    expect(stale.status).toBe("rejected");
    if (stale.status === "rejected") expect(stale.issues.map((i) => i.code)).toEqual(["STALE_PREVIEW"]);

    const again = await previewAssignments(t.db, IDS.project, {
      seriesName: "Series One",
      draftKind: "author_manuscript",
      groups: [],
      worldScopes: [],
    });
    const rerun = await applyAssignments(t.db, IDS.project, {
      plan: again.plan,
      previewToken: again.previewToken,
    });
    expect(rerun).toMatchObject({ status: "already_applied", assignmentRevision: 1 });

    const audits = await t.db.auditEntry.count({ where: { projectId: IDS.project, action: "project.assign" } });
    expect(audits).toBe(1);
  });
});
