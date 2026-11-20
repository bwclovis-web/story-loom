import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "@/server/services/backupService";
import { clearProjectCover, getProjectCoverData, listProjectCoverHashes, setProjectCover } from "@/server/services/coverService";
import { MutationRejectedError, NotFoundError } from "@/server/services/errors";
import { getRecord } from "@/server/services/recordService";
import { trashProject } from "@/server/services/trashService";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";
import { makePng } from "../imageFixtures";

const codes = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (error) {
    if (error instanceof MutationRejectedError) return error.issues.map((i) => i.code);
    throw error;
  }
  throw new Error("expected the change to be refused");
};

describe("project cover images", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(async () => t.cleanup());

  it("stores a cover from the file bytes and leaves the manuscript revision alone", async () => {
    const before = await getRecord(t.db, IDS.project, IDS.chapter);
    const png = makePng(12, 20, [40, 70, 90]);
    const saved = await setProjectCover(t.db, { projectId: IDS.project, filename: "harbour.png", bytes: png });
    const cover = await getProjectCoverData(t.db, IDS.project);
    expect(cover?.mimeType).toBe("image/png");
    expect(cover?.contentHash).toBe(saved.contentHash);
    expect(cover?.data).toEqual(png);
    expect((await getRecord(t.db, IDS.project, IDS.chapter)).currentRevision).toBe(before.currentRevision);
    expect((await listProjectCoverHashes(t.db, [IDS.project])).get(IDS.project)).toBe(saved.contentHash);
  });

  it("refuses a file that is not a PNG, JPEG, GIF or WebP", async () => {
    expect(await codes(setProjectCover(t.db, { projectId: IDS.project, filename: "notes.txt", bytes: new Uint8Array([1, 2, 3]) }))).toEqual([
      "IMAGE_INVALID",
    ]);
    expect(await getProjectCoverData(t.db, IDS.project)).toBeNull();
  });

  it("replaces a cover, then clearing it returns to no stored picture", async () => {
    await setProjectCover(t.db, { projectId: IDS.project, filename: "one.png", bytes: makePng(4, 4, [1, 2, 3]) });
    const next = await setProjectCover(t.db, { projectId: IDS.project, filename: "two.png", bytes: makePng(6, 8, [9, 8, 7]) });
    expect((await getProjectCoverData(t.db, IDS.project))?.contentHash).toBe(next.contentHash);
    expect(await t.db.projectCover.count({ where: { projectId: IDS.project } })).toBe(1);
    await clearProjectCover(t.db, { projectId: IDS.project });
    expect(await getProjectCoverData(t.db, IDS.project)).toBeNull();
    await clearProjectCover(t.db, { projectId: IDS.project });
  });

  it("does not change a cover on a manuscript that is in the Trash", async () => {
    await trashProject(t.db, { projectId: IDS.project, actor: "author" });
    await expect(setProjectCover(t.db, { projectId: IDS.project, filename: "x.png", bytes: makePng(2, 2) })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("round-trips a cover in a workspace backup and omits the field when none is stored", async () => {
    const png = makePng(5, 9, [20, 30, 40]);
    await setProjectCover(t.db, { projectId: IDS.project, filename: "quay.png", bytes: png });
    const backup = await createWorkspaceBackup(t.db, IDS.workspace);
    expect(backup.projectCovers).toHaveLength(1);
    expect(backup.counts.projectCovers).toBe(1);

    const target = await createTestDb();
    try {
      const outcome = await restoreWorkspaceBackup(target.db, backup, { idStrategy: "remap" });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      const projectId = outcome.projects[0]!.id;
      const cover = await getProjectCoverData(target.db, projectId);
      expect(cover?.data).toEqual(png);
      expect(cover?.id).not.toBe(backup.projectCovers?.[0].id);
    } finally {
      await target.cleanup();
    }

    await clearProjectCover(t.db, { projectId: IDS.project });
    const empty = await createWorkspaceBackup(t.db, IDS.workspace);
    expect(empty.projectCovers).toBeUndefined();
    expect(empty.counts.projectCovers).toBeUndefined();
  });
});
