import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  emptyWorldProfile,
  withWorldProfile,
  type WorldFieldHistoryChange,
} from "@/domain/worldProfile";
import { WORLD_MARKDOWN_ARCHIVE_KEY } from "@/domain/worldProfileUpgrade";
import { createProject, createWorkspace } from "@/server/services/projectService";
import { createRecord } from "@/server/services/recordService";
import { createSmartCollection } from "@/server/services/smartCollectionService";
import { createStoryEvent, linkStoryEventScene } from "@/server/services/storyEventService";
import { saveWorldCategory } from "@/server/services/worldCategoryService";
import {
  buildReferencesDocx,
  buildReferencesEpub,
  buildReferencesMarkdownBundle,
  buildReferencesWikiZip,
} from "@/server/services/worldBibleExport";
import { buildReferencesPdf } from "@/server/services/pdfExportService";
import { withRecordTaxonomy } from "@/world/taxonomy";
import { createTestDb, type TestDb } from "../helpers";

const FUTURE = "FUTURE_PHRASE_W7C";
const SERIES = "Saltmarsh Annals";
const WSP = "wsp_w7c";
const BOOK1 = "prj_w7c_book1";
const BOOK2 = "prj_w7c_book2";
const STATION = "rec_w7c_station";
const STATION_DUP = "rec_w7c_station_dup";
const WATERWAY = "rec_w7c_waterway";
const SETTLEMENT = "rec_w7c_settlement";
const UNCAT = "rec_w7c_uncat";
const CUSTOM_CAT = "custom-harbors-w7c";

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

