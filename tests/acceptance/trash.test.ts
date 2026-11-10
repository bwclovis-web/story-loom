import Database from "better-sqlite3";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFullBackup } from "@/server/backupFiles";
import { createDb } from "@/server/db";
import { createWorkspaceBackup, restoreWorkspaceBackup, validateWorkspaceBackup } from "@/server/services/backupService";
import { exportContextBundle } from "@/server/services/contextExportService";
import { MutationRejectedError, NotFoundError } from "@/server/services/errors";
import { addRecordImages } from "@/server/services/imageService";
import { linkReference, listLinkedReferences } from "@/server/services/linkService";
import { findProject, listProjectSummaries, listWorkspacesWithProjects, createProject, createWorkspace } from "@/server/services/projectService";
import {
  createRecord,
  getRecord,
  listRecordNav,
  listRecordsInside,
  moveRecordToTrash,
  restoreRecordsFromTrash,
  setAuthorityStatus,
  updateRecord,
} from "@/server/services/recordService";
import { searchProjectRecords } from "@/server/services/searchService";
import {
  deleteFromTrash,
  listTrash,
  restoreProject,
  restoreWorkspace,
  trashProject,
  trashWorkspace,
} from "@/server/services/trashService";
import { applyMutations } from "@/server/services/mutationService";
import { manuscriptWordCounts } from "@/server/services/wordCountService";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";
import { makePng } from "../imageFixtures";

const SCENE = "rec_test_scene_one";
const NOTE = "rec_test_scene_note";
const ACTOR = "author";

async function issueCodes(p: Promise<unknown>): Promise<string[]> {
  try {
    await p;
  } catch (error) {
    if (error instanceof MutationRejectedError) return error.issues.map((i) => i.code);
    throw error;
  }
  throw new Error("expected the action to be refused");
}

async function addSceneAndNote(t: TestDb) {
  await createRecord(t.db, IDS.project, {
    recordId: SCENE,
    type: "manuscript_scene",
    title: "The wet ledger",
    body: "Water on the page. Mara froze.",
    authorityStatus: "draft",
    parentRecordId: IDS.chapter,
  });
  await createRecord(t.db, IDS.project, {
    recordId: NOTE,
    type: "scene_note",
    title: "Pacing",
    body: "Slow this down.",
    authorityStatus: "draft",
    parentRecordId: SCENE,
  });
}

