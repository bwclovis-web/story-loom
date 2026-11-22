import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCompileProfile, upsertCompileProfile } from "@/server/services/compileProfileService";
import { validateManuscriptCompile } from "@/server/services/compileValidationService";
import { buildManuscriptDocx } from "@/server/services/docxExportService";
import { buildManuscriptEpub } from "@/server/services/epubExportService";
import { buildManuscriptPdf } from "@/server/services/pdfExportService";
import { createRecord } from "@/server/services/recordService";
import { layoutForPreset } from "@/writing/exportPresets";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";

async function applyPreset(
  db: TestDb["db"],
  preset: "standard_manuscript" | "formatter_ready",
  extras?: { excludedRecordIds?: string[] },
) {
  const current = await getCompileProfile(db, IDS.project);
  const layout = layoutForPreset(preset);
  return upsertCompileProfile(db, IDS.project, {
    titlePageBody: current.titlePageBody,
    copyrightPageBody: current.copyrightPageBody,
    dedicationBody: current.dedicationBody || (preset === "formatter_ready" ? "For the reader." : ""),
    acknowledgementsBody: current.acknowledgementsBody,
    backMatterBody: preset === "formatter_ready" ? "About the author." : current.backMatterBody,
    excludedRecordIds: extras?.excludedRecordIds ?? current.excludedRecordIds,
    ...layout,
  });
}

describe("Export presets (Milestone 5)", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
    await createRecord(t.db, IDS.project, {
      type: "manuscript_scene",
      title: "The wet ledger",
      body: "Water beaded on the page. [[Harbour]] waited.",
      authorityStatus: "draft",
      parentRecordId: IDS.chapter,
    });
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("standard manuscript DOCX uses headers, word count, and # scene breaks", async () => {
    await applyPreset(t.db, "standard_manuscript");
    const when = new Date(2026, 2, 1);
    const docx = await buildManuscriptDocx(
      t.db,
      IDS.project,
      { sceneTitles: false, hasDrafts: false, draftId: null },
      when,
    );
    const zip = await JSZip.loadAsync(docx.bytes);
    const docXml = (await zip.file("word/document.xml")?.async("string")) ?? "";
    expect(docXml).toMatch(/About \d[\d,]* words/);
    expect(docXml).toContain("#");

    const headerFile = Object.keys(zip.files).find((name) => /word\/header\d*\.xml$/i.test(name));
    expect(headerFile).toBeTruthy();
    const headerXml = (await zip.file(headerFile!)?.async("string")) ?? "";
    expect(headerXml).toMatch(/w:hdr|pgNum|PAGE/i);

    const pdf = await buildManuscriptPdf(
      t.db,
      IDS.project,
      { sceneTitles: false, hasDrafts: false, draftId: null },
      when,
    );
    expect(pdf.bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("formatter-ready EPUB keeps front matter before chapters and back matter after", async () => {
    await applyPreset(t.db, "formatter_ready");
    const epub = await buildManuscriptEpub(t.db, IDS.project, {
      sceneTitles: false,
      hasDrafts: false,
      draftId: null,
    });
    const zip = await JSZip.loadAsync(epub.bytes);
    const opf = (await zip.file("OEBPS/content.opf")?.async("string")) ?? "";
    const spineIds = [...opf.matchAll(/idref="([^"]+)"/g)].map((m) => m[1]);
    const dedicationIdx = spineIds.indexOf("matter-dedication");
    const backIdx = spineIds.indexOf("matter-back-matter");
    const ch1Idx = spineIds.indexOf("ch-1");
    expect(dedicationIdx).toBeGreaterThanOrEqual(0);
    expect(ch1Idx).toBeGreaterThan(dedicationIdx);
    expect(backIdx).toBeGreaterThan(ch1Idx);

    const ch1 = (await zip.file("OEBPS/ch-1.xhtml")?.async("string")) ?? "";
    expect(ch1).toContain("***");
    expect(ch1).toContain("<h1");

    const docx = await buildManuscriptDocx(t.db, IDS.project, {
      sceneTitles: false,
      hasDrafts: false,
      draftId: null,
    });
    const docxZip = await JSZip.loadAsync(docx.bytes);
    const docXml = (await docxZip.file("word/document.xml")?.async("string")) ?? "";
    expect(docXml).toContain("About the author.");
    expect(docXml).toContain("For the reader.");
  });

  it("pre-export validation flags unplaced scenes and [[links]] without writing", async () => {
    // Excluding the chapter leaves its scenes in the unplaced export list.
    await applyPreset(t.db, "formatter_ready", { excludedRecordIds: [IDS.chapter] });
    const before = await t.db.record.count();
    const report = await validateManuscriptCompile(t.db, IDS.project, {
      sceneTitles: false,
      hasDrafts: false,
      draftId: null,
    });
    expect(await t.db.record.count()).toBe(before);
    expect(report.unplacedSceneCount).toBeGreaterThanOrEqual(1);
    expect(report.wordCount).toBeGreaterThan(0);
    expect(report.issues.some((i) => i.code === "UNPLACED_SCENES")).toBe(true);
    expect(report.issues.some((i) => i.code === "UNRESOLVED_LINKS")).toBe(true);
  });
});
