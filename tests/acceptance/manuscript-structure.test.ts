import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildManuscriptTree } from "@/ui/manuscriptTree";
import { MutationRejectedError } from "@/server/services/errors";
import { convertChapterScene, mergeManuscriptScenes, splitManuscriptRecord } from "@/server/services/mutationService";
import { createRecord, getRecord, listNotes, listRecordNav, moveRecordInBook } from "@/server/services/recordService";
import { CHAPTER_PROSE, createTestDb, IDS, seedProject, type TestDb } from "../helpers";

const SCENE_A = "rec_test_scene_a";
const SCENE_B = "rec_test_scene_b";
const NOTE = "rec_test_scene_note";
const CHAPTER_TWO = "rec_test_ch02";
const SCENE_A_TEXT = "Rain worked at the shutters while the kettle failed to boil.";
const SCENE_B_TEXT = "By morning the harbour had a new smell.";

let t: TestDb;

async function issueCodes(promise: Promise<unknown>): Promise<string[]> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof MutationRejectedError) return error.issues.map((issue) => issue.code);
    throw error;
  }
  return [];
}

async function order() {
  const tree = buildManuscriptTree(await listRecordNav(t.db, IDS.project));
  return tree.chapters.map((chapter) => [chapter.id, chapter.scenes.map((scene) => scene.id)] as const);
}

beforeEach(async () => {
  t = await createTestDb();
  await seedProject(t.db);
  await createRecord(t.db, IDS.project, {
    recordId: SCENE_A,
    type: "manuscript_scene",
    title: "Scene A",
    body: SCENE_A_TEXT,
    authorityStatus: "draft",
    parentRecordId: IDS.chapter,
  });
  await createRecord(t.db, IDS.project, {
    recordId: SCENE_B,
    type: "manuscript_scene",
    title: "Scene B",
    body: SCENE_B_TEXT,
    authorityStatus: "draft",
    parentRecordId: IDS.chapter,
  });
  await createRecord(t.db, IDS.project, {
    recordId: NOTE,
    type: "scene_note",
    title: "Kettle note",
    body: "The kettle is invented.",
    authorityStatus: "draft",
    parentRecordId: SCENE_B,
  });
  await createRecord(t.db, IDS.project, {
    recordId: CHAPTER_TWO,
    type: "manuscript_chapter",
    title: "Chapter 2",
    body: "A later chapter.",
    authorityStatus: "draft",
  });
});

afterEach(async () => {
  await t.cleanup();
});