describe("moving records to the Trash and restoring them", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
    await addSceneAndNote(t);
  });
  afterEach(async () => t.cleanup());

  it("moves a chapter with its scenes and notes as one batch, only after the protection tick", async () => {
    expect((await listRecordsInside(t.db, IDS.project, IDS.chapter)).map((r) => r.id)).toEqual([SCENE, NOTE]);
    expect(await issueCodes(moveRecordToTrash(t.db, IDS.project, IDS.chapter, false))).toEqual(["PROTECTED_RECORD"]);
    expect(await t.db.record.count({ where: { trashedAt: { not: null } } })).toBe(0);

    const batch = await moveRecordToTrash(t.db, IDS.project, IDS.chapter, true);
    expect(batch.recordIds.sort()).toEqual([IDS.chapter, NOTE, SCENE].sort());
    const rows = await t.db.record.findMany({ where: { id: { in: batch.recordIds } } });
    expect(rows.every((r) => r.trashedAt && r.trashBatchId === batch.batchId)).toBe(true);
    expect(await t.db.revision.count({ where: { recordId: { in: batch.recordIds } } })).toBe(3);

    const audit = await t.db.auditEntry.findFirst({ where: { projectId: IDS.project, action: "trash.move" } });
    expect(audit?.summary).toBe('Moved "Chapter 1" and 2 records inside it to the Trash');
  });

  it("hides records in the Trash from pages, lists, search, counts, exports and links", async () => {
    await linkReference(t.db, IDS.project, IDS.chapter, IDS.dossier);
    await moveRecordToTrash(t.db, IDS.project, IDS.dossier, false);
    await moveRecordToTrash(t.db, IDS.project, IDS.chapter, true);

    await expect(getRecord(t.db, IDS.project, IDS.dossier)).rejects.toBeInstanceOf(NotFoundError);
    const nav = (await listRecordNav(t.db, IDS.project)).map((r) => r.id);
    expect(nav).not.toContain(IDS.dossier);
    expect(nav).not.toContain(SCENE);
    expect(nav).toContain(IDS.world);
    expect((await listRecordNav(t.db)).map((r) => r.id)).not.toContain(IDS.chapter);

    const hits = await searchProjectRecords(t.db, { projectId: IDS.project, query: "Mara", includeManuscript: true });
    expect(hits.map((h) => h.id).sort()).toEqual([IDS.decision, IDS.outline, IDS.world].sort());
    expect((await manuscriptWordCounts(t.db, IDS.project)).size).toBe(0);
    const summary = (await listProjectSummaries(t.db)).find((p) => p.id === IDS.project)!;
    expect(summary).toMatchObject({ recordCount: 3, chapterCount: 0, manuscriptWords: 0 });

    const bundle = await exportContextBundle(t.db, IDS.project);
    expect(bundle.records.map((r) => r.id).sort()).toEqual([IDS.decision, IDS.outline, IDS.world].sort());

    await restoreRecordsFromTrash(t.db, IDS.project, (await t.db.record.findUniqueOrThrow({ where: { id: IDS.chapter } })).trashBatchId!);
    expect(await listLinkedReferences(t.db, IDS.project, IDS.chapter)).toEqual([]);
  });

  it("refuses changes to records in the Trash and new records inside them", async () => {
    await moveRecordToTrash(t.db, IDS.project, IDS.chapter, true);
    await moveRecordToTrash(t.db, IDS.project, IDS.world, false);
    await expect(
      updateRecord(t.db, IDS.project, { recordId: IDS.world, expectedRevision: 1, body: "Changed", unlockProtected: false }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const ctx = { projectId: IDS.project, actor: ACTOR, source: { kind: "change_package" as const }, scope: "reference" as const, protectedOverrides: new Set<string>() };
    expect(
      await issueCodes(
        applyMutations(t.db, ctx, [{ kind: "update_record", recordId: IDS.world, expectedRevision: 1, changes: { body: "Changed" } }], {
          action: "test",
          summary: "test",
        }),
      ),
    ).toEqual(["IN_TRASH"]);
    expect(
      await issueCodes(
        createRecord(t.db, IDS.project, {
          type: "manuscript_scene",
          title: "Another scene",
          authorityStatus: "draft",
          parentRecordId: IDS.chapter,
        }),
      ),
    ).toEqual(["IN_TRASH"]);
    expect(
      await issueCodes(
        setAuthorityStatus(t.db, IDS.project, { recordId: IDS.decision, expectedRevision: 1, status: "superseded", supersededBy: IDS.world }),
      ),
    ).toEqual(["IN_TRASH"]);
  });

  it("restores a batch unchanged, and a scene only after its chapter", async () => {
    const scene = await moveRecordToTrash(t.db, IDS.project, SCENE, true);
    const chapter = await moveRecordToTrash(t.db, IDS.project, IDS.chapter, true);
    expect(chapter.recordIds).toEqual([IDS.chapter]);

    const trash = await listTrash(t.db);
    const sceneGroup = trash.records.find((g) => g.batchId === scene.batchId)!;
    expect(sceneGroup.lead.id).toBe(SCENE);
    expect(sceneGroup.inside.map((r) => r.id)).toEqual([NOTE]);
    expect(sceneGroup.waitsFor).toBe("Chapter 1");

    expect(await issueCodes(restoreRecordsFromTrash(t.db, IDS.project, scene.batchId))).toEqual(["IN_TRASH"]);
    await restoreRecordsFromTrash(t.db, IDS.project, chapter.batchId);
    await expect(getRecord(t.db, IDS.project, SCENE)).rejects.toBeInstanceOf(NotFoundError);
    await restoreRecordsFromTrash(t.db, IDS.project, scene.batchId);

    const restored = await getRecord(t.db, IDS.project, SCENE);
    expect(restored.body).toBe("Water on the page. Mara froze.");
    expect(restored.currentRevision).toBe(1);
    expect(await t.db.record.count({ where: { OR: [{ trashedAt: { not: null } }, { trashBatchId: { not: null } }] } })).toBe(0);
    expect(await t.db.auditEntry.count({ where: { action: "trash.restore" } })).toBe(2);
  });
});

