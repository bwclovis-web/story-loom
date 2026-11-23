import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  emptyWorldProfile,
  withWorldProfile,
  type WorldFieldHistoryChange,
} from "@/domain/worldProfile";
import { WORLD_MARKDOWN_ARCHIVE_KEY } from "@/domain/worldProfileUpgrade";
import { imageMarkdown } from "@/images/imageFormat";
import { createProject, createWorkspace } from "@/server/services/projectService";
import {
  acceptEstablishedFact,
  addFactEvidence,
  listEstablishedFactsForSubject,
  proposeExtractedFacts,
} from "@/server/services/establishedFactService";
import { addRecordImages } from "@/server/services/imageService";
import { createRecord, updateRecord } from "@/server/services/recordService";
import { createSmartCollection } from "@/server/services/smartCollectionService";
import { createStoryEvent, linkStoryEventScene } from "@/server/services/storyEventService";
import { saveWorldCategory } from "@/server/services/worldCategoryService";
import {
  buildReferencesDocx,
  buildReferencesEpub,
  buildReferencesMarkdownBundle,
  buildReferencesWikiZip,
} from "@/server/services/worldBibleExport";
import {
  buildWorldBibleExportModel,
  type WorldBiblePolicy,
  type WorldBibleSelection,
} from "@/server/services/worldBibleModel";
import { parseWorldBibleExportQuery } from "@/server/services/worldBibleExportQuery";
import { buildReferencesPdf } from "@/server/services/pdfExportService";
import { withRecordTaxonomy } from "@/world/taxonomy";
import { createTestDb, type TestDb } from "../helpers";
import { extractPdfText } from "../helpers/pdfText";
import { makePng } from "../imageFixtures";

const FUTURE = "FUTURE_PHRASE_W8A";
const ELIGIBLE = "ELIGIBLE_FACT_W8A";
const LATER = "LATER_FACT_W8A";
const SERIES = "Saltmarsh Annals";
const WSP = "wsp_w8a";
const BOOK1 = "prj_w8a_book1";
const BOOK2 = "prj_w8a_book2";
const STATION = "rec_w8a_station";
const STATION_DUP = "rec_w8a_station_dup";
const HARBOR = "rec_w8a_harbor";
const CUSTOM_CAT = "custom-harbors-w8a";
const IMG_BODY = "station-open.png";
const IMG_GALLERY = "station-closed-future.png";

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

