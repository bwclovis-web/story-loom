import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyMarkdownImport } from "@/server/services/markdownImportService";
import { applyChapterImport, previewChapterImport, suggestChapterTitle } from "@/server/services/chapterImportService";
import { adoptUnassignedManuscript, listRewriteSources, startAuthorRewrite } from "@/server/services/draftService";
import { createRecord, getRecord, listManuscriptNav, listRecordNav, listRevisions } from "@/server/services/recordService";
import { buildManuscriptTree } from "@/ui/manuscriptTree";
import { createTestDb, IDS, seedProject, snapshotState, type TestDb } from "../helpers";

const file = (filename: string, content: string) => ({ filename, content });
const TIDE = file("12-Tidewater_Chapter_Twelve_DRAFT_v1.md", "# The Tidewater\r\n\r\nThe ferry left at dawn.\r\n");
const ROPE = file("3-Rope_Walk_APPROVED.md", "# The Rope Walk\n\nShe counted the knots twice.\n");
const LOOSE = file("Interlude.md", "No heading here. Just the gulls.\n");

describe("Chapter import", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(() => t.cleanup());

  it("previews in filename-number order without writing", async () => {
    const before = await snapshotState(t.db);
    const preview = await previewChapterImport(t.db, IDS.project, [LOOSE, TIDE, ROPE]);
    expect(preview.map((p) => [p.filename, p.number, p.suggestedTitle])).toEqual([
      [ROPE.filename, 3, "The Rope Walk"],
      [TIDE.filename, 12, "The Tidewater"],
      [LOOSE.filename, null, "Interlude"],
    ]);
    expect(preview.map((p) => p.index)).toEqual([2, 1, 0]);
    expect(preview.every((p) => p.matches.length === 0 && p.issues.length === 0)).toBe(true);
    expect(preview[1].words).toBe(7);
    expect(await snapshotState(t.db)).toEqual(before);
  });

  it("suggests a title from the filename without number, version or status words", () => {
    expect(suggestChapterTitle("18-Saltmarsh_Chapter_One_AUTHOR_REVISED_EDITED.md", "No heading.")).toBe("Saltmarsh Chapter One");
  });

  it("creates protected draft chapters that list in number order, keeping the original files", async () => {
    const outcome = await applyChapterImport(t.db, {
      projectId: IDS.project,
      items: [LOOSE, TIDE, ROPE].map((f) => ({ ...f, title: suggestChapterTitle(f.filename, f.content), decision: { action: "create" } })),
    });
    expect(outcome.status).toBe("applied");
    if (outcome.status !== "applied") return;
    expect(outcome.results.map((r) => [r.filename, r.action])).toEqual([
      [ROPE.filename, "created"],
      [TIDE.filename, "created"],
      [LOOSE.filename, "created"],
    ]);

    const tide = await getRecord(t.db, IDS.project, outcome.results[1].recordId!);
    expect([tide.type, tide.authorityStatus, tide.protected, tide.title]).toEqual(["manuscript_chapter", "draft", true, "The Tidewater"]);
    expect(tide.body).toBe("# The Tidewater\n\nThe ferry left at dawn.\n");
    const stored = await t.db.importedFile.findFirstOrThrow({ where: { recordId: tide.id } });
    expect(stored.content).toBe(TIDE.content);
    const [rev] = await listRevisions(t.db, tide.id);
    expect(rev.source.kind).toBe("markdown_import");

    const tree = buildManuscriptTree(await listRecordNav(t.db, IDS.project));
    expect(tree.chapters.map((c) => c.title)).toEqual(["Chapter 1", "The Rope Walk", "The Tidewater", "Interlude"]);
    expect(await t.db.auditEntry.count({ where: { action: "chapter.import.batch" } })).toBe(1);
  });

  it("offers a newer version of an imported chapter for replacement, and needs the protection confirmation", async () => {
    const first = await applyChapterImport(t.db, { projectId: IDS.project, items: [{ ...TIDE, title: "The Tidewater", decision: { action: "create" } }] });
    if (first.status !== "applied") throw new Error("setup failed");
    const chapterId = first.results[0].recordId!;

    const newer = file("12-Tidewater_Chapter_Twelve_AUTHOR_REVISED_v2.md", "# The Tidewater\n\nThe ferry left before dawn.\n");
    const [preview] = await previewChapterImport(t.db, IDS.project, [newer]);
    expect(preview.matches).toEqual([
      expect.objectContaining({ recordId: chapterId, protected: true, currentRevision: 1, reasons: expect.arrayContaining(["same_document", "same_title"]) }),
    ]);

    const before = await snapshotState(t.db);
    const undecided = await applyChapterImport(t.db, { projectId: IDS.project, items: [{ ...newer, title: "x" }] });
    expect(undecided.status === "rejected" && undecided.issues.map((i) => i.code)).toContain("IMPORT_DECISION_REQUIRED");

    const replace = { action: "replace" as const, recordId: chapterId, expectedRevision: 1 };
    const unconfirmed = await applyChapterImport(t.db, { projectId: IDS.project, items: [{ ...newer, title: "x", decision: replace }] });
    expect(unconfirmed.status === "rejected" && unconfirmed.issues.map((i) => i.code)).toContain("PROTECTED_CONFIRMATION_REQUIRED");
    expect(await snapshotState(t.db)).toEqual(before);

    const done = await applyChapterImport(t.db, {
      projectId: IDS.project,
      items: [{ ...newer, title: "ignored", decision: replace }],
      confirmProtectedReplacements: true,
    });
    expect(done.status).toBe("applied");
    const chapter = await getRecord(t.db, IDS.project, chapterId);
    expect([chapter.currentRevision, chapter.title, chapter.protected]).toEqual([2, "The Tidewater", true]);
    expect(chapter.body).toContain("before dawn");
    expect((await listRevisions(t.db, chapterId)).length).toBe(2);
  });

  it("refuses two versions of one chapter in the same import unless all but one are skipped", async () => {
    const v2 = file("12-Tidewater_Chapter_Twelve_v2.md", "# The Tidewater\n\nAnother draft.\n");
    const both = await applyChapterImport(t.db, {
      projectId: IDS.project,
      items: [TIDE, v2].map((f) => ({ ...f, title: "The Tidewater", decision: { action: "create" as const } })),
    });
    expect(both.status === "rejected" && both.issues.map((i) => i.code)).toContain("DUPLICATE_TARGET");

    const one = await applyChapterImport(t.db, {
      projectId: IDS.project,
      items: [
        { ...TIDE, title: "The Tidewater", decision: { action: "skip" } },
        { ...v2, title: "The Tidewater", decision: { action: "create" } },
      ],
    });
    expect(one.status === "applied" && one.results.map((r) => r.action)).toEqual(["skipped", "created"]);
  });

  it("rejects files that are not text, empty, or identical to the chapter they replace", async () => {
    const bad = await applyChapterImport(t.db, {
      projectId: IDS.project,
      items: [
        { ...file("cover.png", "x"), title: "Cover", decision: { action: "create" } },
        { ...file("2-Empty.md", "  \n"), title: "Empty", decision: { action: "create" } },
      ],
    });
    expect(bad.status === "rejected" && bad.issues.filter((i) => i.severity === "error").length).toBe(2);

    const chapter = await getRecord(t.db, IDS.project, IDS.chapter);
    const same = await applyChapterImport(t.db, {
      projectId: IDS.project,
      items: [{ ...file("1-Chapter.md", chapter.body), title: "", decision: { action: "replace", recordId: IDS.chapter, expectedRevision: 1 } }],
      confirmProtectedReplacements: true,
    });
    expect(same.status === "rejected" && same.issues.map((i) => i.code)).toContain("NO_EFFECTIVE_CHANGE");
  });

  it("tidies the chapter text when asked, keeping the original file as it was", async () => {
    const messy = file("4-Harbour.md", '#Harbour\n\n\n"Wait--" she said...   \n***\nThe end.\n');
    const [preview] = await previewChapterImport(t.db, IDS.project, [messy], { tidy: true });
    expect(preview.excerpt).toBe("# Harbour\n\n\u201CWait\u2014\u201D she said\u2026\n\n* * *\n\nThe end.");

    const outcome = await applyChapterImport(t.db, {
      projectId: IDS.project,
      items: [{ ...messy, title: "Harbour", decision: { action: "create" } }],
      tidy: true,
    });
    if (outcome.status !== "applied") throw new Error("import failed");
    const chapter = await getRecord(t.db, IDS.project, outcome.results[0].recordId!);
    expect(chapter.body).toBe(preview.excerpt);
    const stored = await t.db.importedFile.findFirstOrThrow({ where: { recordId: chapter.id } });
    expect(stored.content).toBe(messy.content);

    const again = await previewChapterImport(t.db, IDS.project, [messy], { tidy: true });
    expect(again[0].matches[0].reasons).toEqual(expect.arrayContaining(["same_filename", "same_content"]));
  });

  it("adds a new chapter to the Zero draft and a blank page under the Author manuscript", async () => {
    const started = await startAuthorRewrite(t.db, IDS.project);
    const outcome = await applyChapterImport(t.db, {
      projectId: IDS.project,
      items: [{ ...TIDE, title: "The Tidewater", decision: { action: "create" } }],
    });
    expect(outcome.status).toBe("applied");
    if (outcome.status !== "applied") return;

    const created = outcome.results[0];
    const source = await t.db.record.findFirstOrThrow({ where: { id: created.recordId! } });
    expect(source.draftId).toBe(started.zeroDraft.id);
    expect(source.body).toContain("The ferry left at dawn.");

    const page = await t.db.record.findFirstOrThrow({ where: { id: created.rewriteRecordId! } });
    expect([page.draftId, page.title, page.body]).toEqual([started.authorDraft.id, "The Tidewater", ""]);
    const pins = await listRewriteSources(t.db, IDS.project, page.id);
    expect(pins.map((p) => [p.toRecordId, p.toRevisionNumber])).toEqual([[source.id, source.currentRevision]]);

    const authorTitles = (await listManuscriptNav(t.db, IDS.project, { hasDrafts: true, draftId: started.authorDraft.id })).map(
      (row) => row.title,
    );
    expect(authorTitles).toContain("The Tidewater");
  });

  it("places a chapter imported with no draft onto the Zero draft and the Author manuscript", async () => {
    const started = await startAuthorRewrite(t.db, IDS.project);
    const created = await createRecord(t.db, IDS.project, {
      type: "manuscript_chapter",
      title: "Chapter Thirty-Two",
      body: "The gate was already open.",
      authorityStatus: "draft",
      draftId: null,
    });
    const sourceId = created.outcomes[0].recordId;
    const adopted = await adoptUnassignedManuscript(t.db, IDS.project);
    expect(adopted).toEqual({ assigned: 1, rewritePages: 1 });

    const source = await t.db.record.findFirstOrThrow({ where: { id: sourceId } });
    expect(source.draftId).toBe(started.zeroDraft.id);
    expect(source.body).toContain("already open");
    const author = await listManuscriptNav(t.db, IDS.project, { hasDrafts: true, draftId: started.authorDraft.id });
    const page = author.find((row) => row.title === "Chapter Thirty-Two");
    expect(page).toBeTruthy();
    const pageRow = await t.db.record.findFirstOrThrow({ where: { id: page!.id } });
    expect(pageRow.body).toBe("");
    const again = await adoptUnassignedManuscript(t.db, IDS.project);
    expect(again).toEqual({ assigned: 0, rewritePages: 0 });
  });

  it("leaves the reference importer unable to create chapters", async () => {
    const outcome = await applyMarkdownImport(t.db, {
      projectId: IDS.project,
      items: [{ ...ROPE, title: "The Rope Walk", type: "manuscript_chapter", authorityStatus: "draft", protected: true }],
    });
    expect(outcome.status === "rejected" && outcome.issues.map((i) => i.code)).toContain("SCOPE_VIOLATION");
  });
});
