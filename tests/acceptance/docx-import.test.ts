import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyChapterImport, previewChapterImport } from "@/server/services/chapterImportService";
import { docxBuffersToChapterFiles } from "@/server/services/docxChapterImport";
import { parseDocx, splitDocxIntoChapters } from "@/server/services/docxParse";
import { applyDocxReview, previewDocxReview } from "@/server/services/docxReviewService";
import { setRecordProtection } from "@/server/services/mutationService";
import { getRecord } from "@/server/services/recordService";
import { createTestDb, IDS, seedProject, snapshotState, type TestDb } from "../helpers";

async function buildDocx(paragraphs: string[]): Promise<Buffer> {
  const body = paragraphs.join("");
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}<w:sectPr/></w:body>
</w:document>`;
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.folder("_rels")!.file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.folder("word")!.file("document.xml", documentXml);
  return zip.generateAsync({ type: "nodebuffer" });
}

function p(text: string, style?: string, bookmark?: string): string {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  const bm = bookmark
    ? `<w:bookmarkStart w:id="1" w:name="${bookmark}"/><w:bookmarkEnd w:id="1"/>`
    : "";
  return `<w:p>${pPr}${bm}<w:r><w:t>${text}</w:t></w:r></w:p>`;
}

describe("DOCX chapter import and editor review", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(() => t.cleanup());

  it("splits Heading 1 chapters and keeps Heading 2 as scene breaks without writing on preview", async () => {
    const bytes = await buildDocx([
      p("Harbour Dawn", "Heading1"),
      p("The quay was quiet."),
      p("***"),
      p("Later", "Heading2"),
      p("Gulls circled."),
      p("Rope Walk", "Heading1"),
      p("She counted the knots."),
    ]);
    const parsed = await parseDocx(bytes);
    const slices = splitDocxIntoChapters(parsed, "Novel");
    expect(slices.map((s) => s.title)).toEqual(["Harbour Dawn", "Rope Walk"]);
    expect(slices[0]!.body).toContain("***");
    expect(slices[0]!.body).toContain("## Later");

    const before = await snapshotState(t.db);
    const files = await docxBuffersToChapterFiles([{ filename: "Harbour.docx", bytes }]);
    const preview = await previewChapterImport(t.db, IDS.project, files);
    expect(preview).toHaveLength(2);
    expect(preview.every((x) => x.matches.length === 0)).toBe(true);
    expect(await snapshotState(t.db)).toEqual(before);

    const outcome = await applyChapterImport(t.db, {
      projectId: IDS.project,
      items: files.map((f, i) => ({ ...f, title: preview[i]!.suggestedTitle, decision: { action: "create" } })),
      sourceKind: "docx_import",
    });
    expect(outcome.status).toBe("applied");
    if (outcome.status !== "applied") return;
    const first = await getRecord(t.db, IDS.project, outcome.results[0]!.recordId!);
    expect(first.protected).toBe(true);
    expect(first.body).toContain("The quay was quiet.");
    expect(first.body).toContain("## Later");
  });

  it("previews editor DOCX review with protection gate and applies after confirmation", async () => {
    await setRecordProtection(t.db, {
      projectId: IDS.project,
      recordId: IDS.chapter,
      protected: true,
      actor: "author",
    });
    const chapter = await getRecord(t.db, IDS.project, IDS.chapter);
    const bookmark = `sl_record_${IDS.chapter.replace(/[^A-Za-z0-9]/g, "_")}`;
    const bytes = await buildDocx([
      p(chapter.title, "Heading1", bookmark),
      p("Editor revised the opening line."),
      `<w:p><w:r><w:t>Tracked </w:t></w:r><w:ins w:author="Ed"><w:r><w:t>insert</w:t></w:r></w:ins><w:r><w:t> here.</w:t></w:r></w:p>`,
    ]);

    const before = await snapshotState(t.db);
    const preview = await previewDocxReview(t.db, IDS.project, { filename: "edits.docx", bytes });
    expect(preview.chapters[0]?.matchReason).toBe("anchor");
    expect(preview.chapters[0]?.hasBodyChange).toBe(true);
    expect(preview.requiresProtectedConfirmation).toBe(true);
    expect(preview.hasTrackedChanges).toBe(true);
    expect(await snapshotState(t.db)).toEqual(before);

    const blocked = await applyDocxReview(t.db, {
      projectId: IDS.project,
      filename: "edits.docx",
      bytes,
      acceptIndexes: [0],
      confirmProtected: false,
    });
    expect(blocked.status).toBe("rejected");
    expect(blocked.status === "rejected" && blocked.issues.some((i) => i.code === "PROTECTED_CONFIRMATION_REQUIRED")).toBe(true);

    const applied = await applyDocxReview(t.db, {
      projectId: IDS.project,
      filename: "edits.docx",
      bytes,
      acceptIndexes: [0],
      confirmProtected: true,
    });
    expect(applied.status).toBe("applied");
    const after = await getRecord(t.db, IDS.project, IDS.chapter);
    expect(after.body).toContain("Editor revised the opening line.");
    expect(after.currentRevision).toBeGreaterThan(chapter.currentRevision);
  });
});
