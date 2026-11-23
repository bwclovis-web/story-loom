import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  emptyCharacterDevelopment,
  withCharacterDevelopment,
} from "@/domain/characterDevelopment";
import {
  emptyWorldProfile,
  withWorldProfile,
  type WorldFieldHistoryChange,
} from "@/domain/worldProfile";
import { createProject, createWorkspace } from "@/server/services/projectService";
import { createRecord } from "@/server/services/recordService";
import { createStoryEvent, linkStoryEventScene } from "@/server/services/storyEventService";
import {
  buildReferencesDocx,
  buildReferencesEpub,
  buildReferencesMarkdownBundle,
  buildReferencesWikiZip,
} from "@/server/services/worldBibleExport";
import { worldBibleDocxBookmarkId } from "@/server/services/worldBibleModel";
import { buildReferencesPdf } from "@/server/services/pdfExportService";
import { withRecordTaxonomy } from "@/world/taxonomy";
import { createTestDb, type TestDb } from "../helpers";
import { extractPdfText } from "../helpers/pdfText";

const CHAR_PHRASE = "CHAR_SLICE_W8C_DISTINCTIVE_SALT_QUAY";
const SERIES = "Saltmarsh Annals";
const WSP = "wsp_w8c";
const BOOK1 = "prj_w8c_book1";
const BOOK2 = "prj_w8c_book2";
const STATION = "rec_w8c_station";
const STATION_DUP = "rec_w8c_station_dup";
const WATERWAY = "rec_w8c_waterway";
const EXCLUDED = "rec_w8c_excluded";
const DOSSIER = "rec_w8c_mara";
const CUSTOM_CAT = "custom-harbors-w8c";

function historyChange(
  partial: Partial<WorldFieldHistoryChange> & Pick<WorldFieldHistoryChange, "id" | "fieldPath" | "value">,
): WorldFieldHistoryChange {
  return {
    definitionId: "category:locations",
    storage: "profile",
    presence: "set",
    approval: "approved",
    planned: false,
    provenance: { origin: "author", note: "" },
    bookProjectId: BOOK1,
    storyEventId: null,
    chapterRecordId: null,
    sceneRecordId: null,
    sequence: null,
    worldScope: "series",
    note: "",
    supersedesId: null,
    correctionNote: "",
    correctedAt: null,
    ...partial,
  };
}

function hrefsIn(html: string): string[] {
  return [...html.matchAll(/\bhref="([^"]+)"/g)].map((m) => m[1]!);
}

