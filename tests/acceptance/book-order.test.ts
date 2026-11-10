import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "@/server/services/backupService";
import { MutationRejectedError } from "@/server/services/errors";
import { createProject } from "@/server/services/projectService";
import { createRecord, listRecordNav, moveRecordInBook, moveRecordToTrash } from "@/server/services/recordService";
import { searchManuscript } from "@/server/services/searchService";
import { buildManuscriptTree } from "@/ui/manuscriptTree";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";

/*
 * Book order and manuscript search against a real (temporary) database.
 * All text is invented.
 */

const CH2 = "rec_test_ch02";
const CH3 = "rec_test_ch03";
const SC_A = "rec_test_scene_a";
const SC_B = "rec_test_scene_b";
const NOTE = "rec_test_note_a";

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

async function order() {
  const tree = buildManuscriptTree(await listRecordNav(t.db, IDS.project));
  return tree.chapters.map((c) => [c.id, c.scenes.map((s) => s.id)]);
}

beforeEach(async () => {
  t = await createTestDb();
  await seedProject(t.db);
  const add = (recordId: string, type: "manuscript_chapter" | "manuscript_scene" | "scene_note", title: string, body: string, parentRecordId?: string) =>
    createRecord(t.db, IDS.project, { recordId, type, title, body, authorityStatus: "draft", parentRecordId });
  await add(CH2, "manuscript_chapter", "Chapter 2", "The tide came in twice that night.");
  await add(CH3, "manuscript_chapter", "Chapter 3", "Nobody mentioned the tide again.");
  await add(SC_A, "manuscript_scene", "Scene A", "Lanterns along the tide line.", IDS.chapter);
  await add(SC_B, "manuscript_scene", "Scene B: Tide", "Gulls over the harbour.", IDS.chapter);
  await add(NOTE, "scene_note", "Check the tide tables", "Tide at 4am?", SC_A);
});

afterEach(async () => {
  await t.cleanup();
});

