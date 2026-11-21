import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "@/server/services/backupService";
import { getCompileProfile, upsertCompileProfile } from "@/server/services/compileProfileService";
import { buildManuscriptDocx } from "@/server/services/docxExportService";
import { buildManuscriptEpub } from "@/server/services/epubExportService";
import { buildManuscriptPdf } from "@/server/services/pdfExportService";
import { upsertSynopsis } from "@/server/services/manuscriptAnnotationService";
import { createRecord } from "@/server/services/recordService";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";

describe("Compile profiles in manuscript export", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
    await createRecord(t.db, IDS.project, {
      type: "manuscript_scene",
      title: "The wet ledger",
      body: "Water beaded on the page.",
      authorityStatus: "draft",
      parentRecordId: IDS.chapter,
    });
    await upsertCompileProfile(t.db, IDS.project, {
      titlePageBody: "",
      copyrightPageBody: "",
      dedicationBody: "For the reader.",
      acknowledgementsBody: "",
      sceneBreakGlyph: "###",
      chapterHeadingStyle: "left",
      includeSynopses: true,
      includeMarginComments: false,
    });
    await upsertSynopsis(t.db, IDS.project, IDS.chapter, "A chapter overview.");
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("applies dedication, synopsis, and scene-break settings across formats", async () => {
    const when = new Date(2026, 0, 2);
    const opts = { sceneTitles: false, hasDrafts: false, draftId: null };
    const [pdf, docx, epub] = await Promise.all([
      buildManuscriptPdf(t.db, IDS.project, opts, when),
      buildManuscriptDocx(t.db, IDS.project, opts, when),
      buildManuscriptEpub(t.db, IDS.project, opts, when),
    ]);

    expect(pdf.bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(pdf.documentCount).toBe(docx.documentCount);

    const docxZip = await JSZip.loadAsync(docx.bytes);
    const docXml = (await docxZip.file("word/document.xml")?.async("string")) ?? "";
    expect(docXml).toContain("For the reader.");
    expect(docXml).toContain("Synopsis");
    expect(docXml).toContain("###");

    const epubZip = await JSZip.loadAsync(epub.bytes);
    const dedication = (await epubZip.file("OEBPS/matter-dedication.xhtml")?.async("string")) ?? "";
    expect(dedication).toContain("For the reader.");
    const ch1 = (await epubZip.file("OEBPS/ch-1.xhtml")?.async("string")) ?? "";
    expect(ch1).toContain("Synopsis");
    expect(ch1).toContain("###");
  });

  it("round-trips layout fields and leaves an excluded chapter out of the PDF", async () => {
    await upsertCompileProfile(t.db, IDS.project, {
      titlePageBody: "",
      copyrightPageBody: "",
      dedicationBody: "",
      acknowledgementsBody: "",
      sceneBreakGlyph: "***",
      chapterHeadingStyle: "centered",
      includeSynopses: false,
      includeMarginComments: false,
      trimSize: "5x8",
      marginInches: 0.6,
      runningHeader: "Salt",
      runningFooter: "Archive",
      fontPreset: "sans",
      spacingPreset: "tight",
      firstParagraphNoIndent: false,
      dropCap: false,
      includeToc: false,
      backMatterBody: "About the salt.",
      excludedRecordIds: [IDS.chapter],
    });
    const backup = await createWorkspaceBackup(t.db, IDS.workspace);
    const fresh = await createTestDb();
    const outcome = await restoreWorkspaceBackup(fresh.db, backup, { idStrategy: "preserve" });
    expect(outcome.ok).toBe(true);
    const restored = await getCompileProfile(fresh.db, IDS.project);
    expect(restored.trimSize).toBe("5x8");
    expect(restored.runningHeader).toBe("Salt");
    expect(restored.backMatterBody).toBe("About the salt.");
    expect(restored.excludedRecordIds).toEqual([IDS.chapter]);
    const pdf = await buildManuscriptPdf(fresh.db, IDS.project, { sceneTitles: false, hasDrafts: false, draftId: null });
    expect(pdf.documentCount).toBe(0);
    await fresh.cleanup();
  });
});