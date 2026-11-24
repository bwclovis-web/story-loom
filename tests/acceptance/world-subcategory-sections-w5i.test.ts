import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { JsonObject } from "@/domain/json";
import {
  emptyWorldProfile,
  formatWorldProfileFieldValue,
  readWorldProfile,
  type WorldFieldHistoryChange,
  type WorldProfile,
} from "@/domain/worldProfile";
import { resolveWorldFieldsAtPoint } from "@/domain/worldProfileHistory";
import { renderWorldContextSlice } from "@/domain/worldWritingContext";
import { createProject, createWorkspace } from "@/server/services/projectService";
import { createRecord, getRecord, updateRecord } from "@/server/services/recordService";
import { createStoryEvent, linkStoryEventScene, orderStoryEvents } from "@/server/services/storyEventService";
import { saveWorldProfileOverlay } from "@/server/services/worldProfileUpgradeService";
import { buildWorldBibleExportModel } from "@/server/services/worldBibleModel";
import { renderWorldBibleProfileMarkdown } from "@/server/services/worldBibleProfileRender";
import { withRecordTaxonomy } from "@/world/taxonomy";
import { createTestDb, type TestDb } from "../helpers";

const WSP = "wsp_w5i";
const BOOK = "prj_w5i_book";
const TRAIN = "rec_w5i_train";
const HARBOR = "rec_w5i_harbor";
const QUAY = "rec_w5i_quay";
const CHAPTER = "rec_w5i_chapter";
const SCENE_EARLY = "rec_w5i_scene_early";
const SCENE_LATER = "rec_w5i_scene_later";

const EARLY_DURATION = { amount: 90, unit: "minutes", qualifier: "about" as const };
const LATER_DURATION = { amount: 60, unit: "minutes", qualifier: "about" as const };
const PATTERN = "twice on market mornings";