describe("manuscript structure", () => {
  it("refuses a protected split until it is unlocked, then keeps both sides and the old revision", async () => {
    const at = CHAPTER_PROSE.indexOf("Mara");
    await t.db.recordLink.create({
      data: { id: "lnk_test_split", projectId: IDS.project, fromRecordId: IDS.chapter, toRecordId: IDS.dossier },
    });
    await t.db.sceneLocation.create({
      data: { id: "scl_test_split", projectId: IDS.project, manuscriptRecordId: IDS.chapter, locationRecordId: IDS.world, isPrimary: true },
    });
    await t.db.manuscriptAnnotation.create({
      data: { id: "man_test_head", projectId: IDS.project, recordId: IDS.chapter, kind: "comment", passageStart: 0, passageEnd: 4, body: "head" },
    });
    await t.db.manuscriptAnnotation.create({
      data: {
        id: "man_test_tail",
        projectId: IDS.project,
        recordId: IDS.chapter,
        kind: "comment",
        passageStart: at,
        passageEnd: CHAPTER_PROSE.length,
        body: "tail",
      },
    });
    await t.db.storyEvent.create({ data: { id: "sev_test_split", projectId: IDS.project, title: "The dry ledger" } });
    await t.db.storyEventScene.create({
      data: { id: "evs_test_split", projectId: IDS.project, eventId: "sev_test_split", manuscriptRecordId: IDS.chapter },
    });

    const before = await getRecord(t.db, IDS.project, IDS.chapter);
    expect(await issueCodes(splitManuscriptRecord(t.db, {
      projectId: IDS.project,
      recordId: IDS.chapter,
      expectedRevision: before.currentRevision,
      splitAt: at,
      newTitle: "After the ledger",
      unlockProtected: false,
    }))).toEqual(["PROTECTED_RECORD"]);
    expect((await getRecord(t.db, IDS.project, IDS.chapter)).body).toBe(CHAPTER_PROSE);

    const split = await splitManuscriptRecord(t.db, {
      projectId: IDS.project,
      recordId: IDS.chapter,
      expectedRevision: before.currentRevision,
      splitAt: at,
      newTitle: "After the ledger",
      unlockProtected: true,
    });
    const head = await getRecord(t.db, IDS.project, IDS.chapter);
    const tail = await getRecord(t.db, IDS.project, split.newRecordId);
    expect(head.body).toBe("The ledger had been dry for three hundred years.");
    expect(head.currentRevision).toBe(before.currentRevision + 1);
    expect(head.protected).toBe(true);
    expect(await t.db.revision.count({ where: { recordId: IDS.chapter } })).toBe(2);
    expect(tail.title).toBe("After the ledger");
    expect(tail.body.startsWith("Mara Venn")).toBe(true);
    expect(tail.type).toBe("manuscript_chapter");
    expect(tail.protected).toBe(true);
    expect(tail.currentRevision).toBe(1);
    expect(await order()).toEqual([
      [IDS.chapter, [SCENE_A, SCENE_B]],
      [split.newRecordId, []],
      [CHAPTER_TWO, []],
    ]);
    expect(await t.db.sceneLocation.count({ where: { manuscriptRecordId: IDS.chapter } })).toBe(1);
    expect(await t.db.sceneLocation.count({ where: { manuscriptRecordId: split.newRecordId } })).toBe(0);
    expect(await t.db.recordLink.count({ where: { fromRecordId: IDS.chapter } })).toBe(1);
    expect(await t.db.recordLink.count({ where: { fromRecordId: split.newRecordId, toRecordId: IDS.dossier } })).toBe(1);
    expect(await t.db.storyEventScene.count({ where: { manuscriptRecordId: split.newRecordId } })).toBe(1);
    const headComment = await t.db.manuscriptAnnotation.findUniqueOrThrow({ where: { id: "man_test_head" } });
    const tailComment = await t.db.manuscriptAnnotation.findUniqueOrThrow({ where: { id: "man_test_tail" } });
    expect(headComment.recordId).toBe(IDS.chapter);
    expect(tailComment.recordId).toBe(split.newRecordId);
    expect(tailComment.passageStart).toBe(0);
    expect(tailComment.needsRecheck).toBe(true);
  });

  it("merges a scene into the previous one and moves its children before trashing it", async () => {
    await t.db.sceneLocation.create({
      data: { id: "scl_test_merge", projectId: IDS.project, manuscriptRecordId: SCENE_B, locationRecordId: IDS.world, isPrimary: true },
    });
    await t.db.recordLink.create({
      data: { id: "lnk_test_merge", projectId: IDS.project, fromRecordId: SCENE_B, toRecordId: IDS.dossier },
    });
    await t.db.storyEvent.create({ data: { id: "sev_test_merge", projectId: IDS.project, title: "Morning harbour" } });
    await t.db.storyEventScene.create({
      data: { id: "evs_test_merge", projectId: IDS.project, eventId: "sev_test_merge", manuscriptRecordId: SCENE_B },
    });
    await t.db.manuscriptAnnotation.create({
      data: { id: "man_test_keep_syn", projectId: IDS.project, recordId: SCENE_A, kind: "synopsis", body: "Keep this blurb" },
    });
    await t.db.manuscriptAnnotation.create({
      data: { id: "man_test_drop_syn", projectId: IDS.project, recordId: SCENE_B, kind: "synopsis", body: "Drop this blurb" },
    });
    await t.db.manuscriptAnnotation.create({
      data: { id: "man_test_drop_comment", projectId: IDS.project, recordId: SCENE_B, kind: "comment", passageStart: 0, passageEnd: 2, body: "By" },
    });
    await t.db.weaveGrid.create({
      data: { id: "wvg_test", projectId: IDS.project, title: "Plan", viewKind: "original" },
    });
    await t.db.weaveBeat.create({
      data: { id: "wvb_test", gridId: "wvg_test", projectId: IDS.project, title: "Harbour", manuscriptRecordId: SCENE_B, x: 0, y: 0 },
    });

    const keep = await getRecord(t.db, IDS.project, SCENE_A);
    const drop = await getRecord(t.db, IDS.project, SCENE_B);
    expect(await issueCodes(mergeManuscriptScenes(t.db, {
      projectId: IDS.project,
      keepRecordId: SCENE_A,
      dropRecordId: SCENE_B,
      expectedKeepRevision: keep.currentRevision,
      expectedDropRevision: drop.currentRevision,
      unlockProtected: false,
    }))).toEqual(["PROTECTED_RECORD"]);
    expect((await t.db.record.findUniqueOrThrow({ where: { id: SCENE_B } })).trashedAt).toBeNull();

    await mergeManuscriptScenes(t.db, {
      projectId: IDS.project,
      keepRecordId: SCENE_A,
      dropRecordId: SCENE_B,
      expectedKeepRevision: keep.currentRevision,
      expectedDropRevision: drop.currentRevision,
      unlockProtected: true,
    });
    const merged = await getRecord(t.db, IDS.project, SCENE_A);
    expect(merged.body).toBe(`${SCENE_A_TEXT}\n\n${SCENE_B_TEXT}`);
    expect(merged.currentRevision).toBe(keep.currentRevision + 1);
    const trashed = await t.db.record.findUniqueOrThrow({ where: { id: SCENE_B } });
    expect(trashed.trashedAt).not.toBeNull();
    expect(await t.db.revision.count({ where: { recordId: SCENE_B } })).toBe(1);
    expect((await listNotes(t.db, IDS.project, SCENE_A)).map((note) => note.id)).toEqual([NOTE]);
    expect(await t.db.sceneLocation.findUniqueOrThrow({ where: { id: "scl_test_merge" } })).toMatchObject({
      manuscriptRecordId: SCENE_A,
      isPrimary: true,
    });
    expect(await t.db.recordLink.findUniqueOrThrow({ where: { id: "lnk_test_merge" } })).toMatchObject({ fromRecordId: SCENE_A });
    expect(await t.db.storyEventScene.findUniqueOrThrow({ where: { id: "evs_test_merge" } })).toMatchObject({
      manuscriptRecordId: SCENE_A,
    });
    expect(await t.db.weaveBeat.findUniqueOrThrow({ where: { id: "wvb_test" } })).toMatchObject({ manuscriptRecordId: SCENE_A });
    const comment = await t.db.manuscriptAnnotation.findUniqueOrThrow({ where: { id: "man_test_drop_comment" } });
    expect(comment.recordId).toBe(SCENE_A);
    expect(comment.passageStart).toBe(SCENE_A_TEXT.length + 2);
    expect(comment.needsRecheck).toBe(true);
    expect(await t.db.manuscriptAnnotation.findUnique({ where: { id: "man_test_drop_syn" } })).toBeNull();
    expect((await t.db.manuscriptAnnotation.findUniqueOrThrow({ where: { id: "man_test_keep_syn" } })).body).toBe("Keep this blurb");
  });

  it("converts a scene and a chapter without a new revision, and refuses a locked or occupied chapter", async () => {
    const scene = await getRecord(t.db, IDS.project, SCENE_A);
    expect(await issueCodes(convertChapterScene(t.db, {
      projectId: IDS.project,
      recordId: SCENE_A,
      to: "chapter",
      unlockProtected: false,
    }))).toEqual(["PROTECTED_RECORD"]);

    await convertChapterScene(t.db, { projectId: IDS.project, recordId: SCENE_A, to: "chapter", unlockProtected: true });
    const asChapter = await getRecord(t.db, IDS.project, SCENE_A);
    expect(asChapter.type).toBe("manuscript_chapter");
    expect(asChapter.parentRecordId).toBeNull();
    expect(asChapter.currentRevision).toBe(scene.currentRevision);
    expect(asChapter.body).toBe(SCENE_A_TEXT);
    expect((await order()).map(([id]) => id)).toEqual([IDS.chapter, SCENE_A, CHAPTER_TWO]);

    expect(await issueCodes(convertChapterScene(t.db, {
      projectId: IDS.project,
      recordId: IDS.chapter,
      to: "scene",
      parentRecordId: CHAPTER_TWO,
      unlockProtected: true,
    }))).toEqual(["INVALID_PARENT"]);

    await convertChapterScene(t.db, {
      projectId: IDS.project,
      recordId: SCENE_A,
      to: "scene",
      parentRecordId: CHAPTER_TWO,
      unlockProtected: true,
    });
    const asScene = await getRecord(t.db, IDS.project, SCENE_A);
    expect(asScene.type).toBe("manuscript_scene");
    expect(asScene.parentRecordId).toBe(CHAPTER_TWO);
    expect(asScene.currentRevision).toBe(scene.currentRevision);
    expect(await order()).toEqual([
      [IDS.chapter, [SCENE_B]],
      [CHAPTER_TWO, [SCENE_A]],
    ]);
  });

  it("reorders scenes the way the corkboard does, without a new revision", async () => {
    const before = await getRecord(t.db, IDS.project, SCENE_B);
    await moveRecordInBook(t.db, IDS.project, { recordId: SCENE_B, parentRecordId: IDS.chapter, index: 0 });
    expect(await order()).toEqual([
      [IDS.chapter, [SCENE_B, SCENE_A]],
      [CHAPTER_TWO, []],
    ]);
    expect((await getRecord(t.db, IDS.project, SCENE_B)).currentRevision).toBe(before.currentRevision);
  });
});
