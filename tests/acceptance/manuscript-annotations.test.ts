import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "@/server/services/backupService";
import { applyMutations } from "@/server/services/mutationService";
import {
  ANNOTATION_KIND,
  addMarginComment,
  getSynopsis,
  listMarginComments,
  upsertSynopsis,
} from "@/server/services/manuscriptAnnotationService";
import { CHAPTER_PROSE, createTestDb, IDS, seedProject, type TestDb } from "../helpers";

describe("Manuscript synopses and margin comments", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("stores synopsis and comments, marks stale after save, and backs up", async () => {
    await upsertSynopsis(t.db, IDS.project, IDS.chapter, "Mara opens the ledger.");
    expect((await getSynopsis(t.db, IDS.project, IDS.chapter))?.body).toContain("ledger");

    await addMarginComment(t.db, IDS.project, IDS.chapter, {
      passageStart: 0,
      passageEnd: 4,
      expectedRevision: 1,
      body: "Strong opening",
    });
    const comments = await listMarginComments(t.db, IDS.project, IDS.chapter);
    expect(comments).toHaveLength(1);
    expect(comments[0]!.needsRecheck).toBe(false);

    const longer = `${CHAPTER_PROSE} Extra line.`;
    await applyMutations(
      t.db,
      {
        projectId: IDS.project,
        actor: "author",
        source: { kind: "ui" },
        scope: "manuscript",
        protectedOverrides: new Set([IDS.chapter]),
      },
      [{ kind: "update_record", recordId: IDS.chapter, expectedRevision: 1, changes: { body: longer } }],
      { action: "test", summary: "revise" },
    );
    const stale = await t.db.manuscriptAnnotation.findFirst({
      where: { projectId: IDS.project, recordId: IDS.chapter, kind: ANNOTATION_KIND.comment },
    });
    expect(stale?.needsRecheck).toBe(true);

    const backup = await createWorkspaceBackup(t.db, IDS.workspace);
    expect(backup.manuscriptAnnotations?.length).toBeGreaterThanOrEqual(2);

    const target = await createTestDb();
    try {
      const restored = await restoreWorkspaceBackup(target.db, backup, { idStrategy: "remap" });
      expect(restored.ok).toBe(true);
      if (!restored.ok) return;
      const projectId = restored.projects[0]!.id;
      const chapterId = (await target.db.record.findFirst({ where: { projectId, type: "manuscript_chapter" } }))!.id;
      expect(await getSynopsis(target.db, projectId, chapterId)).not.toBeNull();
    } finally {
      await target.cleanup();
    }
  });
});