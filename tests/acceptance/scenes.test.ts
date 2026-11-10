import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceBackupV1 } from "@/backup/format.v1";
import { sha256, stableStringify } from "@/domain/json";
import { memoryGrantSource, type LocalGrant } from "@/mcp/grant";
import { createWordlyMcpServer } from "@/mcp/server";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "@/server/services/backupService";
import { applyChangePackage } from "@/server/services/changePackageService";
import { exportContextBundle } from "@/server/services/contextExportService";
import { MutationRejectedError } from "@/server/services/errors";
import { linkReference, listLinkedReferences, unlinkReference } from "@/server/services/linkService";
import { createProject, listProjectSummaries } from "@/server/services/projectService";
import { createRecord, getRecord, listNotes, listReferenceChoices, updateRecord } from "@/server/services/recordService";
import { manuscriptWordCounts } from "@/server/services/wordCountService";
import { countWords } from "@/writing/wordCount";
import { CHAPTER_PROSE, createTestDb, IDS, makePackage, seedProject, snapshotState, type TestDb } from "../helpers";

/*
 * Scenes, scene notes and reference links against a real (temporary) database.
 * All text is invented.
 */

const SCENE_ONE = "rec_test_scene_one";
const SCENE_TWO = "rec_test_scene_two";
const NOTE = "rec_test_note_one";
const SIBLING = "prj_test_sequel";
const SIBLING_CHAPTER = "rec_test_sequel_ch1";
const SCENE_ONE_TEXT = "Rain worked at the shutters while the kettle failed to boil.";
const SCENE_TWO_TEXT = "By morning the harbour had a new smell, brine and lamp oil.";

let t: TestDb;

async function issueCodes(promise: Promise<unknown>): Promise<string[]> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof MutationRejectedError) return error.issues.map((i) => i.code);
    throw error;
  }
  return [];
}

async function seedScenes() {
  await createRecord(t.db, IDS.project, {
    recordId: SCENE_ONE,
    type: "manuscript_scene",
    title: "Scene 1: The kettle",
    body: SCENE_ONE_TEXT,
    authorityStatus: "draft",
    parentRecordId: IDS.chapter,
  });
  await createRecord(t.db, IDS.project, {
    recordId: SCENE_TWO,
    type: "manuscript_scene",
    title: "Scene 2: Morning",
    body: SCENE_TWO_TEXT,
    authorityStatus: "draft",
    parentRecordId: IDS.chapter,
  });
}

beforeEach(async () => {
  t = await createTestDb();
  await seedProject(t.db);
  await createProject(t.db, { id: SIBLING, workspaceId: IDS.workspace, title: "Test sequel" });
  await createRecord(t.db, SIBLING, {
    recordId: SIBLING_CHAPTER,
    type: "manuscript_chapter",
    title: "Sequel chapter",
    body: "Invented sequel text.",
    authorityStatus: "draft",
  });
});

afterEach(async () => {
  await t.cleanup();
});

