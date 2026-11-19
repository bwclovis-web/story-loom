import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AssistantProvider, StructuredResult } from "@/assistant/provider";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "@/server/services/backupService";
import {
  applyWeaveBuild,
  prepareWeaveBuild,
  runWeaveBuild,
  saveWeaveBuildDecisions,
  type WeaveBuildDecisions,
} from "@/server/services/weaveBuildFromDraftService";
import { addWeaveBeat, createWeaveGrid, getWeaveGrid } from "@/server/services/weaveService";
import { CHAPTER_PROSE, createTestDb, IDS, seedProject, type TestDb } from "../helpers";

function scripted(reply: unknown): AssistantProvider {
  return {
    async *stream() {
      yield { type: "done", status: "complete" as const };
    },
    async structured(): Promise<StructuredResult> {
      return {
        status: "complete",
        text: JSON.stringify(reply),
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      };
    },
  };
}

const runtime = {
  configured: true,
  model: "test-model",
  limits: {
    maxInputChars: 600_000,
    maxOutputTokens: 4_000,
    maxRequestsPerHour: 100,
    monthlyTokenCap: 1_000_000,
    requestTimeoutSeconds: 30,
  },
};

describe("Weave build from draft", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("proposes, partially accepts, applies atomically, and is retry-safe", async () => {
    const existing = await createWeaveGrid(t.db, IDS.project, {
      title: "Existing plan",
      viewKind: "zero_draft_map",
    });
    const keepBeat = await addWeaveBeat(t.db, IDS.project, existing.id, {
      title: "Keep me",
      x: 10,
      y: 10,
      manuscriptRecordId: IDS.chapter,
    });

    const draft = {
      summary: "Plan from chapter 1",
      threads: [
        { key: "thread-main", title: "Main mystery" },
        { key: "thread-skip", title: "Skip me" },
      ],
      rows: [
        {
          key: "row-ch01",
          manuscriptRecordId: IDS.chapter,
          summary: "Mara finds the wet ledger.",
          purposeGoal: "Confirm the ledger",
          purposeChange: "Quay is no longer quiet",
          purposeForward: "Ask the Guild",
          proposedBoundaries: [
            {
              key: "bound-1",
              title: "Suggested split",
              excerpt: "Mara Venn knew this because she had checked it",
            },
          ],
        },
      ],
      beats: [
        {
          key: "beat-ledger",
          title: "Wet ledger",
          body: "Discovery",
          threadKey: "thread-main",
          manuscriptRecordId: IDS.chapter,
          decision: "keep",
          sourceExcerpt: "The ledger had been dry for three hundred years.",
        },
        {
          key: "beat-skip",
          title: "Skip beat",
          body: "no",
          threadKey: "thread-main",
          manuscriptRecordId: IDS.chapter,
          decision: "",
          sourceExcerpt: "The ledger had been dry for three hundred years.",
        },
      ],
    };

    const prep = await prepareWeaveBuild(t.db, runtime, {
      projectId: IDS.project,
      draftId: null,
      gridId: existing.id,
      gridTitle: "",
      viewKind: "zero_draft_map",
      chapterFromId: null,
      chapterToId: null,
    });
    expect(prep.sentRevisions[IDS.chapter]).toBe(1);
    expect(CHAPTER_PROSE).toContain("ledger");

    const run = await runWeaveBuild(t.db, scripted(draft), prep, new AbortController().signal);
    expect(run.status).toBe("proposed");
    expect(run.proposal?.beats[0]?.sourcePassage?.excerpt).toContain("ledger");
    expect(run.proposal?.rows[0]?.proposedBoundaries[0]?.start).not.toBeNull();
    // Boundaries are review-only: manuscript still one chapter.
    expect(await t.db.record.count({ where: { projectId: IDS.project, type: "manuscript_scene" } })).toBe(0);

    const decisions: WeaveBuildDecisions = {
      "thread-main": { decision: "accept" },
      "thread-skip": { decision: "skip" },
      "row-ch01": { decision: "accept" },
      "beat-ledger": { decision: "accept" },
      "beat-skip": { decision: "skip" },
    };
    await saveWeaveBuildDecisions(t.db, IDS.project, run.id, decisions, run.contentHash);

    const first = await applyWeaveBuild(t.db, IDS.project, run.id, run.contentHash);
    expect(first.status).toBe("applied");
    if (first.status !== "applied") return;
    expect(first.createdThreads).toBe(1);
    expect(first.createdBeats).toBeGreaterThanOrEqual(2);

    const grid = await getWeaveGrid(t.db, IDS.project, existing.id);
    expect(grid.beats.some((b) => b.id === keepBeat.id && b.title === "Keep me")).toBe(true);
    expect(grid.threads.some((th) => th.title === "Main mystery")).toBe(true);
    expect(grid.threads.some((th) => th.title === "Skip me")).toBe(false);
    expect(grid.beats.some((b) => b.title === "Wet ledger")).toBe(true);
    expect(grid.beats.some((b) => b.title === "Skip beat")).toBe(false);
    // Scene count unchanged (no auto-split).
    expect(await t.db.record.count({ where: { projectId: IDS.project, type: "manuscript_scene" } })).toBe(0);

    const second = await applyWeaveBuild(t.db, IDS.project, run.id, run.contentHash);
    expect(second.status).toBe("already_applied");
    const after = await getWeaveGrid(t.db, IDS.project, existing.id);
    expect(after.beats.length).toBe(grid.beats.length);
    expect(after.threads.length).toBe(grid.threads.length);

    // Backup/restore keeps applied Weave content (not the build run).
    const backup = await createWorkspaceBackup(t.db, IDS.workspace);
    expect(backup.weaveBeats?.some((b) => b.title === "Wet ledger")).toBe(true);
    const other = await createTestDb();
    try {
      const restoredBackup = await restoreWorkspaceBackup(other.db, backup, { idStrategy: "remap" });
      expect(restoredBackup.ok).toBe(true);
      if (!restoredBackup.ok) return;
      const projectId = restoredBackup.projects[0]!.id;
      const grids = await other.db.weaveGrid.findMany({ where: { projectId } });
      const grid = await getWeaveGrid(other.db, projectId, grids[0]!.id);
      expect(grid.beats.some((b) => b.title === "Wet ledger")).toBe(true);
      expect(grid.beats.some((b) => b.title === "Keep me")).toBe(true);
    } finally {
      await other.cleanup();
    }
  });

  it("refuses apply when a source revision went stale", async () => {
    const draft = {
      summary: "x",
      threads: [{ key: "thread-main", title: "Main" }],
      rows: [],
      beats: [
        {
          key: "beat-1",
          title: "B",
          body: "",
          threadKey: "thread-main",
          manuscriptRecordId: IDS.chapter,
          decision: "",
          sourceExcerpt: "The ledger had been dry for three hundred years.",
        },
      ],
    };
    const prep = await prepareWeaveBuild(t.db, runtime, {
      projectId: IDS.project,
      draftId: null,
      gridId: null,
      gridTitle: "Fresh",
      viewKind: "original",
      chapterFromId: null,
      chapterToId: null,
    });
    const run = await runWeaveBuild(t.db, scripted(draft), prep, new AbortController().signal);
    await saveWeaveBuildDecisions(t.db, IDS.project, run.id, { "thread-main": { decision: "accept" }, "beat-1": { decision: "accept" } }, run.contentHash);

    const prev = await t.db.revision.findFirstOrThrow({
      where: { recordId: IDS.chapter, revisionNumber: 1 },
    });
    await t.db.revision.create({
      data: {
        id: "rev_stale_test",
        recordId: IDS.chapter,
        revisionNumber: 2,
        title: prev.title,
        body: `${prev.body} New.`,
        fields: prev.fields,
        authorityStatus: prev.authorityStatus,
        contentHash: `${prev.contentHash}_2`,
        sourceId: prev.sourceId,
      },
    });
    await t.db.record.update({ where: { id: IDS.chapter }, data: { currentRevision: 2 } });

    await expect(applyWeaveBuild(t.db, IDS.project, run.id, run.contentHash)).rejects.toMatchObject({
      name: "MutationRejectedError",
    });
  });
});