describe("W8C world bible format links, labels, and character slices", () => {
  let t: TestDb;
  let sceneFlash: string;
  let allIds: string[];

  beforeEach(async () => {
    t = await createTestDb();
    await createWorkspace(t.db, { id: WSP, name: "W8C workspace" });
    await createProject(t.db, { id: BOOK1, workspaceId: WSP, title: "Book One" });
    await createProject(t.db, { id: BOOK2, workspaceId: WSP, title: "Book Two" });
    await t.db.project.update({ where: { id: BOOK1 }, data: { seriesName: SERIES, bookName: "Book One" } });
    await t.db.project.update({ where: { id: BOOK2 }, data: { seriesName: SERIES, bookName: "Book Two" } });

    await t.db.worldCategoryDefinition.create({
      data: {
        id: "wcat_w8c_harbors",
        projectId: BOOK1,
        slug: CUSTOM_CAT,
        label: "Harbors (Book One label)",
        description: "",
        parentCategorySlug: "locations",
        worldScope: "series",
        updatedAt: new Date(),
      },
    });

    const open = await createStoryEvent(t.db, BOOK2, { title: "Station opens" });
    const close = await createStoryEvent(t.db, BOOK2, { title: "Station closes" });
    const flash = await createStoryEvent(t.db, BOOK2, { title: "Flashback open" });
    await t.db.storyEventOrder.createMany({
      data: [
        { id: `evo_${open.id}_${flash.id}`, projectId: BOOK2, earlierEventId: open.id, laterEventId: flash.id },
        { id: `evo_${flash.id}_${close.id}`, projectId: BOOK2, earlierEventId: flash.id, laterEventId: close.id },
      ],
    });

    await createRecord(t.db, BOOK1, {
      recordId: STATION,
      type: "worldbuilding",
      title: "Saltmarsh Station",
      body: "Quiet docks. See also [[Saltmarsh Reach]]. Mentions [[Hidden Quay Ledger]] without exporting it.",
      authorityStatus: "approved",
      worldScope: "series",
      fields: withWorldProfile(
        withRecordTaxonomy(
          { kind: "place" },
          {
            version: 1,
            primary: { category: "locations", subcategory: "buildings" },
            secondary: [{ category: "technology", subcategory: "transportation" }],
          },
        ),
        {
          ...emptyWorldProfile(),
          definitionId: "category:locations",
          values: { access: "closed", outlet: { recordId: WATERWAY } },
          fieldMeta: {
            "values.access": { approval: "approved", provenance: { origin: "author", note: "" } },
          },
          fieldHistory: [
            historyChange({
              id: "wfh_open",
              fieldPath: "values.access",
              value: "open",
              bookProjectId: BOOK1,
              storyEventId: open.id,
            }),
            historyChange({
              id: "wfh_close",
              fieldPath: "values.access",
              value: "closed",
              bookProjectId: BOOK2,
              storyEventId: close.id,
            }),
          ],
        },
      ),
    });

    await createRecord(t.db, BOOK1, {
      recordId: STATION_DUP,
      type: "worldbuilding",
      title: "Saltmarsh Station",
      body: "A different station with the same title.",
      authorityStatus: "approved",
      worldScope: "series",
      fields: withWorldProfile(
        withRecordTaxonomy({ kind: "place" }, { version: 1, primary: { category: "locations", subcategory: "buildings" } }),
        { ...emptyWorldProfile(), definitionId: "category:locations", summary: "Duplicate title" },
      ),
    });

    await createRecord(t.db, BOOK1, {
      recordId: WATERWAY,
      type: "worldbuilding",
      title: "Saltmarsh Reach",
      body: "A tidal reach.",
      authorityStatus: "approved",
      worldScope: "series",
      fields: withWorldProfile(
        withRecordTaxonomy(
          { kind: "place" },
          { version: 1, primary: { category: "geography", subcategory: "waterways" } },
        ),
        {
          ...emptyWorldProfile(),
          definitionId: "category:geography",
          enabledSections: ["geography:waterways"],
          values: { length: { amount: 90, unit: "miles", qualifier: "about" } },
        },
      ),
    });

    await createRecord(t.db, BOOK1, {
      recordId: EXCLUDED,
      type: "worldbuilding",
      title: "Hidden Quay Ledger",
      body: "Must not appear when deselected.",
      authorityStatus: "approved",
      worldScope: "book",
      fields: withWorldProfile(
        withRecordTaxonomy({ kind: "place" }, { version: 1, primary: { category: CUSTOM_CAT } }),
        { ...emptyWorldProfile(), definitionId: "category:locations" },
      ),
    });

    const emptyChar = emptyCharacterDevelopment();
    await createRecord(t.db, BOOK1, {
      recordId: DOSSIER,
      type: "character_dossier",
      title: "Mara Venn",
      body: "Archivist body text.",
      authorityStatus: "approved",
      worldScope: "series",
      fields: withCharacterDevelopment(
        {},
        {
          ...emptyChar,
          foundation: {
            ...emptyChar.foundation,
            occupation: `Salt archivist. ${CHAR_PHRASE}`,
            publicRole: "Senior clerk",
          },
          fieldMeta: {
            "foundation.occupation": {
              approval: "approved",
              provenance: { origin: "author", note: "" },
            },
          },
        },
      ),
    });

    await createRecord(t.db, BOOK2, {
      recordId: "rec_w8c_ch",
      type: "manuscript_chapter",
      title: "Chapter",
      body: "Chapter shell.",
      authorityStatus: "draft",
    });
    sceneFlash = "rec_w8c_scene_flash";
    await createRecord(t.db, BOOK2, {
      recordId: sceneFlash,
      type: "manuscript_scene",
      title: "Flashback",
      body: "Years earlier at Saltmarsh Station.",
      authorityStatus: "draft",
      parentRecordId: "rec_w8c_ch",
    });
    const event = await t.db.storyEvent.findFirstOrThrow({ where: { id: flash.id } });
    await linkStoryEventScene(t.db, BOOK2, flash.id, sceneFlash, event.revision);

    allIds = [STATION, STATION_DUP, WATERWAY, DOSSIER];
  }, 30_000);

  afterEach(async () => {
    await t.cleanup();
  });

  it(
    "writes relative wiki links, one character slice, and format metadata across all five exports",
    async () => {
      const policy = {
        mode: "point" as const,
        storyPointRecordId: sceneFlash,
        bookProjectId: BOOK2,
        approvedOnly: true,
      };
      const selection = { recordIds: allIds };

      const [wiki, md, docx, epub, pdf] = await Promise.all([
        buildReferencesWikiZip(t.db, BOOK2, selection, policy),
        buildReferencesMarkdownBundle(t.db, BOOK2, selection, policy),
        buildReferencesDocx(t.db, BOOK2, selection, policy),
        buildReferencesEpub(t.db, BOOK2, selection, policy),
        buildReferencesPdf(t.db, BOOK2, selection, policy),
      ]);

      // --- Wiki ---
      const wikiZip = await JSZip.loadAsync(wiki.bytes);
      const wikiPaths = new Set(Object.keys(wikiZip.files).filter((p) => !wikiZip.files[p]!.dir));
      expect(wikiPaths.has("index.html")).toBe(true);
      const indexHtml = await wikiZip.file("index.html")!.async("string");
      expect(indexHtml).toMatch(/href="pages\/[^"]+\.html"/);
      expect(indexHtml).toMatch(/See also:/);

      const pageFiles = [...wikiPaths].filter((p) => p.startsWith("pages/") && p.endsWith(".html"));
      expect(pageFiles.length, `wiki pages: ${[...wikiPaths].join(", ")}`).toBeGreaterThanOrEqual(3);

      for (const pagePath of pageFiles) {
        const html = await wikiZip.file(pagePath)!.async("string");
        expect(html).not.toMatch(/href="pages\//);
        for (const href of hrefsIn(html)) {
          if (/^(https?:|mailto:)/i.test(href)) continue;
          if (href === "../index.html" || href.startsWith("../assets/")) continue;
          const peer = href.split("#")[0]!;
          if (peer.endsWith(".html") && !peer.includes("/")) {
            expect(wikiPaths.has(`pages/${peer}`), `missing ${peer} from ${pagePath}`).toBe(true);
          }
        }
      }

      // Root index destinations exist
      for (const href of hrefsIn(indexHtml)) {
        if (!href.startsWith("pages/")) continue;
        expect(wikiPaths.has(href.split("#")[0]!)).toBe(true);
      }

      const stationPage = pageFiles.find((p) => p.includes(STATION));
      expect(stationPage).toBeTruthy();
      const stationHtml = await wikiZip.file(stationPage!)!.async("string");
      expect(stationHtml).toMatch(/href="saltmarsh-reach-rec_w8c_waterway\.html"/);
      expect(stationHtml).toContain("Hidden Quay Ledger");
      expect(stationHtml).not.toMatch(/href="[^"]*Hidden Quay Ledger/);
      expect(stationHtml).not.toMatch(/rec_w8c_excluded/);

      // --- Markdown ---
      const mdZip = await JSZip.loadAsync(md.bytes);
      const stationMdName = Object.keys(mdZip.files).find((n) => n.includes(STATION) && n.endsWith(".md"));
      expect(stationMdName).toBeTruthy();
      const stationMd = await mdZip.file(stationMdName!)!.async("string");
      expect(stationMd).toMatch(/^> /m);
      expect(stationMd).toMatch(/Also listed under/);
      expect(stationMd).toMatch(/Technology/);
      expect(stationMd).toMatch(/Transportation/);
      expect(stationMd).not.toMatch(/technology \/ transportation/);

      // --- EPUB ---
      const epubZip = await JSZip.loadAsync(epub.bytes);
      const nav = await epubZip.file("OEBPS/nav.xhtml")!.async("string");
      expect(nav).toMatch(/Point-scoped|approved/i);
      const dossierXhtmlName = Object.keys(epubZip.files).find(
        (n) => n.includes(DOSSIER) && n.endsWith(".xhtml"),
      );
      expect(dossierXhtmlName).toBeTruthy();
      const dossierXhtml = await epubZip.file(dossierXhtmlName!)!.async("string");
      expect(dossierXhtml).toContain(CHAR_PHRASE);
      expect(dossierXhtml.split(CHAR_PHRASE).length - 1).toBe(1);
      expect(dossierXhtml).toMatch(/Approved \(canon\)|Home:/);
      expect(dossierXhtml).toMatch(/scope-note|Point-scoped/i);

      const stationXhtmlName = Object.keys(epubZip.files).find(
        (n) => n.includes(STATION) && n.endsWith(".xhtml") && !n.includes(STATION_DUP),
      );
      const stationXhtml = await epubZip.file(stationXhtmlName!)!.async("string");
      expect(stationXhtml).toMatch(/href="[^"]*saltmarsh-reach[^"]*\.xhtml"/);

      // --- DOCX ---
      const docxZip = await JSZip.loadAsync(docx.bytes);
      const documentXml = await docxZip.file("word/document.xml")!.async("string");
      expect(documentXml).toContain("Locations");
      expect(documentXml).toMatch(/Approved \(canon\)/);
      expect(documentXml).toContain("Home: Book One");
      const bookmark = worldBibleDocxBookmarkId(STATION);
      expect(documentXml).toContain(`w:name="${bookmark}"`);
      expect(documentXml).toMatch(/w:anchor="/);
      expect(documentXml).toMatch(/See also:[\s\S]*Saltmarsh Station/);
      // Same-title See also lines stay distinguishable via page id text
      expect(documentXml).toContain(STATION);
      expect(documentXml).toContain(STATION_DUP);

      // --- PDF ---
      const pdfText = await extractPdfText(pdf.bytes);
      expect(pdfText).toContain(CHAR_PHRASE);
      expect(pdfText.split(CHAR_PHRASE).length - 1).toBe(1);
      expect(pdfText).not.toContain("Must not appear when deselected");
    },
    90_000,
  );
});
