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

const WSP = "wsp_w5h";
const BOOK = "prj_w5h_book";
const RECEIPT = "rec_w5h_receipt";
const CHAPTER = "rec_w5h_chapter";
const SCENE_EARLY = "rec_w5h_scene_early";
const SCENE_LATER = "rec_w5h_scene_later";

const ISSUER = "North Quay Harbor Office";
const RECIPIENT = "Quay Warehouse";
const RECEIPT_CLAIM = "Three crates arrived.";
const ESTABLISHED_COUNT = "Only two crates arrived.";
const APPEARANCE = "Harbor stamp and clerk signature across the fold.";

function historyChange(
  partial: Partial<WorldFieldHistoryChange> & Pick<WorldFieldHistoryChange, "id" | "fieldPath" | "value">,
): WorldFieldHistoryChange {
  return {
    definitionId: "category:objects",
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

describe("W5D objects documents section", () => {
  let t: TestDb;

  beforeEach(async () => {
    t = await createTestDb();
    await createWorkspace(t.db, { id: WSP, name: "W5H Workspace" });
    await createProject(t.db, { id: BOOK, workspaceId: WSP, title: "W5H Book" });
  }, 15_000);

  afterEach(async () => {
    await t.cleanup();
  });

  it("saves a receipt without repeating Objects owners", async () => {
    await createRecord(t.db, BOOK, {
      recordId: RECEIPT,
      type: "worldbuilding",
      title: "North Quay Delivery Receipt",
      body: "A dock receipt for inbound crates.",
      fields: withRecordTaxonomy(
        {
          kind: "object",
          origin: "North Quay tally desk",
          keeper: "Quay Warehouse clerk",
        },
        { version: 1, primary: { category: "objects", subcategory: "documents" } },
      ),
      authorityStatus: "approved",
    });

    const profile: WorldProfile = {
      ...emptyWorldProfile(),
      definitionId: "category:objects",
      enabledSections: ["objects:documents"],
      values: {
        appearance: APPEARANCE,
        ownership: "Harbor office copy",
        significance: "Proof of delivery at the quay.",
        issuedBy: ISSUER,
        issuedTo: RECIPIENT,
        documentSays: RECEIPT_CLAIM,
      },
    };
    await saveWorldProfileOverlay(t.db, {
      projectId: BOOK,
      recordId: RECEIPT,
      expectedRevision: 1,
      profile,
    });

    const afterHide: WorldProfile = {
      ...profile,
      enabledSections: [],
    };
    await saveWorldProfileOverlay(t.db, {
      projectId: BOOK,
      recordId: RECEIPT,
      expectedRevision: 2,
      profile: afterHide,
    });
    let saved = readWorldProfile((await getRecord(t.db, BOOK, RECEIPT)).fields);
    expect(saved.profile.definitionId).toBe("category:objects");
    expect(saved.profile.enabledSections).toEqual([]);
    expect(saved.profile.values.issuedBy).toBe(ISSUER);
    expect(saved.profile.values.issuedTo).toBe(RECIPIENT);
    expect(saved.profile.values.documentSays).toBe(RECEIPT_CLAIM);

    await saveWorldProfileOverlay(t.db, {
      projectId: BOOK,
      recordId: RECEIPT,
      expectedRevision: 3,
      profile: { ...afterHide, enabledSections: ["objects:documents"] },
    });
    saved = readWorldProfile((await getRecord(t.db, BOOK, RECEIPT)).fields);
    expect(saved.profile.enabledSections).toEqual(["objects:documents"]);
    expect(saved.profile.values.documentSays).toBe(RECEIPT_CLAIM);

    const beforeTaxonomy = await getRecord(t.db, BOOK, RECEIPT);
    await updateRecord(t.db, BOOK, {
      recordId: RECEIPT,
      expectedRevision: beforeTaxonomy.currentRevision,
      fields: withRecordTaxonomy(beforeTaxonomy.fields as JsonObject, {
        version: 1,
        primary: { category: "objects", subcategory: "artifacts" },
        secondary: [{ category: "objects", subcategory: "documents" }],
      }),
    });
    const afterTaxonomy = readWorldProfile((await getRecord(t.db, BOOK, RECEIPT)).fields);
    expect(afterTaxonomy.profile.definitionId).toBe("category:objects");
    expect(afterTaxonomy.profile.enabledSections).toEqual(["objects:documents"]);
    expect(afterTaxonomy.profile.values.issuedBy).toBe(ISSUER);

    const exportModel = await buildWorldBibleExportModel(t.db, BOOK, { recordIds: [RECEIPT] });
    const markdown = renderWorldBibleProfileMarkdown(
      exportModel.entries.find((entry) => entry.record.id === RECEIPT)!,
      exportModel,
    );
    expect(markdown).toContain(ISSUER);
    expect(markdown).toContain(RECIPIENT);
    expect(markdown).toContain(RECEIPT_CLAIM);
    expect(countLabel(markdown, "Origin")).toBe(1);
    expect(countLabel(markdown, "Current holder")).toBe(1);
    expect(countLabel(markdown, "Appearance")).toBe(1);
    expect(countLabel(markdown, "Ownership")).toBe(1);
    expect(countLabel(markdown, "Significance")).toBe(1);
    expect(countLabel(markdown, "Issued by")).toBe(1);
    expect(countLabel(markdown, "Issued to")).toBe(1);
    expect(countLabel(markdown, "What the document says")).toBe(1);
  });

  it("keeps the receipt claim attributed beside a later established count", async () => {
    const delivery = await createStoryEvent(t.db, BOOK, { title: "Quay delivery" });
    const inspection = await createStoryEvent(t.db, BOOK, { title: "Warehouse inspection" });
    await orderStoryEvents(t.db, BOOK, {
      eventId: delivery.id,
      otherEventId: inspection.id,
      direction: "before",
      expectedRevision: 0,
    });
    await createRecord(t.db, BOOK, {
      recordId: CHAPTER,
      type: "manuscript_chapter",
      title: "North Quay",
      body: "Chapter shell.",
      authorityStatus: "draft",
    });
    await createRecord(t.db, BOOK, {
      recordId: SCENE_EARLY,
      type: "manuscript_scene",
      title: "Before inspection",
      body: "The clerk filed the receipt.",
      authorityStatus: "draft",
      parentRecordId: CHAPTER,
    });
    await createRecord(t.db, BOOK, {
      recordId: SCENE_LATER,
      type: "manuscript_scene",
      title: "After inspection",
      body: "The receipt listed three crates, but only two arrived.",
      authorityStatus: "draft",
      parentRecordId: CHAPTER,
    });
    const deliveryRow = await t.db.storyEvent.findFirstOrThrow({ where: { id: delivery.id } });
    const inspectionRow = await t.db.storyEvent.findFirstOrThrow({ where: { id: inspection.id } });
    await linkStoryEventScene(t.db, BOOK, delivery.id, SCENE_EARLY, deliveryRow.revision);
    await linkStoryEventScene(t.db, BOOK, inspection.id, SCENE_LATER, inspectionRow.revision);

    await createRecord(t.db, BOOK, {
      recordId: RECEIPT,
      type: "worldbuilding",
      title: "North Quay Delivery Receipt",
      body: "A dock receipt for inbound crates.",
      fields: withRecordTaxonomy(
        { kind: "object" },
        { version: 1, primary: { category: "objects", subcategory: "documents" } },
      ),
      authorityStatus: "approved",
    });

    const profile: WorldProfile = {
      ...emptyWorldProfile(),
      definitionId: "category:objects",
      enabledSections: ["objects:documents"],
      values: {
        issuedBy: ISSUER,
        issuedTo: RECIPIENT,
        documentSays: RECEIPT_CLAIM,
        significance: ESTABLISHED_COUNT,
      },
      fieldHistory: [
        historyChange({
          id: "wfh_w5h_says_delivery",
          fieldPath: "values.documentSays",
          value: RECEIPT_CLAIM,
          storyEventId: delivery.id,
        }),
        historyChange({
          id: "wfh_w5h_count_inspection",
          fieldPath: "values.significance",
          value: ESTABLISHED_COUNT,
          storyEventId: inspection.id,
        }),
      ],
    };
    await saveWorldProfileOverlay(t.db, {
      projectId: BOOK,
      recordId: RECEIPT,
      expectedRevision: 1,
      profile,
    });

    const earlyExport = await buildWorldBibleExportModel(
      t.db,
      BOOK,
      { recordIds: [RECEIPT] },
      { mode: "point", storyPointRecordId: SCENE_EARLY, bookProjectId: BOOK, approvedOnly: true },
    );
    const earlyEntry = earlyExport.entries.find((entry) => entry.record.id === RECEIPT)!;
    const earlySays = earlyEntry.fields.find((field) => field.key === "documentSays")?.value ?? "";
    const earlySignificance = earlyEntry.fields.find((field) => field.key === "significance")?.value ?? "";
    expect(earlySays).toContain(RECEIPT_CLAIM);
    expect(earlySignificance).not.toMatch(/only two crates/i);

    const laterExport = await buildWorldBibleExportModel(
      t.db,
      BOOK,
      { recordIds: [RECEIPT] },
      { mode: "point", storyPointRecordId: SCENE_LATER, bookProjectId: BOOK, approvedOnly: true },
    );
    const laterEntry = laterExport.entries.find((entry) => entry.record.id === RECEIPT)!;
    const laterSays = laterEntry.fields.find((field) => field.key === "documentSays")?.value ?? "";
    const laterSignificance = laterEntry.fields.find((field) => field.key === "significance")?.value ?? "";
    expect(laterSays).toContain(RECEIPT_CLAIM);
    expect(laterSignificance).toContain(ESTABLISHED_COUNT);

    const saved = readWorldProfile((await getRecord(t.db, BOOK, RECEIPT)).fields).profile;
    const orderEdges = [{ earlierId: delivery.id, laterId: inspection.id }];
    const earlyPoint = {
      bookProjectId: BOOK,
      storyEventId: delivery.id,
      chapterRecordId: CHAPTER,
      sceneRecordId: SCENE_EARLY,
      sequence: null,
      boundary: "at_point" as const,
    };
    const laterPoint = { ...earlyPoint, storyEventId: inspection.id, sceneRecordId: SCENE_LATER };
    const earlyResolved = resolveWorldFieldsAtPoint(saved, earlyPoint, orderEdges, {
      fieldPaths: ["values.documentSays", "values.significance"],
    });
    expect(
      earlyResolved.fields["values.documentSays"]?.presence === "set"
        ? earlyResolved.fields["values.documentSays"].formatted
        : "",
    ).toContain(RECEIPT_CLAIM);
    expect(earlyResolved.fields["values.significance"]?.presence).not.toBe("set");

    const laterResolved = resolveWorldFieldsAtPoint(saved, laterPoint, orderEdges, {
      fieldPaths: ["values.documentSays", "values.significance"],
    });
    expect(
      laterResolved.fields["values.documentSays"]?.presence === "set"
        ? laterResolved.fields["values.documentSays"].formatted
        : "",
    ).toContain(RECEIPT_CLAIM);
    expect(
      laterResolved.fields["values.significance"]?.presence === "set"
        ? laterResolved.fields["values.significance"].formatted
        : "",
    ).toContain(ESTABLISHED_COUNT);

    const drafting = renderWorldContextSlice({
      title: "North Quay Delivery Receipt",
      recordId: RECEIPT,
      fields: (await getRecord(t.db, BOOK, RECEIPT)).fields as JsonObject,
      mode: "drafting",
      point: laterPoint,
      edges: orderEdges,
      viewingProjectId: BOOK,
    });
    expect(drafting.text).toMatch(/Three crates arrived/i);
    expect(drafting.text).toMatch(/Only two crates arrived/i);
    expect(drafting.text).toMatch(/What the document says/i);
    expect(drafting.text).toMatch(/Significance/i);

    const discrepancy = evaluatePassageAgainstWorldFact({
      passage: {
        text: "The receipt listed three crates, but only two arrived.",
        start: 0,
        end: "The receipt listed three crates, but only two arrived.".length,
        stance: "narration",
      },
      fact: {
        worldRecordId: RECEIPT,
        worldTitle: "North Quay Delivery Receipt",
        fieldPath: "values.documentSays",
        changeId: "wfh_w5h_says_delivery",
        worldRecordRevision: 2,
        value: RECEIPT_CLAIM,
        formatted: RECEIPT_CLAIM,
        storyPointLabel: "Quay delivery",
        subcategoryId: "documents",
      },
      manuscriptRecordId: SCENE_LATER,
      manuscriptRevision: 1,
    });
    expect(discrepancy.verdict).toBe("insufficient_evidence");
    expect(findingsToPersist([discrepancy])).toEqual([]);
  });
});
