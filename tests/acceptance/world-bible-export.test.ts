import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildReferencesDocx, buildReferencesEpub, buildReferencesMarkdownBundle } from "@/server/services/worldBibleExport";
import { buildReferencesPdf } from "@/server/services/pdfExportService";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";

describe("world bible export", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("exports the same reference as PDF, DOCX, EPUB, and a Markdown zip", async () => {
    const ids = [IDS.world];
    const [pdf, docx, epub, markdown] = await Promise.all([
      buildReferencesPdf(t.db, IDS.project, ids),
      buildReferencesDocx(t.db, IDS.project, ids),
      buildReferencesEpub(t.db, IDS.project, ids),
      buildReferencesMarkdownBundle(t.db, IDS.project, ids),
    ]);
    expect(pdf.bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(pdf.documentCount).toBe(1);
    const docxZip = await JSZip.loadAsync(docx.bytes);
    expect(await docxZip.file("word/document.xml")?.async("string")).toContain("The Salt Guild");
    const epubZip = await JSZip.loadAsync(epub.bytes);
    expect(epubZip.file("mimetype")).toBeTruthy();
    expect(await epubZip.file("OEBPS/doc-1.xhtml")?.async("string")).toContain("The Salt Guild");
    const markdownZip = await JSZip.loadAsync(markdown.bytes);
    const names = Object.keys(markdownZip.files);
    expect(names.some((name) => name.endsWith(".md") && name !== "README.md")).toBe(true);
    const body = await markdownZip.file(names.find((name) => name.endsWith(".md") && name !== "README.md")!)!.async("string");
    expect(body).toContain("The Salt Guild");
  });
});