describe("projects and workspaces in the Trash", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(async () => t.cleanup());

  it("hides a project, refuses changes in it, and keeps its records' own Trash state", async () => {
    await moveRecordToTrash(t.db, IDS.project, IDS.world, false);
    await trashProject(t.db, { projectId: IDS.project, actor: ACTOR });
    expect(await findProject(t.db, IDS.project)).toBeNull();
    expect((await listWorkspacesWithProjects(t.db))[0].projects).toEqual([]);
    expect(
      await issueCodes(createRecord(t.db, IDS.project, { type: "worldbuilding", title: "New", authorityStatus: "draft" })),
    ).toEqual(["IN_TRASH"]);

    const trash = await listTrash(t.db);
    expect(trash.projects.map((p) => p.id)).toEqual([IDS.project]);
    expect(trash.records).toEqual([]);

    await restoreProject(t.db, { projectId: IDS.project, actor: ACTOR });
    expect(await findProject(t.db, IDS.project)).not.toBeNull();
    await expect(getRecord(t.db, IDS.project, IDS.world)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("hides a workspace with its projects; a project in it comes back only with the workspace", async () => {
    await trashProject(t.db, { projectId: IDS.project, actor: ACTOR });
    await trashWorkspace(t.db, { workspaceId: IDS.workspace, actor: ACTOR });
    expect(await listWorkspacesWithProjects(t.db)).toEqual([]);
    const trash = await listTrash(t.db);
    expect(trash.workspaces.map((w) => [w.id, w.projectCount])).toEqual([[IDS.workspace, 1]]);
    expect(trash.projects).toEqual([]);

    expect(await issueCodes(restoreProject(t.db, { projectId: IDS.project, actor: ACTOR }))).toEqual(["IN_TRASH"]);
    await restoreWorkspace(t.db, { workspaceId: IDS.workspace, actor: ACTOR });
    expect(await findProject(t.db, IDS.project)).toBeNull();
    await restoreProject(t.db, { projectId: IDS.project, actor: ACTOR });
    expect(await findProject(t.db, IDS.project)).not.toBeNull();
    await expect(createProject(t.db, { workspaceId: IDS.workspace, title: "Second book" })).resolves.toBeTruthy();
  });
});

describe("deleting permanently", () => {
  let t: TestDb;
  let backupsDir: string;
  const options = () => ({ databaseFile: t.file, backupsDir, actor: ACTOR });

  beforeEach(async () => {
    t = await createTestDb();
    backupsDir = path.join(path.dirname(t.file), "backups");
    await seedProject(t.db);
    await addSceneAndNote(t);
  });
  afterEach(async () => t.cleanup());

  it("backs up first, then removes the records with their history, images, links and review items", async () => {
    await addRecordImages(t.db, IDS.project, IDS.dossier, [{ filename: "portrait.png", bytes: makePng(2, 2) }], { confirmProtected: false });
    await linkReference(t.db, IDS.project, IDS.chapter, IDS.dossier);
    const sourceId = (await t.db.source.findFirstOrThrow({ where: { projectId: IDS.project } })).id;
    await t.db.reviewItem.create({
      data: { id: "rvw_test_one", projectId: IDS.project, recordId: IDS.dossier, origin: "package_note", note: "Check age" },
    });
    const dossier = await moveRecordToTrash(t.db, IDS.project, IDS.dossier, false);

    const outcome = await deleteFromTrash(t.db, { kind: "records", projectId: IDS.project, batchId: dossier.batchId }, options());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.deleted).toEqual({ workspaces: 0, projects: 0, records: 1 });
    expect(path.basename(outcome.backupDir)).toMatch(/before-permanent-delete$/);
    const files = readdirSync(outcome.backupDir).sort();
    expect(files).toEqual(["test.db", `${IDS.workspace}.wordly-backup.json`]);
    const saved = JSON.parse(readFileSync(path.join(outcome.backupDir, `${IDS.workspace}.wordly-backup.json`), "utf8"));
    expect(saved.records.find((r: { id: string }) => r.id === IDS.dossier).trashedAt).toBeTruthy();
    expect(saved.recordImages).toHaveLength(1);

    for (const count of [
      t.db.record.count({ where: { id: IDS.dossier } }),
      t.db.revision.count({ where: { recordId: IDS.dossier } }),
      t.db.recordImage.count(),
      t.db.recordLink.count(),
      t.db.reviewItem.count(),
    ]) {
      expect(await count).toBe(0);
    }
    expect(await t.db.source.count({ where: { id: sourceId } })).toBe(1);
    expect(await t.db.auditEntry.count({ where: { action: "trash.delete" } })).toBe(1);

    const after = await createWorkspaceBackup(t.db, IDS.workspace);
    expect((await validateWorkspaceBackup(t.db, after, { idStrategy: "remap" })).ok).toBe(true);
  });

  it("refuses, without writing a backup, while another record is marked superseded by it", async () => {
    await setAuthorityStatus(t.db, IDS.project, { recordId: IDS.decision, expectedRevision: 1, status: "superseded", supersededBy: IDS.world });
    const world = await moveRecordToTrash(t.db, IDS.project, IDS.world, false);
    const outcome = await deleteFromTrash(t.db, { kind: "records", projectId: IDS.project, batchId: world.batchId }, options());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.issues.map((i) => i.code)).toEqual(["DELETE_BLOCKED"]);
    expect(outcome.issues[0].message).toContain("Mara's age");
    expect(existsSync(backupsDir)).toBe(false);
    expect(await t.db.record.count({ where: { id: IDS.world } })).toBe(1);
  });

  it("deletes a chapter with a scene that went to the Trash separately, leaving a valid backup", async () => {
    await moveRecordToTrash(t.db, IDS.project, SCENE, true);
    const chapter = await moveRecordToTrash(t.db, IDS.project, IDS.chapter, true);
    const outcome = await deleteFromTrash(t.db, { kind: "records", projectId: IDS.project, batchId: chapter.batchId }, options());
    expect(outcome.ok && outcome.deleted.records).toBe(3);
    expect(await t.db.record.count({ where: { id: { in: [IDS.chapter, SCENE, NOTE] } } })).toBe(0);
    expect((await listTrash(t.db)).records).toEqual([]);
    const after = await createWorkspaceBackup(t.db, IDS.workspace);
    expect((await validateWorkspaceBackup(t.db, after, { idStrategy: "remap" })).ok).toBe(true);
  });

  it("deletes whole projects and workspaces, and Empty Trash leaves everything else alone", async () => {
    await createWorkspace(t.db, { id: "wsp_test_other", name: "Other" });
    await createProject(t.db, { id: "prj_test_other", workspaceId: "wsp_test_other", title: "Other book" });
    await createRecord(t.db, "prj_test_other", { recordId: "rec_test_other", type: "worldbuilding", title: "Keep me", authorityStatus: "draft" });
    await createProject(t.db, { id: "prj_test_second", workspaceId: IDS.workspace, title: "Second book" });
    await createRecord(t.db, "prj_test_second", { recordId: "rec_test_second", type: "worldbuilding", title: "Gone", authorityStatus: "draft" });
    await t.db.dictionaryEntry.create({
      data: { id: "dic_test_one", workspaceId: IDS.workspace, projectId: "prj_test_second", word: "Venn", wordKey: "venn", caseSensitive: true, origin: "manual" },
    });

    await trashProject(t.db, { projectId: "prj_test_second", actor: ACTOR });
    const project = await deleteFromTrash(t.db, { kind: "project", projectId: "prj_test_second" }, options());
    expect(project.ok && project.deleted).toEqual({ workspaces: 0, projects: 1, records: 1 });
    expect(await t.db.project.count({ where: { id: "prj_test_second" } })).toBe(0);
    expect(await t.db.dictionaryEntry.count()).toBe(0);

    await moveRecordToTrash(t.db, "prj_test_other", "rec_test_other", false);
    await restoreRecordsFromTrash(
      t.db,
      "prj_test_other",
      (await t.db.record.findUniqueOrThrow({ where: { id: "rec_test_other" } })).trashBatchId!,
    );
    await trashWorkspace(t.db, { workspaceId: IDS.workspace, actor: ACTOR });
    const all = await deleteFromTrash(t.db, { kind: "all" }, options());
    expect(all.ok && all.deleted).toEqual({ workspaces: 1, projects: 1, records: 7 });
    expect(await t.db.workspace.findMany({ select: { id: true } })).toEqual([{ id: "wsp_test_other" }]);
    expect(await t.db.source.count({ where: { projectId: IDS.project } })).toBe(0);
    expect(await t.db.auditEntry.count({ where: { projectId: IDS.project } })).toBe(0);
    expect(await t.db.revision.findMany({ select: { recordId: true } })).toEqual([{ recordId: "rec_test_other" }]);
    expect(await t.db.record.findMany({ select: { id: true } })).toEqual([{ id: "rec_test_other" }]);
    expect(await getRecord(t.db, "prj_test_other", "rec_test_other")).toMatchObject({ title: "Keep me" });
  });
});

