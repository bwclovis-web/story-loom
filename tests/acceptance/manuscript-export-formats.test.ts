import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildManuscriptDocx } from "@/server/services/docxExportService";
import { buildManuscriptEpub } from "@/server/services/epubExportService";
import { buildManuscriptPdf } from "@/server/services/pdfExportService";
import { createRecord } from "@/server/services/recordService";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";

function isPdf(bytes: Buffer) {
  return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
}

function isZip(bytes: Buffer) {
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

describe("Manuscript DOCX and EPUB export", () => {
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
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("builds PDF, DOCX, and EPUB from the same model options", async () => {
    const when = new Date(2026, 0, 2);
    const opts = { sceneTitles: true, hasDrafts: false, draftId: null };
    const [pdf, docx, epub] = await Promise.all([
      buildManuscriptPdf(t.db, IDS.project, opts, when),
      buildManuscriptDocx(t.db, IDS.project, opts, when),
      buildManuscriptEpub(t.db, IDS.project, opts, when),
    ]);
    expect(isPdf(pdf.bytes)).toBe(true);
    expect(isZip(docx.bytes)).toBe(true);
    expect(isZip(epub.bytes)).toBe(true);
    expect(docx.filename.endsWith(".docx")).toBe(true);
    expect(epub.filename.endsWith(".epub")).toBe(true);
    expect(pdf.documentCount).toBe(docx.documentCount);
    expect(pdf.documentCount).toBe(epub.documentCount);

    const docxZip = await JSZip.loadAsync(docx.bytes);
    expect(docxZip.file("[Content_Types].xml")).toBeTruthy();

    const epubZip = await JSZip.loadAsync(epub.bytes);
    expect((await epubZip.file("mimetype")?.async("string")) ?? "").toBe("application/epub+zip");
    expect(epubZip.file("OEBPS/content.opf")).toBeTruthy();
  });
});