import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildManuscriptTree } from "@/ui/manuscriptTree";
import {
  attachRewriteSource,
  getDraftDefaults,
  listManuscriptDrafts,
  listRewriteSources,
  setDefaultExportDraft,
  setDefaultReadingDraft,
  setDraftCompletion,
  startAuthorRewrite,
} from "@/server/services/draftService";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "@/server/services/backupService";
import { buildManuscriptPdf } from "@/server/services/pdfExportService";
import { createRecord, getRecord, listRecordNav } from "@/server/services/recordService";
import { manuscriptWordCounts, sumWordCounts } from "@/server/services/wordCountService";
import { resolveDraftScope } from "@/server/services/draftService";
import { CHAPTER_PROSE, createTestDb, IDS, seedProject, type TestDb } from "../helpers";

describe("Author rewrite drafts", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("keeps legacy projects project-wide until Start, then promotes and creates blank rewrite pages once", async () => {
    const scene = await createRecord(t.db, IDS.project, {
      type: "manuscript_scene",
      title: "Opening",
      body: "Rain on the quay.",
      authorityStatus: "draft",
      parentRecordId: IDS.chapter,
    });
    const sceneId = scene.outcomes[0].recordId;

    expect(await listManuscriptDrafts(t.db, IDS.project)).toEqual([]);
    const legacyNav = await listRecordNav(t.db, IDS.project);
    expect(buildManuscriptTree(legacyNav).chapters).toHaveLength(1);
    expect(sumWordCounts(await manuscriptWordCounts(t.db, IDS.project))).toBeGreaterThan(0);

    const first = await startAuthorRewrite(t.db, IDS.project);
    expect(first.alreadyExisted).toBe(false);
    expect(first.zeroDraft.kind).toBe("zero_draft");
    expect(first.authorDraft.kind).toBe("author_manuscript");
    expect(first.createdRecordIds.length).toBe(2);

    const chapter = await t.db.record.findUniqueOrThrow({ where: { id: IDS.chapter } });
    expect(chapter.draftId).toBe(first.zeroDraft.id);
    expect(chapter.body).toBe(CHAPTER_PROSE);

    const authorRecords = await t.db.record.findMany({
      where: { projectId: IDS.project, draftId: first.authorDraft.id, trashedAt: null },
      orderBy: { title: "asc" },
    });
    expect(authorRecords).toHaveLength(2);
    expect(authorRecords.every((r) => r.body === "")).toBe(true);

    const sources = await listRewriteSources(t.db, IDS.project, first.createdRecordIds[0]);
    expect(sources.length).toBe(1);
    expect(sources[0].toRevisionNumber).toBe(1);

    const defaults = await getDraftDefaults(t.db, IDS.project);
    expect(defaults.defaultReadingDraftId).toBeNull();
    expect(defaults.defaultExportDraftId).toBeNull();

    const second = await startAuthorRewrite(t.db, IDS.project);
    expect(second.alreadyExisted).toBe(true);
    expect(second.authorDraft.id).toBe(first.authorDraft.id);
    expect(second.createdRecordIds).toEqual([]);
    const authorCount = await t.db.record.count({
      where: { projectId: IDS.project, draftId: first.authorDraft.id, trashedAt: null },
    });
    expect(authorCount).toBe(2);

    // Scoping: Write/Read/counts see only the selected draft.
    const zeroNav = await listRecordNav(t.db, IDS.project, {
      hasDrafts: true,
      draftId: first.zeroDraft.id,
    });
    const authorNav = await listRecordNav(t.db, IDS.project, {
      hasDrafts: true,
      draftId: first.authorDraft.id,
    });
    expect(buildManuscriptTree(zeroNav).chapters.map((c) => c.id)).toEqual([IDS.chapter]);
    expect(buildManuscriptTree(authorNav).chapters).toHaveLength(1);
    expect(buildManuscriptTree(authorNav).chapters[0].id).not.toBe(IDS.chapter);

    const zeroWords = sumWordCounts(
      await manuscriptWordCounts(t.db, IDS.project, resolveDraftScope(true, first.zeroDraft.id)),
    );
    const authorWords = sumWordCounts(
      await manuscriptWordCounts(t.db, IDS.project, resolveDraftScope(true, first.authorDraft.id)),
    );
    expect(zeroWords).toBeGreaterThan(0);
    expect(authorWords).toBe(0);

    await setDefaultReadingDraft(t.db, IDS.project, first.authorDraft.id);
    await setDefaultExportDraft(t.db, IDS.project, first.zeroDraft.id);
    const afterDefaults = await getDraftDefaults(t.db, IDS.project);
    expect(afterDefaults.defaultReadingDraftId).toBe(first.authorDraft.id);
    expect(afterDefaults.defaultExportDraftId).toBe(first.zeroDraft.id);

    // Start still must not flip defaults.
    await startAuthorRewrite(t.db, IDS.project);
    const still = await getDraftDefaults(t.db, IDS.project);
    expect(still.defaultReadingDraftId).toBe(first.authorDraft.id);
    expect(still.defaultExportDraftId).toBe(first.zeroDraft.id);

    await setDraftCompletion(t.db, IDS.project, first.authorDraft.id, true);
    const completed = await listManuscriptDrafts(t.db, IDS.project);
    expect(completed.find((d) => d.id === first.authorDraft.id)?.completedAt).toBeTruthy();

    // Multi-source: attach the other zero-draft scene to one rewrite page.
    const rewriteChapter = authorRecords.find((r) => r.type === "manuscript_chapter")!;
    await attachRewriteSource(t.db, IDS.project, rewriteChapter.id, sceneId);
    const multi = await listRewriteSources(t.db, IDS.project, rewriteChapter.id);
    expect(multi.map((s) => s.toRecordId).sort()).toEqual([IDS.chapter, sceneId].sort());

    const pdf = await buildManuscriptPdf(t.db, IDS.project, {
      sceneTitles: false,
      hasDrafts: true,
      draftId: first.authorDraft.id,
    });
    expect(pdf.bytes.byteLength).toBeGreaterThan(100);
  });

  it("round-trips drafts and rewrite source links through backup restore", async () => {
    const scene = await createRecord(t.db, IDS.project, {
      type: "manuscript_scene",
      title: "Dock",
      body: "Salt air.",
      authorityStatus: "draft",
      parentRecordId: IDS.chapter,
    });
    const started = await startAuthorRewrite(t.db, IDS.project);
    await setDefaultReadingDraft(t.db, IDS.project, started.authorDraft.id);
    await setDraftCompletion(t.db, IDS.project, started.authorDraft.id, true);
    const rewriteScene = (
      await t.db.record.findMany({
        where: { draftId: started.authorDraft.id, type: "manuscript_scene" },
      })
    )[0];
    // Start already pinned the matching Zero-draft scene; attach the chapter too (multi-source).
    await attachRewriteSource(t.db, IDS.project, rewriteScene.id, IDS.chapter);

    const backup = await createWorkspaceBackup(t.db, IDS.workspace);
    expect(backup.manuscriptDrafts?.length).toBe(2);
    expect(backup.rewriteSourceLinks?.length).toBeGreaterThanOrEqual(2);
    expect(backup.projects[0].defaultReadingDraftId).toBe(started.authorDraft.id);

    const target = await createTestDb();
    try {
      const restored = await restoreWorkspaceBackup(target.db, backup, { idStrategy: "remap" });
      expect(restored.ok).toBe(true);
      if (!restored.ok) return;
      const projectId = restored.projects[0].id;
      const drafts = await listManuscriptDrafts(target.db, projectId);
      expect(drafts).toHaveLength(2);
      expect(drafts.find((d) => d.kind === "author_manuscript")?.completedAt).toBeTruthy();
      const defaults = await getDraftDefaults(target.db, projectId);
      expect(defaults.defaultReadingDraftId).toBeTruthy();
      const links = await target.db.rewriteSourceLink.findMany({ where: { projectId } });
      expect(links.length).toBeGreaterThanOrEqual(2);
      for (const link of links) {
        const rev = await target.db.revision.findUnique({
          where: {
            recordId_revisionNumber: { recordId: link.toRecordId, revisionNumber: link.toRevisionNumber },
          },
        });
        expect(rev).toBeTruthy();
      }
      const author = drafts.find((d) => d.kind === "author_manuscript")!;
      const blank = await target.db.record.findMany({
        where: { projectId, draftId: author.id, trashedAt: null },
      });
      expect(blank.every((r) => r.body === "")).toBe(true);
      const zeroChapter = await getRecord(t.db, IDS.project, IDS.chapter);
      expect(zeroChapter.body).toBe(CHAPTER_PROSE);
    } finally {
      await target.cleanup();
    }
  });
});