function historyChange(
  partial: Partial<WorldFieldHistoryChange> & Pick<WorldFieldHistoryChange, "id" | "fieldPath" | "value">,
): WorldFieldHistoryChange {
  return {
    definitionId: "category:technology",
    storage: "profile",
    presence: "set",
    approval: "approved",
    planned: false,
    provenance: { origin: "author", note: "" },
    bookProjectId: BOOK,
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

function countLabel(markdown: string, label: string): number {
  return markdown.split(`**${label}:**`).length - 1;
}

describe("W5D technology route and service section", () => {
  let t: TestDb;

  beforeEach(async () => {
    t = await createTestDb();
    await createWorkspace(t.db, { id: WSP, name: "W5I Workspace" });
    await createProject(t.db, { id: BOOK, workspaceId: WSP, title: "W5I Book" });
  }, 15_000);

  afterEach(async () => {
    await t.cleanup();
  });

  it("saves ordered stops without copying technology owners or changing a station profile", async () => {
    await createRecord(t.db, BOOK, {
      recordId: HARBOR,
      type: "worldbuilding",
      title: "Harbor Gate Station",
      body: "The coastal terminus.",
      fields: withRecordTaxonomy(
        { kind: "place" },
        {
          version: 1,
          primary: { category: "locations", subcategory: "buildings" },
          secondary: [{ category: "technology", subcategory: "transportation" }],
        },
      ),
      authorityStatus: "approved",
    });
    await createRecord(t.db, BOOK, {
      recordId: QUAY,
      type: "worldbuilding",
      title: "Copper Quay",
      body: "The mid-coast stop.",
      fields: withRecordTaxonomy(
        { kind: "place" },
        { version: 1, primary: { category: "locations", subcategory: "buildings" } },
      ),
      authorityStatus: "approved",
    });
    await createRecord(t.db, BOOK, {
      recordId: TRAIN,
      type: "worldbuilding",
      title: "Copper Coast Local",
      body: "A coastal coach service.",
      fields: withRecordTaxonomy(
        {},
        { version: 1, primary: { category: "technology", subcategory: "transportation" } },
      ),
      authorityStatus: "approved",
    });

    const harborProfile: WorldProfile = {
      ...emptyWorldProfile(),
      definitionId: "category:locations",
      values: { layout: "One platform and a ticket shed." },
    };
    await saveWorldProfileOverlay(t.db, {
      projectId: BOOK,
      recordId: HARBOR,
      expectedRevision: 1,
      profile: harborProfile,
    });
    const harborSaved = readWorldProfile((await getRecord(t.db, BOOK, HARBOR)).fields);
    expect(harborSaved.profile.definitionId).toBe("category:locations");

    const stops = [
      { line: "Harbor Gate", gloss: "", recordId: HARBOR },
      { line: "Cliff Path Halt", gloss: "" },
      { line: "Copper Quay", gloss: "", recordId: QUAY },
      { line: "Harbor Gate", gloss: "", recordId: HARBOR },
    ];
    const profile: WorldProfile = {
      ...emptyWorldProfile(),
      definitionId: "category:technology",
      enabledSections: ["technology:transportation"],
      values: {
        purpose: "Coastal passenger service.",
        operatingRequirements: "Two horses and a dry road.",
        availability: "Market towns along the coast.",
        limitations: "Does not run in high water.",
        routeStops: stops,
        typicalJourneyTime: EARLY_DURATION,
        servicePattern: PATTERN,
      },
    };
    await saveWorldProfileOverlay(t.db, {
      projectId: BOOK,
      recordId: TRAIN,
      expectedRevision: 1,
      profile,
    });

    const afterHide: WorldProfile = { ...profile, enabledSections: [] };
    await saveWorldProfileOverlay(t.db, {
      projectId: BOOK,
      recordId: TRAIN,
      expectedRevision: 2,
      profile: afterHide,
    });
    let saved = readWorldProfile((await getRecord(t.db, BOOK, TRAIN)).fields);
    expect(saved.profile.definitionId).toBe("category:technology");
    expect(saved.profile.enabledSections).toEqual([]);
    expect(saved.profile.values.routeStops).toEqual(stops);
    expect(saved.profile.values.typicalJourneyTime).toEqual(EARLY_DURATION);
    expect(saved.profile.values.servicePattern).toBe(PATTERN);

    await saveWorldProfileOverlay(t.db, {
      projectId: BOOK,
      recordId: TRAIN,
      expectedRevision: 3,
      profile: { ...afterHide, enabledSections: ["technology:transportation"] },
    });
    saved = readWorldProfile((await getRecord(t.db, BOOK, TRAIN)).fields);
    expect(saved.profile.enabledSections).toEqual(["technology:transportation"]);
    expect(saved.profile.values.routeStops).toEqual(stops);

    const beforeTaxonomy = await getRecord(t.db, BOOK, TRAIN);
    await updateRecord(t.db, BOOK, {
      recordId: TRAIN,
      expectedRevision: beforeTaxonomy.currentRevision,
      fields: withRecordTaxonomy(beforeTaxonomy.fields as JsonObject, {
        version: 1,
        primary: { category: "technology", subcategory: "engineering" },
        secondary: [{ category: "technology", subcategory: "transportation" }],
      }),
    });
    const afterTaxonomy = readWorldProfile((await getRecord(t.db, BOOK, TRAIN)).fields);
    expect(afterTaxonomy.profile.definitionId).toBe("category:technology");
    expect(afterTaxonomy.profile.enabledSections).toEqual(["technology:transportation"]);
    expect((afterTaxonomy.profile.values.routeStops as { recordId?: string }[])[0]?.recordId).toBe(HARBOR);

    const stillHarbor = readWorldProfile((await getRecord(t.db, BOOK, HARBOR)).fields);
    expect(stillHarbor.profile.definitionId).toBe("category:locations");
    expect(stillHarbor.profile.values.layout).toBe("One platform and a ticket shed.");

    const exportModel = await buildWorldBibleExportModel(t.db, BOOK, {
      recordIds: [TRAIN, HARBOR, QUAY],
    });
    const markdown = renderWorldBibleProfileMarkdown(
      exportModel.entries.find((entry) => entry.record.id === TRAIN)!,
      exportModel,
    );
    expect(markdown).toContain("Harbor Gate — Harbor Gate Station");
    expect(markdown).toContain("Cliff Path Halt");
    expect(markdown).toContain("Copper Quay — Copper Quay");
    expect(markdown.indexOf("Harbor Gate")).toBeLessThan(markdown.indexOf("Cliff Path Halt"));
    expect(markdown.indexOf("Cliff Path Halt")).toBeLessThan(markdown.indexOf("Copper Quay"));
    expect(markdown).toContain("about 90 minutes");
    expect(markdown).toContain(PATTERN);
    expect(countLabel(markdown, "Purpose")).toBe(1);
    expect(countLabel(markdown, "Operating requirements")).toBe(1);
    expect(countLabel(markdown, "Availability")).toBe(1);
    expect(countLabel(markdown, "Limitations")).toBe(1);
    expect(countLabel(markdown, "Stops in travel order")).toBe(1);
    expect(countLabel(markdown, "Typical end-to-end journey time")).toBe(1);
    expect(countLabel(markdown, "Service pattern")).toBe(1);
    expect(markdown).not.toMatch(/about \d+ minutes.*about \d+ minutes/i);
  });

  it("keeps the early duration out of a later express timetable point", async () => {
    const local = await createStoryEvent(t.db, BOOK, { title: "Local timetable" });
    const express = await createStoryEvent(t.db, BOOK, { title: "Express timetable" });
    await orderStoryEvents(t.db, BOOK, {
      eventId: local.id,
      otherEventId: express.id,
      direction: "before",
      expectedRevision: 0,
    });
    await createRecord(t.db, BOOK, {
      recordId: CHAPTER,
      type: "manuscript_chapter",
      title: "Coast run",
      body: "Chapter shell.",
      authorityStatus: "draft",
    });
    await createRecord(t.db, BOOK, {
      recordId: SCENE_EARLY,
      type: "manuscript_scene",
      title: "Before the express",
      body: "The local still takes most of the morning.",
      authorityStatus: "draft",
      parentRecordId: CHAPTER,
    });
    await createRecord(t.db, BOOK, {
      recordId: SCENE_LATER,
      type: "manuscript_scene",
      title: "After the express",
      body: "The express cuts an hour.",
      authorityStatus: "draft",
      parentRecordId: CHAPTER,
    });
    const localRow = await t.db.storyEvent.findFirstOrThrow({ where: { id: local.id } });
    const expressRow = await t.db.storyEvent.findFirstOrThrow({ where: { id: express.id } });
    await linkStoryEventScene(t.db, BOOK, local.id, SCENE_EARLY, localRow.revision);
    await linkStoryEventScene(t.db, BOOK, express.id, SCENE_LATER, expressRow.revision);

    await createRecord(t.db, BOOK, {
      recordId: TRAIN,
      type: "worldbuilding",
      title: "Copper Coast Local",
      body: "A coastal coach service.",
      fields: withRecordTaxonomy(
        {},
        { version: 1, primary: { category: "technology", subcategory: "transportation" } },
      ),
      authorityStatus: "approved",
    });

    const stops = [
      { line: "Harbor Gate", gloss: "" },
      { line: "Cliff Path Halt", gloss: "" },
      { line: "Copper Quay", gloss: "" },
    ];
    const profile: WorldProfile = {
      ...emptyWorldProfile(),
      definitionId: "category:technology",
      enabledSections: ["technology:transportation"],
      values: {
        routeStops: stops,
        typicalJourneyTime: LATER_DURATION,
        servicePattern: PATTERN,
      },
      fieldHistory: [
        historyChange({
          id: "wfh_w5i_time_early",
          fieldPath: "values.typicalJourneyTime",
          value: EARLY_DURATION,
          storyEventId: local.id,
        }),
        historyChange({
          id: "wfh_w5i_time_later",
          fieldPath: "values.typicalJourneyTime",
          value: LATER_DURATION,
          storyEventId: express.id,
        }),
      ],
    };
    await saveWorldProfileOverlay(t.db, {
      projectId: BOOK,
      recordId: TRAIN,
      expectedRevision: 1,
      profile,
    });

    const earlyExport = await buildWorldBibleExportModel(
      t.db,
      BOOK,
      { recordIds: [TRAIN] },
      { mode: "point", storyPointRecordId: SCENE_EARLY, bookProjectId: BOOK, approvedOnly: true },
    );
    const earlyTime =
      earlyExport.entries
        .find((entry) => entry.record.id === TRAIN)
        ?.fields.find((field) => field.key === "typicalJourneyTime")?.value ?? "";
    expect(earlyTime).toContain("about 90 minutes");
    expect(earlyTime).not.toMatch(/60/);

    const laterExport = await buildWorldBibleExportModel(
      t.db,
      BOOK,
      { recordIds: [TRAIN] },
      { mode: "point", storyPointRecordId: SCENE_LATER, bookProjectId: BOOK, approvedOnly: true },
    );
    const laterTime =
      laterExport.entries
        .find((entry) => entry.record.id === TRAIN)
        ?.fields.find((field) => field.key === "typicalJourneyTime")?.value ?? "";
    expect(laterTime).toContain("about 60 minutes");
    expect(laterTime).not.toMatch(/90/);

    const saved = readWorldProfile((await getRecord(t.db, BOOK, TRAIN)).fields).profile;
    const orderEdges = [{ earlierId: local.id, laterId: express.id }];
    const earlyPoint = {
      bookProjectId: BOOK,
      storyEventId: local.id,
      chapterRecordId: CHAPTER,
      sceneRecordId: SCENE_EARLY,
      sequence: null,
      boundary: "at_point" as const,
    };
    const laterPoint = { ...earlyPoint, storyEventId: express.id, sceneRecordId: SCENE_LATER };

    const earlyResolved = resolveWorldFieldsAtPoint(saved, earlyPoint, orderEdges, {
      fieldPaths: ["values.typicalJourneyTime"],
    });
    expect(
      earlyResolved.fields["values.typicalJourneyTime"]?.presence === "set"
        ? earlyResolved.fields["values.typicalJourneyTime"].formatted
        : "",
    ).toBe(formatWorldProfileFieldValue(EARLY_DURATION));

    const laterResolved = resolveWorldFieldsAtPoint(saved, laterPoint, orderEdges, {
      fieldPaths: ["values.typicalJourneyTime"],
    });
    expect(
      laterResolved.fields["values.typicalJourneyTime"]?.presence === "set"
        ? laterResolved.fields["values.typicalJourneyTime"].formatted
        : "",
    ).toBe(formatWorldProfileFieldValue(LATER_DURATION));

    const earlyDraft = renderWorldContextSlice({
      title: "Copper Coast Local",
      recordId: TRAIN,
      fields: (await getRecord(t.db, BOOK, TRAIN)).fields as JsonObject,
      mode: "drafting",
      point: earlyPoint,
      edges: orderEdges,
      viewingProjectId: BOOK,
    });
    expect(earlyDraft.text).toMatch(/about 90 minutes/i);
    expect(earlyDraft.text).not.toMatch(/about 60 minutes/i);
    expect(earlyDraft.text).not.toMatch(/leg|between stops|Harbor Gate to Cliff/i);

    const laterDraft = renderWorldContextSlice({
      title: "Copper Coast Local",
      recordId: TRAIN,
      fields: (await getRecord(t.db, BOOK, TRAIN)).fields as JsonObject,
      mode: "drafting",
      point: laterPoint,
      edges: orderEdges,
      viewingProjectId: BOOK,
    });
    expect(laterDraft.text).toMatch(/about 60 minutes/i);
    expect(laterDraft.text).not.toMatch(/about 90 minutes/i);
    expect(laterDraft.text).not.toMatch(/leg|between stops|Harbor Gate to Cliff/i);
  });
});