describe("book order", () => {
  it("starts in creation order and moves a protected chapter without a revision or unlock", async () => {
    expect(await order()).toEqual([
      [IDS.chapter, [SC_A, SC_B]],
      [CH2, []],
      [CH3, []],
    ]);
    const before = await t.db.record.findUniqueOrThrow({ where: { id: CH3 } });
    expect(before.protected).toBe(true);
    const revisions = await t.db.revision.count();

    const result = await moveRecordInBook(t.db, IDS.project, { recordId: CH3, parentRecordId: null, index: 0 });
    expect(result).toEqual({ moved: true, position: 0, of: 3 });
    expect((await order()).map(([id]) => id)).toEqual([CH3, IDS.chapter, CH2]);

    const after = await t.db.record.findUniqueOrThrow({ where: { id: CH3 } });
    expect(after.currentRevision).toBe(before.currentRevision);
    expect(after.body).toBe(before.body);
    expect(await t.db.revision.count()).toBe(revisions);
    const audit = await t.db.auditEntry.findFirstOrThrow({ where: { action: "record.move" } });
    expect(audit.summary).toBe('Moved chapter "Chapter 3" to place 1 of 3');
  });

  it("records nothing for a move that changes nothing", async () => {
    const result = await moveRecordInBook(t.db, IDS.project, { recordId: IDS.chapter, parentRecordId: null, index: 0 });
    expect(result.moved).toBe(false);
    expect(await t.db.auditEntry.count({ where: { action: "record.move" } })).toBe(0);
  });

  it("puts a chapter created after a reorder at the end", async () => {
    await moveRecordInBook(t.db, IDS.project, { recordId: CH2, parentRecordId: null, index: 99 });
    await createRecord(t.db, IDS.project, { recordId: "rec_test_ch04", type: "manuscript_chapter", title: "Chapter 4", authorityStatus: "draft" });
    expect((await order()).map(([id]) => id)).toEqual([IDS.chapter, CH3, CH2, "rec_test_ch04"]);
  });

  it("reorders scenes and moves a scene, with its notes, to another chapter", async () => {
    await moveRecordInBook(t.db, IDS.project, { recordId: SC_B, parentRecordId: IDS.chapter, index: 0 });
    expect((await order())[0]).toEqual([IDS.chapter, [SC_B, SC_A]]);

    await moveRecordInBook(t.db, IDS.project, { recordId: SC_A, parentRecordId: CH2, index: 0 });
    expect(await order()).toEqual([
      [IDS.chapter, [SC_B]],
      [CH2, [SC_A]],
      [CH3, []],
    ]);
    const note = await t.db.record.findUniqueOrThrow({ where: { id: NOTE } });
    expect(note.parentRecordId).toBe(SC_A);
    const audit = await t.db.auditEntry.findMany({ where: { action: "record.move" }, orderBy: { createdAt: "asc" } });
    expect(audit.at(-1)!.summary).toBe('Moved scene "Scene A" to "Chapter 2", place 1 of 1');
  });

  it("refuses moves that break the manuscript structure", async () => {
    await createProject(t.db, { id: "prj_test_other", workspaceId: IDS.workspace, title: "Other" });
    await createRecord(t.db, "prj_test_other", { recordId: "rec_test_other_ch", type: "manuscript_chapter", title: "Elsewhere", authorityStatus: "draft" });
    const move = (recordId: string, parentRecordId: string | null) => moveRecordInBook(t.db, IDS.project, { recordId, parentRecordId, index: 0 });
    expect(await issueCodes(move(CH2, IDS.chapter))).toEqual(["INVALID_PARENT"]);
    expect(await issueCodes(move(SC_A, null))).toEqual(["INVALID_PARENT"]);
    expect(await issueCodes(move(SC_A, SC_B))).toEqual(["INVALID_PARENT"]);
    expect(await issueCodes(move(SC_A, "rec_test_other_ch"))).toEqual(["INVALID_PARENT"]);
    expect(await issueCodes(move(NOTE, IDS.chapter))).toEqual(["INVALID_PARENT"]);
    expect(await issueCodes(move(IDS.dossier, null))).toEqual(["INVALID_PARENT"]);
    await moveRecordToTrash(t.db, IDS.project, CH3, true);
    expect(await issueCodes(move(SC_A, CH3))).toEqual(["INVALID_PARENT"]);
  });

  it("keeps the order in a backup and a restored copy", async () => {
    await moveRecordInBook(t.db, IDS.project, { recordId: CH3, parentRecordId: null, index: 0 });
    await moveRecordInBook(t.db, IDS.project, { recordId: SC_A, parentRecordId: CH3, index: 0 });
    const backup = await createWorkspaceBackup(t.db, IDS.workspace);
    expect(backup.records.find((r) => r.id === CH3)!.position).toBe(0);
    expect(backup.records.find((r) => r.id === IDS.dossier)!.position).toBeUndefined();

    const copy = await restoreWorkspaceBackup(t.db, backup, { idStrategy: "remap" });
    if (!copy.ok) throw new Error("restore failed");
    const project = copy.projects.find((p) => p.originalId === IDS.project)!.id;
    const nav = await listRecordNav(t.db, project);
    const title = new Map(nav.map((n) => [n.id, n.title]));
    const tree = buildManuscriptTree(nav);
    expect(tree.chapters.map((c) => [title.get(c.id), c.scenes.map((s) => title.get(s.id))])).toEqual([
      ["Chapter 3", ["Scene A"]],
      ["Chapter 1", ["Scene B: Tide"]],
      ["Chapter 2", []],
    ]);
  });
});

describe("manuscript search", () => {
  it("finds every match in book order, with notes after what they are on", async () => {
    await moveRecordInBook(t.db, IDS.project, { recordId: CH3, parentRecordId: null, index: 0 });
    const { hits, totalMatches } = await searchManuscript(t.db, { projectId: IDS.project, query: "tide", matchCase: false });
    expect(hits.map((h) => [h.id, h.count, h.titleMatches])).toEqual([
      [CH3, 1, false],
      [SC_A, 1, false],
      [NOTE, 1, true],
      [SC_B, 0, true],
      [CH2, 1, false],
    ]);
    expect(totalMatches).toBe(4);
    expect(hits.find((h) => h.id === SC_A)!.parentTitle).toBe("Chapter 1");
    expect(hits.find((h) => h.id === NOTE)!.excerpts[0].match).toBe("Tide");
  });

  it("matches case when asked, skips reference records and the Trash", async () => {
    const exact = await searchManuscript(t.db, { projectId: IDS.project, query: "Tide", matchCase: true });
    expect(exact.hits.map((h) => h.id)).toEqual([NOTE, SC_B]);
    expect((await searchManuscript(t.db, { projectId: IDS.project, query: "Archivist", matchCase: false })).hits).toEqual([]);
    await moveRecordToTrash(t.db, IDS.project, CH2, true);
    const after = await searchManuscript(t.db, { projectId: IDS.project, query: "twice", matchCase: false });
    expect(after.hits).toEqual([]);
    expect((await searchManuscript(t.db, { projectId: IDS.project, query: "   ", matchCase: false })).hits).toEqual([]);
  });
});
