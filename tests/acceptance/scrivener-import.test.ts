import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyChapterImport, previewChapterImport } from "@/server/services/chapterImportService";
import { parseScrivenerPackage } from "@/server/services/scrivenerImportService";
import { getRecord } from "@/server/services/recordService";
import { createTestDb, IDS, seedProject, snapshotState, type TestDb } from "../helpers";

async function buildScrivZip(): Promise<Buffer> {
  const chapterId = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE";
  const sceneId = "FFFFFFFF-0000-1111-2222-333333333333";
  const researchId = "99999999-8888-7777-6666-555555555555";
  const pdfId = "PDFPDFPDF-PDFP-PDFP-PDFP-PDFPDFPDFPDF";
  const scrivx = `<?xml version="1.0" encoding="UTF-8"?>
<ScrivenerProject>
  <ProjectTitle>Salt Harbour</ProjectTitle>
  <Binder>
    <BinderItem UUID="DRAFTROOT" Type="DraftFolder">
      <Title>Draft</Title>
      <Children>
        <BinderItem UUID="${chapterId}" Type="Folder">
          <Title>Harbour Dawn</Title>
          <Children>
            <BinderItem UUID="${sceneId}" Type="Text">
              <Title>On the quay</Title>
            </BinderItem>
          </Children>
        </BinderItem>
      </Children>
    </BinderItem>
    <BinderItem UUID="RESEARCHROOT" Type="ResearchFolder">
      <Title>Research</Title>
      <Children>
        <BinderItem UUID="${researchId}" Type="Text">
          <Title>Tide tables</Title>
        </BinderItem>
        <BinderItem UUID="${pdfId}" Type="PDF">
          <Title>Old chart.pdf</Title>
        </BinderItem>
      </Children>
    </BinderItem>
  </Binder>
</ScrivenerProject>`;

  const zip = new JSZip();
  zip.file("Salt Harbour.scriv/Salt_Harbour.scrivx", scrivx);
  zip.file(`Salt Harbour.scriv/Files/Docs/${chapterId}.txt`, "The harbour slept under fog.\n");
  zip.file(`Salt Harbour.scriv/Files/Docs/${sceneId}.txt`, "She stepped onto the wet stones.\n");
  zip.file(`Salt Harbour.scriv/Files/Docs/${researchId}.txt`, "High tide at 04:12.\n");
  zip.file("Salt Harbour.scriv/Files/Docs/Snapshots/ignored.txt", "old snapshot\n");
  zip.file("Salt Harbour.scriv/Research/Old chart.pdf", "%PDF-fake");
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("Scrivener import", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(() => t.cleanup());

  it("parses Draft chapters with nested scene breaks and reports unsupported items without writing", async () => {
    const bytes = await buildScrivZip();
    const before = await snapshotState(t.db);
    const parsed = await parseScrivenerPackage(bytes);
    expect(parsed.projectTitle).toBe("Salt Harbour");
    expect(parsed.chapters).toHaveLength(1);
    expect(parsed.chapters[0]!.content).toContain("# Harbour Dawn");
    expect(parsed.chapters[0]!.content).toContain("***");
    expect(parsed.chapters[0]!.content).toContain("## On the quay");
    expect(parsed.chapters[0]!.content).toContain("She stepped onto the wet stones.");
    expect(parsed.references).toHaveLength(1);
    expect(parsed.references[0]!.content).toContain("Tide tables");
    expect(parsed.unsupported.some((u) => /PDF/i.test(u.reason) || /\.pdf/i.test(u.title))).toBe(true);
    expect(parsed.unsupported.some((u) => /snapshot/i.test(u.reason))).toBe(true);
    expect(await snapshotState(t.db)).toEqual(before);

    const preview = await previewChapterImport(t.db, IDS.project, parsed.chapters);
    expect(preview[0]?.suggestedTitle).toMatch(/Harbour Dawn/i);

    const scenesBefore = await t.db.record.count({ where: { projectId: IDS.project, type: "manuscript_scene" } });
    const outcome = await applyChapterImport(t.db, {
      projectId: IDS.project,
      items: [{ ...parsed.chapters[0]!, title: "Harbour Dawn", decision: { action: "create" } }],
      sourceKind: "scrivener_import",
    });
    expect(outcome.status).toBe("applied");
    if (outcome.status !== "applied") return;
    const chapter = await getRecord(t.db, IDS.project, outcome.results[0]!.recordId!);
    expect(chapter.type).toBe("manuscript_chapter");
    expect(chapter.protected).toBe(true);
    expect(chapter.body).toContain("## On the quay");
    // Imports still do not create scene records.
    expect(await t.db.record.count({ where: { projectId: IDS.project, type: "manuscript_scene" } })).toBe(scenesBefore);
  });
});