describe("scenes", () => {
  it("creates scenes inside a chapter, protected like chapters, in their own records", async () => {
    await seedScenes();
    const scene = await getRecord(t.db, IDS.project, SCENE_ONE);
    expect(scene.parentRecordId).toBe(IDS.chapter);
    expect(scene.protected).toBe(true);
    expect(scene.contentClass).toBe("manuscript");
    expect(scene.currentRevision).toBe(1);
    const chapter = await getRecord(t.db, IDS.project, IDS.chapter);
    expect(chapter.body).toBe(CHAPTER_PROSE);
    expect(chapter.currentRevision).toBe(1);
  });

  it("refuses scenes and notes in the wrong place, and parents on other types", async () => {
    const before = await snapshotState(t.db);
    const base = { title: "Misplaced", body: "", authorityStatus: "draft" as const };
    expect(await issueCodes(createRecord(t.db, IDS.project, { ...base, type: "manuscript_scene" }))).toEqual(["INVALID_PARENT"]);
    expect(await issueCodes(createRecord(t.db, IDS.project, { ...base, type: "manuscript_scene", parentRecordId: IDS.dossier }))).toEqual([
      "INVALID_PARENT",
    ]);
    expect(
      await issueCodes(createRecord(t.db, IDS.project, { ...base, type: "manuscript_scene", parentRecordId: SIBLING_CHAPTER })),
    ).toEqual(["INVALID_PARENT"]);
    expect(await issueCodes(createRecord(t.db, IDS.project, { ...base, type: "scene_note", parentRecordId: IDS.outline }))).toEqual([
      "INVALID_PARENT",
    ]);
    expect(await issueCodes(createRecord(t.db, IDS.project, { ...base, type: "worldbuilding", parentRecordId: IDS.chapter }))).toEqual([
      "INVALID_PARENT",
    ]);
    expect(await snapshotState(t.db)).toEqual(before);
  });

  it("does not let a change package create a scene", async () => {
    const before = await snapshotState(t.db);
    const outcome = await applyChangePackage(
      t.db,
      makePackage({
        scope: "manuscript",
        operations: [{ op: "create_record", type: "manuscript_scene", title: "Package scene", body: "x", authorityStatus: "draft" }],
      }),
      { projectId: IDS.project },
      { confirmProtected: true },
    );
    expect(outcome.status).toBe("rejected");
    expect(JSON.stringify(outcome)).toContain("INVALID_PARENT");
    expect(await snapshotState(t.db)).toEqual(before);
  });

  it("saves one scene without touching its chapter or sibling scene", async () => {
    await seedScenes();
    const others = async () => [await getRecord(t.db, IDS.project, IDS.chapter), await getRecord(t.db, IDS.project, SCENE_TWO)];
    const before = await others();

    expect(
      await issueCodes(updateRecord(t.db, IDS.project, { recordId: SCENE_ONE, expectedRevision: 1, body: "Edited without unlocking." })),
    ).toEqual(["PROTECTED_RECORD"]);
    await updateRecord(t.db, IDS.project, {
      recordId: SCENE_ONE,
      expectedRevision: 1,
      body: `${SCENE_ONE_TEXT} The kettle sang at last.`,
      unlockProtected: true,
    });

    expect((await getRecord(t.db, IDS.project, SCENE_ONE)).currentRevision).toBe(2);
    expect(await others()).toEqual(before);
    // A save carrying another record's revision is refused rather than applied to the wrong record.
    expect(
      await issueCodes(updateRecord(t.db, IDS.project, { recordId: SCENE_TWO, expectedRevision: 2, body: "wrong", unlockProtected: true })),
    ).toEqual(["STALE_REVISION"]);
  });

  it("counts scenes in the book total but not as chapters", async () => {
    await seedScenes();
    const counts = await manuscriptWordCounts(t.db, IDS.project);
    expect([...counts.keys()].sort()).toEqual([IDS.chapter, SCENE_ONE, SCENE_TWO].sort());
    const summary = (await listProjectSummaries(t.db)).find((p) => p.id === IDS.project)!;
    expect(summary.chapterCount).toBe(1);
    expect(summary.manuscriptWords).toBe(countWords(CHAPTER_PROSE) + countWords(SCENE_ONE_TEXT) + countWords(SCENE_TWO_TEXT));
  });
});

describe("scene notes", () => {
  it("keeps notes on their own scene, unprotected, with revisions", async () => {
    await seedScenes();
    await createRecord(t.db, IDS.project, {
      recordId: NOTE,
      type: "scene_note",
      title: "Check the tide",
      body: "Tide should be out in this scene.",
      authorityStatus: "draft",
      parentRecordId: SCENE_ONE,
    });
    await createRecord(t.db, IDS.project, {
      type: "scene_note",
      title: "Chapter-level note",
      body: "",
      authorityStatus: "draft",
      parentRecordId: IDS.chapter,
    });

    const notes = await listNotes(t.db, IDS.project, SCENE_ONE);
    expect(notes.map((n) => n.id)).toEqual([NOTE]);
    expect(notes[0].protected).toBe(false);
    expect(await listNotes(t.db, IDS.project, SCENE_TWO)).toEqual([]);
    expect(await listNotes(t.db, SIBLING, SCENE_ONE)).toEqual([]);

    await updateRecord(t.db, IDS.project, { recordId: NOTE, expectedRevision: 1, body: "Tide is in. Fix the boat." });
    const note = await getRecord(t.db, IDS.project, NOTE);
    expect(note.currentRevision).toBe(2);
    expect(note.parentRecordId).toBe(SCENE_ONE);
    expect((await getRecord(t.db, IDS.project, SCENE_ONE)).currentRevision).toBe(1);
  });
});

