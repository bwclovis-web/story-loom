import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "@/server/services/backupService";
import { applyMutations } from "@/server/services/mutationService";
import {
  getProjectWritingGoal,
  upsertChapterWritingGoal,
  upsertProjectWritingGoal,
} from "@/server/services/writingGoalService";
import { buildWritingProgress, wordsWrittenSince } from "@/server/services/writingProgressService";
import { CHAPTER_PROSE, createTestDb, IDS, seedProject, type TestDb } from "../helpers";
import { resolveDraftScope } from "@/server/services/draftService";

describe("Writing goals and progress", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("stores project and chapter targets with audit and backs them up", async () => {
    await upsertProjectWritingGoal(t.db, IDS.project, { targetWords: 80_000, deadlineAt: "2027-01-15" });
    await upsertChapterWritingGoal(t.db, IDS.project, IDS.chapter, 2500);
    const project = await getProjectWritingGoal(t.db, IDS.project);
    expect(project?.targetWords).toBe(80_000);
    expect(project?.deadlineAt?.toISOString().slice(0, 10)).toBe("2027-01-15");

    const audit = await t.db.auditEntry.findMany({ where: { projectId: IDS.project, action: "writing_goal.set" } });
    expect(audit.length).toBe(2);

    const backup = await createWorkspaceBackup(t.db, IDS.workspace);
    expect(backup.writingGoals?.length).toBe(2);
    expect(backup.counts.writingGoals).toBe(2);

    const target = await createTestDb();
    try {
      const restored = await restoreWorkspaceBackup(target.db, backup, { idStrategy: "remap" });
      expect(restored.ok).toBe(true);
      if (!restored.ok) return;
      const projectId = restored.projects[0]!.id;
      expect(await getProjectWritingGoal(target.db, projectId)).not.toBeNull();
      const goals = await target.db.writingGoal.findMany({ where: { projectId } });
      expect(goals.length).toBe(2);
    } finally {
      await target.cleanup();
    }
  });

  it("counts words written from positive saved revision deltas", async () => {
    const since = new Date();
    const longer = `${CHAPTER_PROSE} She closed the ledger.`;
    await applyMutations(
      t.db,
      {
        projectId: IDS.project,
        actor: "author",
        source: { kind: "ui" },
        scope: "manuscript",
        protectedOverrides: new Set(),
      },
      [{ kind: "update_record", recordId: IDS.chapter, expectedRevision: 1, changes: { body: longer } }],
      { action: "test", summary: "Expand chapter" },
    );
    const scope = resolveDraftScope(false, null);
    const added = await wordsWrittenSince(t.db, IDS.project, scope, since);
    expect(added).toBeGreaterThan(0);

    const progress = await buildWritingProgress(t.db, {
      projectId: IDS.project,
      hasDrafts: false,
      draftId: null,
      sessionSince: since,
    });
    expect(progress.wordsToday).toBeGreaterThanOrEqual(added);
    expect(progress.wordsSession).toBe(added);
  });
});