describe("W8A world bible selection, facts, anchors, and images", () => {
  let t: TestDb;
  let sceneBefore: string;
  let liveCollectionId: string;

  beforeEach(async () => {
    t = await createTestDb();
    await createWorkspace(t.db, { id: WSP, name: "W8A workspace" });
    await createProject(t.db, { id: BOOK1, workspaceId: WSP, title: "Book One" });
    await createProject(t.db, { id: BOOK2, workspaceId: WSP, title: "Book Two" });
    await t.db.project.update({ where: { id: BOOK1 }, data: { seriesName: SERIES, bookName: "Book One" } });
    await t.db.project.update({ where: { id: BOOK2 }, data: { seriesName: SERIES, bookName: "Book Two" } });

    await saveWorldCategory(t.db, {
      projectId: BOOK1,
      slug: CUSTOM_CAT,
      label: "Harbors (Book One label)",
      parentCategorySlug: "locations",
      worldScope: "series",
    });
    await saveWorldCategory(t.db, {
      projectId: BOOK2,
      slug: CUSTOM_CAT,
      label: "Harbors (Book Two label)",
      parentCategorySlug: "locations",
      worldScope: "series",
    });

    const open = await createStoryEvent(t.db, BOOK1, { title: "Station opens" });
    const closeHome = await createStoryEvent(t.db, BOOK1, { title: "Station closes" });
    const close = await createStoryEvent(t.db, BOOK2, { title: "Station closes" });
    await t.db.storyEventOrder.create({
      data: {
        id: `evo_${open.id}_${closeHome.id}`,
        projectId: BOOK1,
        earlierEventId: open.id,
        laterEventId: closeHome.id,
      },
    });
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
          id: "wfh_w8a_open",
          fieldPath: "values.access",
          value: "open",
          bookProjectId: BOOK1,
          storyEventId: open.id,
        }),
        historyChange({
          id: "wfh_w8a_close",
          fieldPath: "values.access",
          value: "closed",
          bookProjectId: BOOK2,
          storyEventId: closeHome.id,
        }),
      ],
    };

    await createRecord(t.db, BOOK1, {
      recordId: STATION,
      type: "worldbuilding",
      title: "Saltmarsh Station",
      body: `## Notes\nQuiet docks.\n\n${imageMarkdown(IMG_BODY, "Opening day map")}`,
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
                  id: "wma_w8a",
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
            secondary: [{ category: CUSTOM_CAT }],
          },
        ),
        stationProfile,
      ),
    });

    const [bodyImage, galleryImage] = await addRecordImages(
      t.db,
      BOOK1,
      STATION,
      [
        { filename: IMG_BODY, bytes: makePng(12, 10, [40, 90, 160]) },
        { filename: IMG_GALLERY, bytes: makePng(12, 10, [160, 40, 40]) },
      ],
      { confirmProtected: false },
    );
    expect(bodyImage.name).toBe(IMG_BODY);
    await t.db.recordImage.update({
      where: { id: galleryImage.id },
      data: { caption: FUTURE, originalFilename: `future-${IMG_GALLERY}` },
    });

    await createRecord(t.db, BOOK1, {
      recordId: STATION_DUP,
      type: "worldbuilding",
      title: "Saltmarsh Station",
      body: "Book-local twin.",
      authorityStatus: "approved",
      worldScope: "book",
      fields: withWorldProfile(
        withRecordTaxonomy({ kind: "place" }, { version: 1, primary: { category: "locations", subcategory: "buildings" } }),
        { ...emptyWorldProfile(), definitionId: "category:locations", summary: "Duplicate" },
      ),
    });

    await createRecord(t.db, BOOK1, {
      recordId: HARBOR,
      type: "worldbuilding",
      title: "Outer Harbor",
      body: "Custom category fixture.",
      authorityStatus: "approved",
      worldScope: "series",
      fields: withWorldProfile(
        withRecordTaxonomy({ kind: "place" }, { version: 1, primary: { category: CUSTOM_CAT } }),
        { ...emptyWorldProfile(), definitionId: "category:locations" },
      ),
    });

    await createRecord(t.db, BOOK1, {
      recordId: "rec_w8a_ch1",
      type: "manuscript_chapter",
      title: "Chapter 1",
      body: `The quay stayed ${ELIGIBLE.toLowerCase()} that morning.`,
      authorityStatus: "draft",
    });
    await createRecord(t.db, BOOK2, {
      recordId: "rec_w8a_ch5",
      type: "manuscript_chapter",
      title: "Chapter 5",
      body: `Later the ledgers said ${LATER.toLowerCase()}.`,
      authorityStatus: "draft",
    });

    await createRecord(t.db, BOOK1, {
      recordId: "rec_w8a_scene_open",
      type: "manuscript_scene",
      title: "Opening day",
      body: `Witness: ${ELIGIBLE}`,
      authorityStatus: "draft",
      parentRecordId: "rec_w8a_ch1",
    });
    {
      const event = await t.db.storyEvent.findFirstOrThrow({ where: { id: open.id } });
      await linkStoryEventScene(t.db, BOOK1, open.id, "rec_w8a_scene_open", event.revision);
    }
    sceneBefore = "rec_w8a_scene_open";

    await createRecord(t.db, BOOK2, {
      recordId: "rec_w8a_scene_after",
      type: "manuscript_scene",
      title: "After close",
      body: `Witness: ${LATER}`,
      authorityStatus: "draft",
      parentRecordId: "rec_w8a_ch5",
    });
    {
      const event = await t.db.storyEvent.findFirstOrThrow({ where: { id: close.id } });
      await linkStoryEventScene(t.db, BOOK2, close.id, "rec_w8a_scene_after", event.revision);
    }

    const eligibleOffered = await proposeExtractedFacts(t.db, BOOK1, {
      subjectRecordId: STATION,
      evidenceKind: "zero_draft",
      statements: [ELIGIBLE],
    });
    const eligibleFact = eligibleOffered.find((f) => f.statement === ELIGIBLE)!;
    await acceptEstablishedFact(t.db, BOOK1, eligibleFact.id);
    await addFactEvidence(t.db, BOOK1, eligibleFact.id, {
      sourceRecordId: sceneBefore,
      passageStart: 0,
      passageEnd: 12,
    });

    // Later evidence must live on the fact's home book, linked to a later home-book event.
    await createRecord(t.db, BOOK1, {
      recordId: "rec_w8a_scene_close_home",
      type: "manuscript_scene",
      title: "Close recorded in Book One notes",
      body: `Witness: ${LATER}`,
      authorityStatus: "draft",
      parentRecordId: "rec_w8a_ch1",
    });
    {
      const event = await t.db.storyEvent.findFirstOrThrow({ where: { id: closeHome.id } });
      await linkStoryEventScene(t.db, BOOK1, closeHome.id, "rec_w8a_scene_close_home", event.revision);
    }

    const laterOffered = await proposeExtractedFacts(t.db, BOOK1, {
      subjectRecordId: STATION,
      evidenceKind: "zero_draft",
      statements: [LATER],
    });
    const laterFact = laterOffered.find((f) => f.statement === LATER)!;
    await acceptEstablishedFact(t.db, BOOK1, laterFact.id);
    await addFactEvidence(t.db, BOOK1, laterFact.id, {
      sourceRecordId: "rec_w8a_scene_close_home",
      passageStart: 0,
      passageEnd: 12,
    });

    const seededFacts = await listEstablishedFactsForSubject(t.db, BOOK1, STATION, { includeDismissed: true });
    expect(seededFacts.filter((f) => f.status === "accepted").map((f) => f.statement).sort()).toEqual(
      [ELIGIBLE, LATER].sort(),
    );

    const live = await createSmartCollection(t.db, BOOK2, {
      title: "Stations live",
      scope: "world",
      filter: { category: "locations", subcategory: "buildings" },
    });
    liveCollectionId = live.id;

    // Keep body image name stable after addRecordImages may rename.
    const station = await t.db.record.findFirstOrThrow({ where: { id: STATION } });
    if (!station.body.includes(`image:${bodyImage.name}`)) {
      await updateRecord(t.db, BOOK1, {
        recordId: STATION,
        expectedRevision: station.currentRevision,
        body: `## Notes\nQuiet docks.\n\n${imageMarkdown(bodyImage.name, "Opening day map")}`,
      });
    }
  });

  afterEach(async () => {
    await t.cleanup();
  });

  async function artifacts(selection: WorldBibleSelection, policy: WorldBiblePolicy) {
    return Promise.all([
      buildReferencesWikiZip(t.db, BOOK2, selection, policy),
      buildReferencesMarkdownBundle(t.db, BOOK2, selection, policy),
      buildReferencesDocx(t.db, BOOK2, selection, policy),
      buildReferencesEpub(t.db, BOOK2, selection, policy),
      buildReferencesPdf(t.db, BOOK2, selection, policy),
    ]);
  }

  it("parses selectionOverride separately from a bare collection", () => {
    const live = parseWorldBibleExportQuery(new URLSearchParams("collection=scol_1"));
    expect(live.selection.selectionOverride).toBeUndefined();
    expect(live.selection.recordIds).toBeUndefined();

    const partial = parseWorldBibleExportQuery(
      new URLSearchParams("collection=scol_1&selectionOverride=1&record=a&record=b"),
    );
    expect(partial.selection.selectionOverride).toBe(true);
    expect(partial.selection.recordIds).toEqual(["a", "b"]);

    const empty = parseWorldBibleExportQuery(new URLSearchParams("collection=scol_1&selectionOverride=1"));
    expect(empty.selection.selectionOverride).toBe(true);
    expect(empty.selection.recordIds).toEqual([]);
  });

  it("intersects collection overrides, rejects explicit empty, and keeps live collection", async () => {
    const live = await buildWorldBibleExportModel(t.db, BOOK2, { collectionId: liveCollectionId });
    expect(live.entries.some((e) => e.record.id === STATION)).toBe(true);

    const partial = await buildWorldBibleExportModel(t.db, BOOK2, {
      collectionId: liveCollectionId,
      selectionOverride: true,
      recordIds: [STATION, "rec_not_in_collection"],
    });
    expect(partial.entries.map((e) => e.record.id)).toEqual([STATION]);

    await expect(
      buildWorldBibleExportModel(t.db, BOOK2, {
        collectionId: liveCollectionId,
        selectionOverride: true,
        recordIds: [],
      }),
    ).rejects.toThrow(/No reference documents were selected/i);
  });

  it("point-scopes home-book facts across all five formats with a cross-book flashback anchor", async () => {
    const selection = {
      collectionId: liveCollectionId,
      selectionOverride: true,
      recordIds: [STATION],
    };
    const policy = {
      mode: "point" as const,
      storyPointRecordId: sceneBefore,
      bookProjectId: BOOK2,
      approvedOnly: true,
    };

    const model = await buildWorldBibleExportModel(t.db, BOOK2, selection, policy);
    expect(model.storyPointLabel).toMatch(/Book One/i);
    expect(model.point?.bookProjectId).toBe(BOOK1);
    expect(model.entries).toHaveLength(1);
    expect(model.entries[0]!.facts).toContain(ELIGIBLE);
    expect(model.entries[0]!.facts).not.toContain(LATER);
    expect(model.entries[0]!.secondary.some((s) => s.category === CUSTOM_CAT)).toBe(true);
    expect(model.groups.some((g) => g.seeAlso.some((s) => s.categoryLabel === "Harbors (Book One label)"))).toBe(
      true,
    );

    const [wiki, markdown, docx, epub, pdf] = await artifacts(selection, policy);

    const wikiZip = await JSZip.loadAsync(wiki.bytes);
    const wikiPage = await wikiZip.file(`pages/saltmarsh-station-${STATION}.html`)!.async("string");
    expect(wikiPage).toContain(ELIGIBLE);
    expect(wikiPage).not.toContain(LATER);
    expect(wikiPage).not.toContain(FUTURE);
    expect(Object.keys(wikiZip.files).some((name) => name.includes(IMG_BODY.replace(".png", "")))).toBe(true);
    expect(Object.keys(wikiZip.files).some((name) => name.includes("future") || name.includes("closed-future"))).toBe(
      false,
    );
    expect(wikiPage).not.toContain(IMG_GALLERY);

    const mdZip = await JSZip.loadAsync(markdown.bytes);
    const stationMd = await mdZip.file(`saltmarsh-station-${STATION}.md`)!.async("string");
    expect(stationMd).toContain(ELIGIBLE);
    expect(stationMd).not.toContain(LATER);

    const docxZip = await JSZip.loadAsync(docx.bytes);
    const documentXml = await docxZip.file("word/document.xml")!.async("string");
    expect(documentXml).toContain(ELIGIBLE);
    expect(documentXml).not.toContain(LATER);

    const epubZip = await JSZip.loadAsync(epub.bytes);
    const xhtml = await epubZip.file(`OEBPS/saltmarsh-station-${STATION}.xhtml`)!.async("string");
    expect(xhtml).toContain(ELIGIBLE);
    expect(xhtml).not.toContain(LATER);

    const pdfText = await extractPdfText(pdf.bytes);
    expect(pdfText).toContain(ELIGIBLE);
    expect(pdfText).not.toContain(LATER);
    expect(pdfText).not.toContain(FUTURE);
  });

  it("keeps both facts in full-author export and refuses an out-of-series anchor", async () => {
    const selection = { recordIds: [STATION] };
    const full = await buildWorldBibleExportModel(t.db, BOOK2, selection, { mode: "full" });
    expect(full.entries[0]!.facts).toEqual(expect.arrayContaining([ELIGIBLE, LATER]));

    const [wiki, , , , pdf] = await artifacts(selection, { mode: "full" });
    const wikiZip = await JSZip.loadAsync(wiki.bytes);
    const wikiPage = await wikiZip.file(`pages/saltmarsh-station-${STATION}.html`)!.async("string");
    expect(wikiPage).toContain(ELIGIBLE);
    expect(wikiPage).toContain(LATER);
    // Full author keeps gallery assets.
    expect(Object.keys(wikiZip.files).some((name) => name.includes("closed-future") || name.includes(IMG_GALLERY))).toBe(
      true,
    );

    const pdfText = await extractPdfText(pdf.bytes);
    expect(pdfText).toContain(ELIGIBLE);
    expect(pdfText).toContain(LATER);

    await expect(
      buildWorldBibleExportModel(
        t.db,
        BOOK2,
        selection,
        { mode: "point", storyPointRecordId: "rec_not_in_series", bookProjectId: BOOK2 },
      ),
    ).rejects.toThrow(/not in this series/i);
  });

  it("uses home-book custom category labels when the viewing book redefines the slug", async () => {
    const model = await buildWorldBibleExportModel(t.db, BOOK2, { recordIds: [HARBOR] }, { mode: "full" });
    expect(model.entries[0]!.categoryLabel).toBe("Harbors (Book One label)");
    expect(model.entries[0]!.categoryLabel).not.toBe("Harbors (Book Two label)");
  });
});