describe("W7C world bible taxonomy + point-scoped exports", () => {
  let t: TestDb;
  let sceneBefore: string;
  let sceneAfter: string;
  let liveCollectionId: string;
  let emptyCollectionId: string;

  beforeEach(async () => {
    t = await createTestDb();
    await createWorkspace(t.db, { id: WSP, name: "W7C workspace" });
    await createProject(t.db, { id: BOOK1, workspaceId: WSP, title: "Book One" });
    await createProject(t.db, { id: BOOK2, workspaceId: WSP, title: "Book Two" });
    await t.db.project.update({ where: { id: BOOK1 }, data: { seriesName: SERIES, bookName: "Book One" } });
    await t.db.project.update({ where: { id: BOOK2 }, data: { seriesName: SERIES, bookName: "Book Two" } });

    await saveWorldCategory(t.db, {
      projectId: BOOK1,
      slug: CUSTOM_CAT,
      label: "Harbors (Book One label)",
      parentCategorySlug: "locations",
    });

    const open = await createStoryEvent(t.db, BOOK1, { title: "Station opens" });
    const close = await createStoryEvent(t.db, BOOK2, { title: "Station closes" });
    await t.db.storyEventOrder.create({
      data: {
        id: `evo_${open.id}_${close.id}`,
        projectId: BOOK2,
        earlierEventId: open.id,
        laterEventId: close.id,
      },
    });

    const stationProfile = {
      ...emptyWorldProfile(),
      definitionId: "category:locations",
      values: { access: "closed" },
      fieldMeta: {
        "values.access": { approval: "approved" as const, provenance: { origin: "author" as const, note: "" } },
      },
      fieldHistory: [
        historyChange({
          id: "wfh_w7c_open",
          fieldPath: "values.access",
          value: "open",
          bookProjectId: BOOK1,
          storyEventId: open.id,
        }),
        historyChange({
          id: "wfh_w7c_close",
          fieldPath: "values.access",
          value: "closed",
          bookProjectId: BOOK2,
          storyEventId: close.id,
        }),
        historyChange({
          id: "wfh_w7c_reopen",
          fieldPath: "values.access",
          value: "reopened",
          bookProjectId: BOOK2,
          storyEventId: close.id,
          planned: true,
          approval: "proposed",
        }),
      ],
    };

    await createRecord(t.db, BOOK1, {
      recordId: STATION,
      type: "worldbuilding",
      title: "Saltmarsh Station",
      body: `## Access [PROPOSED]\n${FUTURE}\n\n## Notes\nQuiet docks near the quay.`,
      authorityStatus: "approved",
      worldScope: "series",
      fields: withWorldProfile(
        withRecordTaxonomy(
          {
            kind: "place",
            [WORLD_MARKDOWN_ARCHIVE_KEY]: {
              version: 1,
              entries: [
                {
                  id: "wma_w7c",
                  body: FUTURE,
                  bodyHash: "hash",
                  sourceRevision: 1,
                  archivedAt: new Date(0).toISOString(),
                  migrationFingerprint: "",
                },
              ],
              appliedFingerprints: [],
            },
          },
          {
            version: 1,
            primary: { category: "locations", subcategory: "buildings" },
            secondary: [{ category: "technology", subcategory: "transportation" }],
          },
        ),
        stationProfile,
      ),
    });

    await createRecord(t.db, BOOK1, {
      recordId: STATION_DUP,
      type: "worldbuilding",
      title: "Saltmarsh Station",
      body: "A different station with the same title.",
      authorityStatus: "approved",
      worldScope: "book",
      fields: withWorldProfile(
        withRecordTaxonomy({ kind: "place" }, { version: 1, primary: { category: "locations", subcategory: "buildings" } }),
        { ...emptyWorldProfile(), definitionId: "category:locations", summary: "Duplicate title fixture" },
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
          values: {
            length: { amount: 90, unit: "miles", qualifier: "about" },
          },
        },
      ),
    });

    await createRecord(t.db, BOOK1, {
      recordId: SETTLEMENT,
      type: "worldbuilding",
      title: "Saltmarsh Town",
      body: "Harbor town.",
      authorityStatus: "approved",
      worldScope: "series",
      fields: withWorldProfile(
        withRecordTaxonomy(
          { kind: "place" },
          { version: 1, primary: { category: "geography", subcategory: "cities_and_settlements" } },
        ),
        {
          ...emptyWorldProfile(),
          definitionId: "category:geography",
          enabledSections: ["geography:cities_and_settlements"],
          values: {
            populationEstimate: { amount: 0, qualifier: "exact" },
          },
          fieldHistory: [
            historyChange({
              id: "wfh_w7c_pop",
              fieldPath: "values.populationEstimate",
              value: { amount: 0, qualifier: "exact" },
              bookProjectId: BOOK1,
              storyEventId: open.id,
              definitionId: "category:geography",
            }),
          ],
        },
      ),
    });

    await createRecord(t.db, BOOK1, {
      recordId: UNCAT,
      type: "worldbuilding",
      title: "Loose scrap",
      body: "No taxonomy.",
      authorityStatus: "approved",
      worldScope: "book",
      fields: { kind: "place" },
    });

    await createRecord(t.db, BOOK1, {
      recordId: "rec_w7c_ch1",
      type: "manuscript_chapter",
      title: "Chapter 1",
      body: "Chapter shell.",
      authorityStatus: "draft",
    });
    await createRecord(t.db, BOOK2, {
      recordId: "rec_w7c_ch5",
      type: "manuscript_chapter",
      title: "Chapter 5",
      body: "Chapter shell.",
      authorityStatus: "draft",
    });

    await createRecord(t.db, BOOK1, {
      recordId: "rec_w7c_scene_open",
      type: "manuscript_scene",
      title: "Opening day",
      body: "Opens.",
      authorityStatus: "draft",
      parentRecordId: "rec_w7c_ch1",
    });
    {
      const event = await t.db.storyEvent.findFirstOrThrow({ where: { id: open.id } });
      await linkStoryEventScene(t.db, BOOK1, open.id, "rec_w7c_scene_open", event.revision);
    }
    sceneBefore = "rec_w7c_scene_open";

    await createRecord(t.db, BOOK2, {
      recordId: "rec_w7c_scene_after",
      type: "manuscript_scene",
      title: "After close",
      body: "Closed.",
      authorityStatus: "draft",
      parentRecordId: "rec_w7c_ch5",
    });
    {
      const event = await t.db.storyEvent.findFirstOrThrow({ where: { id: close.id } });
      await linkStoryEventScene(t.db, BOOK2, close.id, "rec_w7c_scene_after", event.revision);
    }
    sceneAfter = "rec_w7c_scene_after";

    const live = await createSmartCollection(t.db, BOOK1, {
      title: "Stations live",
      scope: "world",
      filter: { category: "locations", subcategory: "buildings" },
    });
    liveCollectionId = live.id;
    const empty = await createSmartCollection(t.db, BOOK1, {
      title: "Impossible filter",
      scope: "world",
      filter: { category: "locations", tag: "no-such-tag-w7c" },
    });
    emptyCollectionId = empty.id;
  });

  afterEach(async () => {
    await t.cleanup();
  });

  async function assertNoFuture(blob: string | Buffer | Uint8Array, label: string) {
    const text = typeof blob === "string" ? blob : Buffer.from(blob).toString("utf8");
    expect(text.includes(FUTURE), `${label} must not contain ${FUTURE}`).toBe(false);
  }

  it("groups by taxonomy with See links and distinct same-title page ids", async () => {
    const ids = [STATION, STATION_DUP, WATERWAY, SETTLEMENT, UNCAT];
    const [wiki, markdown, epub, docx, pdf] = await Promise.all([
      buildReferencesWikiZip(t.db, BOOK1, ids),
      buildReferencesMarkdownBundle(t.db, BOOK1, ids),
      buildReferencesEpub(t.db, BOOK1, ids),
      buildReferencesDocx(t.db, BOOK1, ids),
      buildReferencesPdf(t.db, BOOK1, ids),
    ]);

    const wikiZip = await JSZip.loadAsync(wiki.bytes);
    const index = await wikiZip.file("index.html")!.async("string");
    expect(index).toMatch(/Locations/i);
    expect(index).toMatch(/See also/i);
    expect(index).toContain(`${STATION}`);
    expect(index).toContain(`${STATION_DUP}`);
    expect(wikiZip.file(`pages/saltmarsh-station-${STATION}.html`)).toBeTruthy();
    expect(wikiZip.file(`pages/saltmarsh-station-${STATION_DUP}.html`)).toBeTruthy();

    const mdZip = await JSZip.loadAsync(markdown.bytes);
    const readme = await mdZip.file("README.md")!.async("string");
    expect(readme).toMatch(/See also/i);
    expect(readme).toContain(`saltmarsh-station-${STATION}.md`);
    expect(readme).toContain(`saltmarsh-station-${STATION_DUP}.md`);
    const stationMd = await mdZip.file(`saltmarsh-station-${STATION}.md`)!.async("string");
    expect(stationMd).toMatch(/Profile/i);

    const epubZip = await JSZip.loadAsync(epub.bytes);
    const nav = await epubZip.file("OEBPS/nav.xhtml")!.async("string");
    expect(nav).toContain(`${STATION}.xhtml`);
    expect(nav).toContain(`${STATION_DUP}.xhtml`);
    expect(nav).toMatch(/See also/i);

    const docxZip = await JSZip.loadAsync(docx.bytes);
    const documentXml = await docxZip.file("word/document.xml")!.async("string");
    expect(documentXml).toContain("Saltmarsh Station");
    expect(documentXml).toContain(`wb_${STATION.replace(/[^A-Za-z0-9]/g, "_")}`);
    expect(documentXml).toContain(`saltmarsh-station-${STATION}`);

    expect(pdf.bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(pdf.documentCount).toBe(5);

    const waterMd = await mdZip.file(`saltmarsh-reach-${WATERWAY}.md`)!.async("string");
    expect(waterMd).toMatch(/about 90 miles/i);
    const townMd = await mdZip.file(`saltmarsh-town-${SETTLEMENT}.md`)!.async("string");
    expect(townMd).toMatch(/0/);
  });

  it("point-scoped exports omit FUTURE_PHRASE_W7C across all five formats", async () => {
    const selection = { recordIds: [STATION, WATERWAY, SETTLEMENT] };
    const policy = {
      mode: "point" as const,
      storyPointRecordId: sceneBefore,
      bookProjectId: BOOK1,
      approvedOnly: true,
    };
    const [wiki, markdown, epub, docx, pdf] = await Promise.all([
      buildReferencesWikiZip(t.db, BOOK1, selection, policy),
      buildReferencesMarkdownBundle(t.db, BOOK1, selection, policy),
      buildReferencesEpub(t.db, BOOK1, selection, policy),
      buildReferencesDocx(t.db, BOOK1, selection, policy),
      buildReferencesPdf(t.db, BOOK1, selection, policy),
    ]);

    const wikiZip = await JSZip.loadAsync(wiki.bytes);
    for (const name of Object.keys(wikiZip.files)) {
      const file = wikiZip.file(name);
      if (!file || file.dir) continue;
      await assertNoFuture(await file.async("nodebuffer"), `wiki:${name}`);
    }
    const wikiPage = await wikiZip.file(`pages/saltmarsh-station-${STATION}.html`)!.async("string");
    expect(wikiPage).toMatch(/open/i);
    expect(wikiPage).not.toMatch(/reopened/i);

    const mdZip = await JSZip.loadAsync(markdown.bytes);
    for (const name of Object.keys(mdZip.files)) {
      const file = mdZip.file(name);
      if (!file || file.dir) continue;
      await assertNoFuture(await file.async("string"), `md:${name}`);
    }
    const stationMd = await mdZip.file(`saltmarsh-station-${STATION}.md`)!.async("string");
    expect(stationMd).toMatch(/access/i);
    expect(stationMd).not.toMatch(/\[PROPOSED\]/);

    const epubZip = await JSZip.loadAsync(epub.bytes);
    for (const name of Object.keys(epubZip.files)) {
      if (!name.endsWith(".xhtml") && name !== "OEBPS/content.opf") continue;
      const file = epubZip.file(name);
      if (!file) continue;
      await assertNoFuture(await file.async("string"), `epub:${name}`);
    }

    const docxZip = await JSZip.loadAsync(docx.bytes);
    await assertNoFuture(await docxZip.file("word/document.xml")!.async("string"), "docx");

    await assertNoFuture(pdf.bytes, "pdf");
    // Later Book Two point should show closed, still without FUTURE phrase.
    const later = await buildReferencesMarkdownBundle(t.db, BOOK2, selection, {
      mode: "point",
      storyPointRecordId: sceneAfter,
      bookProjectId: BOOK2,
      approvedOnly: true,
    });
    const laterZip = await JSZip.loadAsync(later.bytes);
    const laterMd = await laterZip.file(`saltmarsh-station-${STATION}.md`)!.async("string");
    expect(laterMd).toMatch(/closed/i);
    await assertNoFuture(laterMd, "later-md");
  });

  it("exports a live World Hub collection and rejects a 0-match collection", async () => {
    const file = await buildReferencesMarkdownBundle(t.db, BOOK1, { collectionId: liveCollectionId });
    expect(file.documentCount).toBeGreaterThanOrEqual(2);
    const zip = await JSZip.loadAsync(file.bytes);
    expect(zip.file(`saltmarsh-station-${STATION}.md`)).toBeTruthy();

    await expect(
      buildReferencesMarkdownBundle(t.db, BOOK1, { collectionId: emptyCollectionId }),
    ).rejects.toThrow(/No reference documents match/i);
  });
});