describe("the Trash in backups", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(async () => t.cleanup());

  it("writes Trash fields only for items in the Trash, and keeps them on restore", async () => {
    const plain = await createWorkspaceBackup(t.db, IDS.workspace);
    expect(JSON.stringify(plain)).not.toContain("trashedAt");

    const batch = await moveRecordToTrash(t.db, IDS.project, IDS.world, false);
    await trashWorkspace(t.db, { workspaceId: IDS.workspace, actor: ACTOR });
    const backup = await createWorkspaceBackup(t.db, IDS.workspace);
    expect(backup.workspace.trashedAt).toBeTruthy();
    expect(backup.records.find((r) => r.id === IDS.world)).toMatchObject({ trashBatchId: batch.batchId });

    const restored = await restoreWorkspaceBackup(t.db, backup, { idStrategy: "remap" });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    const projectId = restored.projects[0].id;
    expect(await findProject(t.db, projectId)).not.toBeNull();
    const world = await t.db.record.findFirstOrThrow({ where: { projectId, title: "The Salt Guild" } });
    expect(world.trashedAt).not.toBeNull();
    expect((await listTrash(t.db)).records.map((g) => g.projectId)).toEqual([projectId]);
  });

  it("reads a database that does not have the Trash columns yet, as db:deploy does before migrating", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "wordly-premigration-"));
    try {
      const file = path.join(dir, "old.db");
      const migrations = path.resolve(__dirname, "..", "..", "prisma", "migrations");
      const sqlite = new Database(file);
      for (const name of readdirSync(migrations).filter((n) => !n.endsWith("_trash")).sort()) {
        if (existsSync(path.join(migrations, name, "migration.sql"))) sqlite.exec(readFileSync(path.join(migrations, name, "migration.sql"), "utf8"));
      }
      sqlite.exec(`
        INSERT INTO Workspace (id, name) VALUES ('wsp_old', 'Old workspace');
        INSERT INTO Project (id, workspaceId, title) VALUES ('prj_old', 'wsp_old', 'Old book');
        INSERT INTO Source (id, projectId, kind, actor) VALUES ('src_old', 'prj_old', 'ui', 'author');
        INSERT INTO Record (id, projectId, type, title, body, authorityStatus, currentRevision, updatedAt)
          VALUES ('rec_old', 'prj_old', 'worldbuilding', 'Old note', 'Body', 'draft', 1, CURRENT_TIMESTAMP);
        INSERT INTO Revision (id, recordId, revisionNumber, title, body, fields, authorityStatus, contentHash, sourceId)
          VALUES ('rev_old', 'rec_old', 1, 'Old note', 'Body', '{}', 'draft', 'x', 'src_old');
      `);
      sqlite.close();
      const db = createDb(`file:${file.replace(/\\/g, "/")}`);
      try {
        const result = await writeFullBackup(db, file, { backupsDir: path.join(dir, "backups"), label: "pre-migrate" });
        expect(result.workspaceFiles.map((w) => w.workspaceId)).toEqual(["wsp_old"]);
        const saved = JSON.parse(readFileSync(result.workspaceFiles[0].file, "utf8"));
        expect(saved.records.map((r: { id: string; trashedAt?: string }) => [r.id, r.trashedAt])).toEqual([["rec_old", undefined]]);
        expect(saved.projects[0].trashedAt).toBeUndefined();
      } finally {
        await db.$disconnect();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