describe("reference links", () => {
  it("links and unlinks references on a protected scene without changing either record", async () => {
    await seedScenes();
    const before = await snapshotState(t.db);
    await linkReference(t.db, IDS.project, SCENE_ONE, IDS.dossier);
    await linkReference(t.db, IDS.project, SCENE_ONE, IDS.world);
    expect((await listLinkedReferences(t.db, IDS.project, SCENE_ONE)).map((l) => l.recordId)).toEqual([IDS.dossier, IDS.world]);
    expect(await listLinkedReferences(t.db, IDS.project, SCENE_TWO)).toEqual([]);
    expect(await snapshotState(t.db)).toEqual(before);

    expect(await issueCodes(linkReference(t.db, IDS.project, SCENE_ONE, IDS.dossier))).toEqual(["INVALID_REFERENCE"]);
    await unlinkReference(t.db, IDS.project, SCENE_ONE, IDS.dossier);
    expect((await listLinkedReferences(t.db, IDS.project, SCENE_ONE)).map((l) => l.recordId)).toEqual([IDS.world]);

    const audit = await t.db.auditEntry.findMany({ where: { action: { in: ["record.link", "record.unlink"] } } });
    expect(audit.map((a) => a.action).sort()).toEqual(["record.link", "record.link", "record.unlink"]);
  });

  it("refuses links that are not chapter or scene to a standalone reference, or cross projects", async () => {
    await seedScenes();
    await createRecord(t.db, IDS.project, { recordId: NOTE, type: "scene_note", title: "A note", body: "", authorityStatus: "draft", parentRecordId: SCENE_ONE });
    expect(await issueCodes(linkReference(t.db, IDS.project, IDS.dossier, IDS.world))).toEqual(["INVALID_REFERENCE"]);
    expect(await issueCodes(linkReference(t.db, IDS.project, SCENE_ONE, IDS.chapter))).toEqual(["INVALID_REFERENCE"]);
    expect(await issueCodes(linkReference(t.db, IDS.project, SCENE_ONE, NOTE))).toEqual(["INVALID_REFERENCE"]);
    expect(await issueCodes(linkReference(t.db, SIBLING, SIBLING_CHAPTER, IDS.dossier))).toEqual(["INVALID_REFERENCE"]);
    expect(await issueCodes(unlinkReference(t.db, IDS.project, SCENE_ONE, IDS.dossier))).toEqual(["INVALID_REFERENCE"]);
    expect(await t.db.recordLink.count()).toBe(0);

    const choices = (await listReferenceChoices(t.db, IDS.project)).map((c) => c.id);
    expect(choices).toContain(IDS.dossier);
    expect(choices).not.toContain(NOTE);
    expect(choices).not.toContain(SCENE_ONE);
    expect(choices).not.toContain(IDS.chapter);
  });

  it("includes parents and links in the context export", async () => {
    await seedScenes();
    await linkReference(t.db, IDS.project, SCENE_ONE, IDS.dossier);
    const bundle = await exportContextBundle(t.db, IDS.project, { includeSchema: false });
    const scene = bundle.records.find((r) => r.id === SCENE_ONE)!;
    expect(scene.parentRecordId).toBe(IDS.chapter);
    expect(scene.linkedRecordIds).toEqual([IDS.dossier]);
    const dossier = bundle.records.find((r) => r.id === IDS.dossier)!;
    expect(dossier.parentRecordId).toBeNull();
    expect(dossier.linkedRecordIds).toEqual([]);
  });
});

