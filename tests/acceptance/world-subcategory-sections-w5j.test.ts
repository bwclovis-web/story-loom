import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { evaluatePassageAgainstWorldFact, findingsToPersist } from "@/domain/worldContradiction";
import type { JsonObject } from "@/domain/json";
import {
  emptyWorldProfile,
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

const WSP = "wsp_w5j";
const BOOK = "prj_w5j_book";
const CUSTOM = "rec_w5j_threshold";
const CHAPTER = "rec_w5j_chapter";
const SCENE_EARLY = "rec_w5j_scene_early";
const SCENE_LATER = "rec_w5j_scene_later";

const OCCASION = "At a workshop door when a visitor arrives.";
const EARLY_CONDUCT = "Visitors wait at the threshold until acknowledged.";
const LATER_CONDUCT =
  "Visitors wait at the threshold until acknowledged, except regular customers, who may enter directly.";
const BREACH =
  "Walking straight in may be read as familiarity, rudeness, or ignorance, depending on who is watching.";

function historyChange(
  partial: Partial<WorldFieldHistoryChange> & Pick<WorldFieldHistoryChange, "id" | "fieldPath" | "value">,
): WorldFieldHistoryChange {
  return {
    definitionId: "category:cultures",
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

describe("W5D cultures custom in practice section", () => {
  let t: TestDb;

  beforeEach(async () => {
    t = await createTestDb();
    await createWorkspace(t.db, { id: WSP, name: "W5J Workspace" });
    await createProject(t.db, { id: BOOK, workspaceId: WSP, title: "W5J Book" });
  }, 15_000);

  afterEach(async () => {
    await t.cleanup();
  });

  it("saves a named custom without repeating Cultures overview owners", async () => {
    await createRecord(t.db, BOOK, {
      recordId: CUSTOM,
      type: "worldbuilding",
      title: "Workshop Threshold Courtesy",
      body: "A copper-lane workshop courtesy.",
      fields: withRecordTaxonomy(
        { kind: "culture" },
        { version: 1, primary: { category: "cultures", subcategory: "customs" } },
      ),
      authorityStatus: "approved",
    });

    const profile: WorldProfile = {
      ...emptyWorldProfile(),
      definitionId: "category:cultures",
      enabledSections: ["cultures:customs"],
      values: {
        customs: "Everyday workshop courtesies along Copper Lane.",
        etiquette: "Address the master before the apprentices.",
        regionalVariation: "Harbor shops are less formal.",
        occasion: OCCASION,
        expectedConduct: EARLY_CONDUCT,
        breachReading: BREACH,
      },
    };
    await saveWorldProfileOverlay(t.db, {
      projectId: BOOK,
      recordId: CUSTOM,
      expectedRevision: 1,
      profile,
    });

    const afterHide: WorldProfile = { ...profile, enabledSections: [] };
    await saveWorldProfileOverlay(t.db, {
      projectId: BOOK,
      recordId: CUSTOM,
      expectedRevision: 2,
      profile: afterHide,
    });
    let saved = readWorldProfile((await getRecord(t.db, BOOK, CUSTOM)).fields);
    expect(saved.profile.definitionId).toBe("category:cultures");
    expect(saved.profile.enabledSections).toEqual([]);
    expect(saved.profile.values.customs).toBe("Everyday workshop courtesies along Copper Lane.");
    expect(saved.profile.values.occasion).toBe(OCCASION);
    expect(saved.profile.values.expectedConduct).toBe(EARLY_CONDUCT);
    expect(saved.profile.values.breachReading).toBe(BREACH);

    await saveWorldProfileOverlay(t.db, {
      projectId: BOOK,
      recordId: CUSTOM,
      expectedRevision: 3,
      profile: { ...afterHide, enabledSections: ["cultures:customs"] },
    });
    saved = readWorldProfile((await getRecord(t.db, BOOK, CUSTOM)).fields);
    expect(saved.profile.enabledSections).toEqual(["cultures:customs"]);
    expect(saved.profile.values.expectedConduct).toBe(EARLY_CONDUCT);

    const beforeTaxonomy = await getRecord(t.db, BOOK, CUSTOM);
    await updateRecord(t.db, BOOK, {
      recordId: CUSTOM,
      expectedRevision: beforeTaxonomy.currentRevision,
      fields: withRecordTaxonomy(beforeTaxonomy.fields as JsonObject, {
        version: 1,
        primary: { category: "cultures", subcategory: "traditions" },
        secondary: [{ category: "cultures", subcategory: "customs" }],
      }),
    });
    const afterTaxonomy = readWorldProfile((await getRecord(t.db, BOOK, CUSTOM)).fields);
    expect(afterTaxonomy.profile.definitionId).toBe("category:cultures");
    expect(afterTaxonomy.profile.enabledSections).toEqual(["cultures:customs"]);
    expect(afterTaxonomy.profile.values.occasion).toBe(OCCASION);

    const exportModel = await buildWorldBibleExportModel(t.db, BOOK, { recordIds: [CUSTOM] });
    const markdown = renderWorldBibleProfileMarkdown(
      exportModel.entries.find((entry) => entry.record.id === CUSTOM)!,
      exportModel,
    );
    expect(markdown).toContain(OCCASION);
    expect(markdown).toContain(EARLY_CONDUCT);
    expect(markdown).toContain(BREACH);
    expect(countLabel(markdown, "Customs")).toBe(1);
    expect(countLabel(markdown, "Etiquette")).toBe(1);
    expect(countLabel(markdown, "Regional variation")).toBe(1);
    expect(countLabel(markdown, "Occasion")).toBe(1);
    expect(countLabel(markdown, "Expected conduct")).toBe(1);
    expect(countLabel(markdown, "How a breach may be read")).toBe(1);
  });

  it("keeps early threshold waiting and allows a visitor who walks straight in", async () => {
    const early = await createStoryEvent(t.db, BOOK, { title: "Old courtesy" });
    const later = await createStoryEvent(t.db, BOOK, { title: "Regulars welcome" });
    await orderStoryEvents(t.db, BOOK, {
      eventId: early.id,
      otherEventId: later.id,
      direction: "before",
      expectedRevision: 0,
    });
    await createRecord(t.db, BOOK, {
      recordId: CHAPTER,
      type: "manuscript_chapter",
      title: "Copper Lane",
      body: "Chapter shell.",
      authorityStatus: "draft",
    });
    await createRecord(t.db, BOOK, {
      recordId: SCENE_EARLY,
      type: "manuscript_scene",
      title: "Before the change",
      body: "She waited on the sill.",
      authorityStatus: "draft",
      parentRecordId: CHAPTER,
    });
    await createRecord(t.db, BOOK, {
      recordId: SCENE_LATER,
      type: "manuscript_scene",
      title: "After the change",
      body: "The visitor walked straight in.",
      authorityStatus: "draft",
      parentRecordId: CHAPTER,
    });
    const earlyRow = await t.db.storyEvent.findFirstOrThrow({ where: { id: early.id } });
    const laterRow = await t.db.storyEvent.findFirstOrThrow({ where: { id: later.id } });
    await linkStoryEventScene(t.db, BOOK, early.id, SCENE_EARLY, earlyRow.revision);
    await linkStoryEventScene(t.db, BOOK, later.id, SCENE_LATER, laterRow.revision);

    await createRecord(t.db, BOOK, {
      recordId: CUSTOM,
      type: "worldbuilding",
      title: "Workshop Threshold Courtesy",
      body: "A copper-lane workshop courtesy.",
      fields: withRecordTaxonomy(
        { kind: "culture" },
        { version: 1, primary: { category: "cultures", subcategory: "customs" } },
      ),
      authorityStatus: "approved",
    });

    const profile: WorldProfile = {
      ...emptyWorldProfile(),
      definitionId: "category:cultures",
      enabledSections: ["cultures:customs"],
      values: {
        occasion: OCCASION,
        expectedConduct: LATER_CONDUCT,
        breachReading: BREACH,
      },
      fieldHistory: [
        historyChange({
          id: "wfh_w5j_occasion_early",
          fieldPath: "values.occasion",
          value: OCCASION,
          storyEventId: early.id,
        }),
        historyChange({
          id: "wfh_w5j_conduct_early",
          fieldPath: "values.expectedConduct",
          value: EARLY_CONDUCT,
          storyEventId: early.id,
        }),
        historyChange({
          id: "wfh_w5j_breach_early",
          fieldPath: "values.breachReading",
          value: BREACH,
          storyEventId: early.id,
        }),
        historyChange({
          id: "wfh_w5j_conduct_later",
          fieldPath: "values.expectedConduct",
          value: LATER_CONDUCT,
          storyEventId: later.id,
        }),
      ],
    };
    await saveWorldProfileOverlay(t.db, {
      projectId: BOOK,
      recordId: CUSTOM,
      expectedRevision: 1,
      profile,
    });

    const earlyExport = await buildWorldBibleExportModel(
      t.db,
      BOOK,
      { recordIds: [CUSTOM] },
      { mode: "point", storyPointRecordId: SCENE_EARLY, bookProjectId: BOOK, approvedOnly: true },
    );
    const earlyConduct =
      earlyExport.entries
        .find((entry) => entry.record.id === CUSTOM)
        ?.fields.find((field) => field.key === "expectedConduct")?.value ?? "";
    expect(earlyConduct).toContain(EARLY_CONDUCT);
    expect(earlyConduct).not.toMatch(/regular customers/i);

    const laterExport = await buildWorldBibleExportModel(
      t.db,
      BOOK,
      { recordIds: [CUSTOM] },
      { mode: "point", storyPointRecordId: SCENE_LATER, bookProjectId: BOOK, approvedOnly: true },
    );
    const laterConduct =
      laterExport.entries
        .find((entry) => entry.record.id === CUSTOM)
        ?.fields.find((field) => field.key === "expectedConduct")?.value ?? "";
    expect(laterConduct).toContain("regular customers");
    expect(laterConduct).toContain("enter directly");

    const saved = readWorldProfile((await getRecord(t.db, BOOK, CUSTOM)).fields).profile;
    const orderEdges = [{ earlierId: early.id, laterId: later.id }];
    const earlyPoint = {
      bookProjectId: BOOK,
      storyEventId: early.id,
      chapterRecordId: CHAPTER,
      sceneRecordId: SCENE_EARLY,
      sequence: null,
      boundary: "at_point" as const,
    };
    const laterPoint = { ...earlyPoint, storyEventId: later.id, sceneRecordId: SCENE_LATER };

    const earlyResolved = resolveWorldFieldsAtPoint(saved, earlyPoint, orderEdges, {
      fieldPaths: ["values.expectedConduct"],
    });
    expect(
      earlyResolved.fields["values.expectedConduct"]?.presence === "set"
        ? earlyResolved.fields["values.expectedConduct"].formatted
        : "",
    ).toContain(EARLY_CONDUCT);
    expect(
      earlyResolved.fields["values.expectedConduct"]?.presence === "set"
        ? earlyResolved.fields["values.expectedConduct"].formatted
        : "",
    ).not.toMatch(/regular customers/i);

    const laterResolved = resolveWorldFieldsAtPoint(saved, laterPoint, orderEdges, {
      fieldPaths: ["values.expectedConduct"],
    });
    expect(
      laterResolved.fields["values.expectedConduct"]?.presence === "set"
        ? laterResolved.fields["values.expectedConduct"].formatted
        : "",
    ).toMatch(/regular customers/i);

    const earlyDraft = renderWorldContextSlice({
      title: "Workshop Threshold Courtesy",
      recordId: CUSTOM,
      fields: (await getRecord(t.db, BOOK, CUSTOM)).fields as JsonObject,
      mode: "drafting",
      point: earlyPoint,
      edges: orderEdges,
      viewingProjectId: BOOK,
    });
    expect(earlyDraft.text).toMatch(/wait at the threshold until acknowledged/i);
    expect(earlyDraft.text).not.toMatch(/regular customers/i);

    const laterDraft = renderWorldContextSlice({
      title: "Workshop Threshold Courtesy",
      recordId: CUSTOM,
      fields: (await getRecord(t.db, BOOK, CUSTOM)).fields as JsonObject,
      mode: "drafting",
      point: laterPoint,
      edges: orderEdges,
      viewingProjectId: BOOK,
    });
    expect(laterDraft.text).toMatch(/regular customers/i);
    expect(laterDraft.text).toMatch(/How a breach may be read/i);

    const walksIn = evaluatePassageAgainstWorldFact({
      passage: {
        text: "The visitor walked straight in.",
        start: 0,
        end: "The visitor walked straight in.".length,
        stance: "narration",
      },
      fact: {
        worldRecordId: CUSTOM,
        worldTitle: "Workshop Threshold Courtesy",
        fieldPath: "values.expectedConduct",
        changeId: "wfh_w5j_conduct_later",
        worldRecordRevision: 2,
        value: LATER_CONDUCT,
        formatted: LATER_CONDUCT,
        storyPointLabel: "Regulars welcome",
        subcategoryId: "customs",
      },
      manuscriptRecordId: SCENE_LATER,
      manuscriptRevision: 1,
    });
    expect(walksIn.verdict).toBe("insufficient_evidence");
    expect(findingsToPersist([walksIn])).toEqual([]);

    const breachStillPresent =
      laterExport.entries
        .find((entry) => entry.record.id === CUSTOM)
        ?.fields.find((field) => field.key === "breachReading")?.value ?? "";
    expect(breachStillPresent).toContain(BREACH);
  });
});
