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

const WSP = "wsp_w5g";
const BOOK = "prj_w5g_book";
const WARD = "rec_w5g_ward";
const CHAPTER = "rec_w5g_chapter";
const SCENE_EARLY = "rec_w5g_scene_early";
const SCENE_LATER = "rec_w5g_scene_later";

const PRECONDITION = "The glass must be unbroken.";
const EARLY_SIGN = "one clear chime";
const LATER_SIGN = "two low chimes";
const FAILURE_SIGN = "a hairline crack";

function historyChange(
  partial: Partial<WorldFieldHistoryChange> & Pick<WorldFieldHistoryChange, "id" | "fieldPath" | "value">,
): WorldFieldHistoryChange {
  return {
    definitionId: "category:magic",
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

describe("W5D magic workings section", () => {
  let t: TestDb;

  beforeEach(async () => {
    t = await createTestDb();
    await createWorkspace(t.db, { id: WSP, name: "W5G Workspace" });
    await createProject(t.db, { id: BOOK, workspaceId: WSP, title: "W5G Book" });
  }, 15_000);

  afterEach(async () => {
    await t.cleanup();
  });

  it("saves a working without repeating Magic system owners", async () => {
    await createRecord(t.db, BOOK, {
      recordId: WARD,
      type: "worldbuilding",
      title: "Bellglass Ward",
      body: "A glass ward over the harbour bell.",
      fields: withRecordTaxonomy(
        { kind: "magic_system", source: "Harbour bellglass", limits: "Breaks if the glass cracks" },
        { version: 1, primary: { category: "magic", subcategory: "workings" } },
      ),
      authorityStatus: "approved",
    });

    const profile: WorldProfile = {
      ...emptyWorldProfile(),
      definitionId: "category:magic",
      enabledSections: ["magic:workings"],
      values: {
        workings: "A ward that rings when the harbour is watched.",
        costs: "A bead of glass from the bell.",
        exceptions: "Storm silence.",
        preconditions: PRECONDITION,
        observableSigns: EARLY_SIGN,
        signsOfFailure: FAILURE_SIGN,
      },
    };
    await saveWorldProfileOverlay(t.db, {
      projectId: BOOK,
      recordId: WARD,
      expectedRevision: 1,
      profile,
    });

    const afterHide: WorldProfile = {
      ...profile,
      enabledSections: [],
    };
    await saveWorldProfileOverlay(t.db, {
      projectId: BOOK,
      recordId: WARD,
      expectedRevision: 2,
      profile: afterHide,
    });
    let saved = readWorldProfile((await getRecord(t.db, BOOK, WARD)).fields);
    expect(saved.profile.definitionId).toBe("category:magic");
    expect(saved.profile.enabledSections).toEqual([]);
    expect(saved.profile.values.preconditions).toBe(PRECONDITION);
    expect(saved.profile.values.observableSigns).toBe(EARLY_SIGN);
    expect(saved.profile.values.signsOfFailure).toBe(FAILURE_SIGN);

    await saveWorldProfileOverlay(t.db, {
      projectId: BOOK,
      recordId: WARD,
      expectedRevision: 3,
      profile: { ...afterHide, enabledSections: ["magic:workings"] },
    });
    saved = readWorldProfile((await getRecord(t.db, BOOK, WARD)).fields);
    expect(saved.profile.enabledSections).toEqual(["magic:workings"]);
    expect(saved.profile.values.observableSigns).toBe(EARLY_SIGN);

    const beforeTaxonomy = await getRecord(t.db, BOOK, WARD);
    await updateRecord(t.db, BOOK, {
      recordId: WARD,
      expectedRevision: beforeTaxonomy.currentRevision,
      fields: withRecordTaxonomy(beforeTaxonomy.fields as JsonObject, {
        version: 1,
        primary: { category: "magic", subcategory: "systems" },
        secondary: [{ category: "magic", subcategory: "workings" }],
      }),
    });
    const afterTaxonomy = readWorldProfile((await getRecord(t.db, BOOK, WARD)).fields);
    expect(afterTaxonomy.profile.definitionId).toBe("category:magic");
    expect(afterTaxonomy.profile.enabledSections).toEqual(["magic:workings"]);
    expect(afterTaxonomy.profile.values.preconditions).toBe(PRECONDITION);

    const exportModel = await buildWorldBibleExportModel(t.db, BOOK, { recordIds: [WARD] });
    const markdown = renderWorldBibleProfileMarkdown(
      exportModel.entries.find((entry) => entry.record.id === WARD)!,
      exportModel,
    );
    expect(markdown).toContain(PRECONDITION);
    expect(markdown).toContain(EARLY_SIGN);
    expect(markdown).toContain(FAILURE_SIGN);
    expect(countLabel(markdown, "Source")).toBe(1);
    expect(countLabel(markdown, "Limits")).toBe(1);
    expect(countLabel(markdown, "Costs")).toBe(1);
    expect(countLabel(markdown, "Exceptions")).toBe(1);
    expect(countLabel(markdown, "Workings")).toBe(1);
    expect(countLabel(markdown, "Preconditions")).toBe(1);
    expect(countLabel(markdown, "Observable signs")).toBe(1);
    expect(countLabel(markdown, "Signs of failure")).toBe(1);
  });

  it("keeps a later chime out of an earlier scene and omits no contradiction for a silent scene", async () => {
    const early = await createStoryEvent(t.db, BOOK, { title: "First watch" });
    const later = await createStoryEvent(t.db, BOOK, { title: "Second watch" });
    await orderStoryEvents(t.db, BOOK, {
      eventId: early.id,
      otherEventId: later.id,
      direction: "before",
      expectedRevision: 0,
    });
    await createRecord(t.db, BOOK, {
      recordId: CHAPTER,
      type: "manuscript_chapter",
      title: "Harbour night",
      body: "Chapter shell.",
      authorityStatus: "draft",
    });
    await createRecord(t.db, BOOK, {
      recordId: SCENE_EARLY,
      type: "manuscript_scene",
      title: "Before the change",
      body: "She checked the ward and walked on.",
      authorityStatus: "draft",
      parentRecordId: CHAPTER,
    });
    await createRecord(t.db, BOOK, {
      recordId: SCENE_LATER,
      type: "manuscript_scene",
      title: "After the change",
      body: "Two low chimes answered.",
      authorityStatus: "draft",
      parentRecordId: CHAPTER,
    });
    const earlyRow = await t.db.storyEvent.findFirstOrThrow({ where: { id: early.id } });
    const laterRow = await t.db.storyEvent.findFirstOrThrow({ where: { id: later.id } });
    await linkStoryEventScene(t.db, BOOK, early.id, SCENE_EARLY, earlyRow.revision);
    await linkStoryEventScene(t.db, BOOK, later.id, SCENE_LATER, laterRow.revision);

    await createRecord(t.db, BOOK, {
      recordId: WARD,
      type: "worldbuilding",
      title: "Bellglass Ward",
      body: "A glass ward over the harbour bell.",
      fields: withRecordTaxonomy(
        { kind: "magic_system" },
        { version: 1, primary: { category: "magic", subcategory: "workings" } },
      ),
      authorityStatus: "approved",
    });

    const profile: WorldProfile = {
      ...emptyWorldProfile(),
      definitionId: "category:magic",
      enabledSections: ["magic:workings"],
      values: {
        preconditions: PRECONDITION,
        observableSigns: LATER_SIGN,
        signsOfFailure: FAILURE_SIGN,
      },
      fieldHistory: [
        historyChange({
          id: "wfh_w5g_sign_early",
          fieldPath: "values.observableSigns",
          value: EARLY_SIGN,
          storyEventId: early.id,
        }),
        historyChange({
          id: "wfh_w5g_sign_later",
          fieldPath: "values.observableSigns",
          value: LATER_SIGN,
          storyEventId: later.id,
        }),
      ],
    };
    await saveWorldProfileOverlay(t.db, {
      projectId: BOOK,
      recordId: WARD,
      expectedRevision: 1,
      profile,
    });

    const earlyExport = await buildWorldBibleExportModel(
      t.db,
      BOOK,
      { recordIds: [WARD] },
      { mode: "point", storyPointRecordId: SCENE_EARLY, bookProjectId: BOOK, approvedOnly: true },
    );
    const earlySign =
      earlyExport.entries.find((entry) => entry.record.id === WARD)?.fields.find((field) => field.key === "observableSigns")
        ?.value ?? "";
    expect(earlySign).toContain(EARLY_SIGN);
    expect(earlySign).not.toMatch(/two low chimes/i);

    const laterExport = await buildWorldBibleExportModel(
      t.db,
      BOOK,
      { recordIds: [WARD] },
      { mode: "point", storyPointRecordId: SCENE_LATER, bookProjectId: BOOK, approvedOnly: true },
    );
    const laterSign =
      laterExport.entries.find((entry) => entry.record.id === WARD)?.fields.find((field) => field.key === "observableSigns")
        ?.value ?? "";
    expect(laterSign).toContain(LATER_SIGN);

    const saved = readWorldProfile((await getRecord(t.db, BOOK, WARD)).fields).profile;
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
      fieldPaths: ["values.observableSigns"],
    });
    expect(
      earlyResolved.fields["values.observableSigns"]?.presence === "set"
        ? earlyResolved.fields["values.observableSigns"].formatted
        : "",
    ).toContain(EARLY_SIGN);
    expect(
      earlyResolved.fields["values.observableSigns"]?.presence === "set"
        ? earlyResolved.fields["values.observableSigns"].formatted
        : "",
    ).not.toMatch(/two low chimes/i);

    const laterResolved = resolveWorldFieldsAtPoint(saved, laterPoint, orderEdges, {
      fieldPaths: ["values.observableSigns"],
    });
    expect(
      laterResolved.fields["values.observableSigns"]?.presence === "set"
        ? laterResolved.fields["values.observableSigns"].formatted
        : "",
    ).toContain(LATER_SIGN);

    const drafting = renderWorldContextSlice({
      title: "Bellglass Ward",
      recordId: WARD,
      fields: (await getRecord(t.db, BOOK, WARD)).fields as JsonObject,
      mode: "drafting",
      point: earlyPoint,
      edges: orderEdges,
      viewingProjectId: BOOK,
    });
    expect(drafting.text).toMatch(/one clear chime/i);
    expect(drafting.text).not.toMatch(/two low chimes/i);

    const omitted = evaluatePassageAgainstWorldFact({
      passage: {
        text: "She checked the ward and walked on.",
        start: 0,
        end: "She checked the ward and walked on.".length,
        stance: "narration",
      },
      fact: {
        worldRecordId: WARD,
        worldTitle: "Bellglass Ward",
        fieldPath: "values.observableSigns",
        changeId: "current",
        worldRecordRevision: 2,
        value: EARLY_SIGN,
        formatted: EARLY_SIGN,
        storyPointLabel: "First watch",
        subcategoryId: "workings",
      },
      manuscriptRecordId: SCENE_EARLY,
      manuscriptRevision: 1,
    });
    expect(omitted.verdict).toBe("insufficient_evidence");
    expect(findingsToPersist([omitted])).toEqual([]);
  });
});