describe("backup and restore", () => {
  const resign = (b: Omit<WorkspaceBackupV1, "checksum">): WorkspaceBackupV1 => ({ ...b, checksum: sha256(stableStringify(b)) });

  async function withEverything() {
    await seedScenes();
    await createRecord(t.db, IDS.project, { recordId: NOTE, type: "scene_note", title: "A note", body: "Note text.", authorityStatus: "draft", parentRecordId: SCENE_ONE });
    await linkReference(t.db, IDS.project, SCENE_ONE, IDS.dossier);
  }

  it("round-trips scenes, notes and links with preserved and new IDs", async () => {
    await withEverything();
    const backup = await createWorkspaceBackup(t.db, IDS.workspace);
    expect(backup.counts.recordLinks).toBe(1);
    expect(backup.records.find((r) => r.id === SCENE_ONE)?.parentRecordId).toBe(IDS.chapter);

    const target = await createTestDb();
    try {
      expect((await restoreWorkspaceBackup(target.db, backup, { idStrategy: "preserve" })).ok).toBe(true);
      expect((await getRecord(target.db, IDS.project, NOTE)).parentRecordId).toBe(SCENE_ONE);
      expect((await listLinkedReferences(target.db, IDS.project, SCENE_ONE)).map((l) => l.recordId)).toEqual([IDS.dossier]);
    } finally {
      await target.cleanup();
    }

    const copy = await restoreWorkspaceBackup(t.db, backup, { idStrategy: "remap" });
    if (!copy.ok) throw new Error("restore failed");
    const newProject = copy.projects.find((p) => p.originalId === IDS.project)!.id;
    const rows = await t.db.record.findMany({ where: { projectId: newProject } });
    const byTitle = (title: string) => rows.find((r) => r.title === title)!;
    const scene = byTitle("Scene 1: The kettle");
    expect(scene.id).not.toBe(SCENE_ONE);
    expect(scene.parentRecordId).toBe(byTitle("Chapter 1").id);
    expect(byTitle("A note").parentRecordId).toBe(scene.id);
    const links = await listLinkedReferences(t.db, newProject, scene.id);
    expect(links.map((l) => l.recordId)).toEqual([byTitle("Mara Venn").id]);
  });

  it("restores older backups made before scenes, and rejects broken parents and links", async () => {
    const backup = await createWorkspaceBackup(t.db, IDS.workspace);
    const { checksum: _c, recordLinks: _l, ...rest } = backup;
    const { recordLinks: _n, ...olderCounts } = rest.counts;
    const older = resign({ ...rest, counts: olderCounts, records: rest.records.map(({ parentRecordId: _p, ...r }) => r) });

    const target = await createTestDb();
    try {
      expect((await restoreWorkspaceBackup(target.db, older, { idStrategy: "preserve" })).ok).toBe(true);
      expect(await target.db.recordLink.count()).toBe(0);
    } finally {
      await target.cleanup();
    }

    await withEverything();
    const full = await createWorkspaceBackup(t.db, IDS.workspace);
    const { checksum: _x, ...body } = full;
    const orphan = resign({ ...body, records: body.records.map((r) => (r.id === SCENE_ONE ? { ...r, parentRecordId: null } : r)) });
    const badLink = resign({ ...body, recordLinks: body.recordLinks!.map((l) => ({ ...l, toRecordId: IDS.chapter })) });
    for (const broken of [orphan, badLink]) {
      const outcome = await restoreWorkspaceBackup(t.db, broken, { idStrategy: "remap" });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.issues.map((i) => i.code)).toContain("BACKUP_INTEGRITY");
    }
    expect(await t.db.workspace.count()).toBe(1);
  });

  it("backs up a database from before this migration", async () => {
    // What `pnpm db:deploy` does: back up the old database, then migrate it.
    await t.db.$executeRawUnsafe('DROP TABLE "RecordLink"');
    await t.db.$executeRawUnsafe('DROP INDEX "Record_parentRecordId_idx"');
    await t.db.$executeRawUnsafe('ALTER TABLE "Record" DROP COLUMN "parentRecordId"');
    const backup = await createWorkspaceBackup(t.db, IDS.workspace);
    expect(backup.recordLinks).toEqual([]);
    expect(backup.counts.records).toBeGreaterThan(0);
    expect(backup.records.every((r) => r.parentRecordId === null)).toBe(true);
  });
});

describe("MCP manuscript permission", () => {
  function grant(manuscriptRead: boolean): LocalGrant {
    return { id: "grn_test", label: "Test grant", status: "active", projectIds: [IDS.project], capabilities: ["read"], manuscriptRead };
  }

  it("treats scenes as manuscript", async () => {
    await seedScenes();
    const current = { grant: grant(false) };
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createWordlyMcpServer({ db: t.db, grants: memoryGrantSource(current), disabled: () => false });
    const client = new Client({ name: "wordly-test", version: "0.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = (await client.callTool({ name, arguments: args })) as { content?: { type: string; text?: string }[] };
      return (result.content ?? []).map((c) => c.text ?? "").join("\n");
    };
    try {
      const got = await call("get_records", { projectId: IDS.project, recordIds: [SCENE_ONE] });
      expect(got).toContain("MANUSCRIPT_NOT_PERMITTED");
      expect(got).not.toContain(SCENE_ONE_TEXT);
      const searched = await call("search_references", { projectId: IDS.project, query: "kettle" });
      expect(searched).not.toContain(SCENE_ONE_TEXT);
      expect(searched).not.toContain(SCENE_ONE);
      expect(await call("search_references", { projectId: IDS.project, query: "kettle", types: ["manuscript_scene"] })).toContain(
        "MANUSCRIPT_NOT_PERMITTED",
      );
      expect(await call("list_revisions", { projectId: IDS.project, recordId: SCENE_ONE })).toContain("MANUSCRIPT_NOT_PERMITTED");

      current.grant = grant(true);
      expect(await call("get_records", { projectId: IDS.project, recordIds: [SCENE_ONE] })).toContain(SCENE_ONE_TEXT);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
