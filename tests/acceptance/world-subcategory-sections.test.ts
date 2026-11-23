import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { JsonObject } from "@/domain/json";
import {
  emptyWorldProfile,
  formatWorldProfileFieldValue,
  readWorldProfile,
  withWorldProfile,
  type WorldFieldHistoryChange,
  type WorldProfile,
} from "@/domain/worldProfile";
import { resolveWorldFieldsAtPoint } from "@/domain/worldProfileHistory";
import { redactWorldFieldsForExport, renderWorldContextSlice } from "@/domain/worldWritingContext";
import { writingContextPolicy } from "@/domain/characterWritingContext";
import { createProject, createWorkspace } from "@/server/services/projectService";
import { addPlaceRelation, listPlaceRelationsForRecord } from "@/server/services/placeRelationService";
import { createRecord, getRecord, updateRecord } from "@/server/services/recordService";
import { saveWorldProfileOverlay } from "@/server/services/worldProfileUpgradeService";
import { withRecordTaxonomy } from "@/world/taxonomy";
import { createTestDb, type TestDb } from "../helpers";

const WSP = "wsp_w5d";
const BOOK = "prj_w5d_book";
const CITY = "rec_w5d_city";
const RIVER = "rec_w5d_river";
const SEA = "rec_w5d_sea";

function historyChange(
  partial: Partial<WorldFieldHistoryChange> & Pick<WorldFieldHistoryChange, "id" | "fieldPath" | "value">,
): WorldFieldHistoryChange {
  return {
    definitionId: "category:geography",
    storage: "profile",
    presence: "set",
    approval: "approved",
    planned: false,
    provenance: { origin: "author", note: "" },
    bookProjectId: BOOK,
    storyEventId: "sev_w5d_dated",
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

describe("W5D Geography subcategory sections", () => {
  let t: TestDb;

  beforeEach(async () => {
    t = await createTestDb();
    await createWorkspace(t.db, { id: WSP, name: "W5D Workspace" });
    await createProject(t.db, { id: BOOK, workspaceId: WSP, title: "W5D Book" });
  }, 15_000);

  afterEach(async () => {
    await t.cleanup();
  });

  it("saves city population about 12,000, keeps documented 0 vs unknown, and survives secondary taxonomy edits", async () => {
    await createRecord(t.db, BOOK, {
      recordId: CITY,
      type: "worldbuilding",
      title: "Salt Harbor",
      body: "A curing town.",
      fields: withRecordTaxonomy(
        { kind: "place" },
        {
          version: 1,
          primary: { category: "geography", subcategory: "cities_and_settlements" },
        },
      ),
      authorityStatus: "approved",
    });

    const cityProfile: WorldProfile = {
      ...emptyWorldProfile(),
      definitionId: "category:geography",
      enabledSections: ["geography:cities_and_settlements"],
      values: {
        populationEstimate: { amount: 12000, qualifier: "about" },
        principalIndustries: ["Salt curing", "Shipwrighting"],
      },
    };
    const saved = await saveWorldProfileOverlay(t.db, {
      projectId: BOOK,
      recordId: CITY,
      expectedRevision: 1,
      profile: cityProfile,
    });
    expect(saved.revision).toBeGreaterThan(1);

    const reopened = await getRecord(t.db, BOOK, CITY);
    const read = readWorldProfile(reopened.fields);
    expect(read.ok).toBe(true);
    expect(read.profile.definitionId).toBe("category:geography");
    expect(read.profile.enabledSections).toEqual(["geography:cities_and_settlements"]);
    expect(formatWorldProfileFieldValue(read.profile.values.populationEstimate ?? null)).toBe("about 12,000");
    expect(read.profile.values.principalIndustries).toEqual(["Salt curing", "Shipwrighting"]);

    const withZero: WorldProfile = {
      ...read.profile,
      values: {
        ...read.profile.values,
        populationEstimate: { amount: 0, qualifier: "about" },
      },
    };
    await saveWorldProfileOverlay(t.db, {
      projectId: BOOK,
      recordId: CITY,
      expectedRevision: reopened.currentRevision,
      profile: withZero,
    });
    const zeroRead = readWorldProfile((await getRecord(t.db, BOOK, CITY)).fields);
    expect(zeroRead.profile.values.populationEstimate).toEqual({ amount: 0, qualifier: "about" });
    expect(formatWorldProfileFieldValue(zeroRead.profile.values.populationEstimate ?? null)).toBe("about 0");

    const withUnknown: WorldProfile = {
      ...zeroRead.profile,
      values: {
        ...zeroRead.profile.values,
        populationEstimate: null,
      },
    };
    const unknownSaved = await saveWorldProfileOverlay(t.db, {
      projectId: BOOK,
      recordId: CITY,
      expectedRevision: (await getRecord(t.db, BOOK, CITY)).currentRevision,
      profile: withUnknown,
    });
    const unknownRecord = await getRecord(t.db, BOOK, CITY);
    expect(unknownSaved.revision).toBe(unknownRecord.currentRevision);
    expect(readWorldProfile(unknownRecord.fields).profile.values.populationEstimate ?? null).toBeNull();

    await updateRecord(t.db, BOOK, {
      recordId: CITY,
      expectedRevision: unknownRecord.currentRevision,
      fields: withRecordTaxonomy(unknownRecord.fields as JsonObject, {
        version: 1,
        primary: { category: "geography", subcategory: "cities_and_settlements" },
        secondary: [{ category: "economy", subcategory: "trade" }],
      }),
    });
    const afterTaxonomy = readWorldProfile((await getRecord(t.db, BOOK, CITY)).fields);
    expect(afterTaxonomy.profile.definitionId).toBe("category:geography");
    expect(afterTaxonomy.profile.enabledSections).toEqual(["geography:cities_and_settlements"]);
  });

  it("saves river length about 90 miles and reuses flows_into for outlet", async () => {
    await createRecord(t.db, BOOK, {
      recordId: SEA,
      type: "worldbuilding",
      title: "Grey Sea",
      body: "Open water.",
      fields: { kind: "place" },
      authorityStatus: "approved",
    });
    await createRecord(t.db, BOOK, {
      recordId: RIVER,
      type: "worldbuilding",
      title: "Silverwater",
      body: "A long river.",
      fields: withRecordTaxonomy(
        { kind: "place" },
        {
          version: 1,
          primary: { category: "geography", subcategory: "waterways" },
        },
      ),
      authorityStatus: "approved",
    });
    await addPlaceRelation(t.db, BOOK, {
      fromRecordId: RIVER,
      toRecordId: SEA,
      kind: "flows_into",
    });
    const relations = await listPlaceRelationsForRecord(t.db, BOOK, RIVER);
    expect(relations.outgoing.some((row) => row.kind === "flows_into" && row.toRecordId === SEA)).toBe(true);

    const riverProfile: WorldProfile = {
      ...emptyWorldProfile(),
      definitionId: "category:geography",
      enabledSections: ["geography:waterways"],
      values: {
        length: { amount: 90, unit: "miles", qualifier: "about" },
        waterwaySource: "Greycrag Springs",
        outlet: { recordId: SEA },
        navigableStretches: "Lower 30 miles",
      },
    };
    await saveWorldProfileOverlay(t.db, {
      projectId: BOOK,
      recordId: RIVER,
      expectedRevision: 1,
      profile: riverProfile,
    });

    const reopened = readWorldProfile((await getRecord(t.db, BOOK, RIVER)).fields);
    expect(formatWorldProfileFieldValue(reopened.profile.values.length ?? null)).toBe("about 90 miles");
    expect(reopened.profile.values.waterwaySource).toBe("Greycrag Springs");
    expect(reopened.profile.values.outlet).toEqual({ recordId: SEA });
    expect(reopened.profile.values.navigableStretches).toBe("Lower 30 miles");

    const riverBeforeSecondary = await getRecord(t.db, BOOK, RIVER);
    await updateRecord(t.db, BOOK, {
      recordId: RIVER,
      expectedRevision: riverBeforeSecondary.currentRevision,
      fields: withRecordTaxonomy(riverBeforeSecondary.fields as JsonObject, {
        version: 1,
        primary: { category: "geography", subcategory: "waterways" },
        secondary: [{ category: "locations" }],
      }),
    });
    const afterSecondary = readWorldProfile((await getRecord(t.db, BOOK, RIVER)).fields);
    expect(afterSecondary.profile.definitionId).toBe("category:geography");
    expect(afterSecondary.profile.enabledSections).toEqual(["geography:waterways"]);
    expect(formatWorldProfileFieldValue(afterSecondary.profile.values.length ?? null)).toBe("about 90 miles");
    const stillFlows = await listPlaceRelationsForRecord(t.db, BOOK, RIVER);
    expect(stillFlows.outgoing.some((row) => row.kind === "flows_into" && row.toRecordId === SEA)).toBe(true);
  });

  it("keeps undated estimates unknown for earlier drafting and resolves dated history", async () => {
    const undated: WorldProfile = {
      ...emptyWorldProfile(),
      definitionId: "category:geography",
      enabledSections: ["geography:cities_and_settlements", "geography:waterways"],
      values: {
        populationEstimate: { amount: 12000, qualifier: "about" },
        length: { amount: 90, unit: "miles", qualifier: "about" },
      },
    };
    const fields = withWorldProfile({ kind: "place" }, undated);
    const earlyPoint = {
      bookProjectId: BOOK,
      storyEventId: "sev_w5d_early",
      chapterRecordId: null,
      sceneRecordId: null,
      sequence: null,
      boundary: "at_point" as const,
    };
    const undatedResolved = resolveWorldFieldsAtPoint(undated, earlyPoint, [], {
      fieldPaths: ["values.populationEstimate", "values.length"],
    });
    expect(undatedResolved.fields["values.populationEstimate"]?.presence).toBe("unknown");
    expect(undatedResolved.fields["values.length"]?.presence).toBe("unknown");

    const drafting = renderWorldContextSlice({
      title: "Harbor",
      recordId: CITY,
      fields,
      mode: "drafting",
      point: earlyPoint,
      viewingProjectId: BOOK,
    });
    expect(drafting.text).not.toMatch(/about 12,000|about 90 miles/);
    expect(drafting.meta.omissions.some((o) => /Undated current world value/i.test(o.reason))).toBe(true);

    const redacted = redactWorldFieldsForExport(fields, writingContextPolicy("drafting"), {
      point: earlyPoint,
      viewingProjectId: BOOK,
    });
    const redactedProfile = readWorldProfile(redacted).profile;
    expect(redactedProfile.values.populationEstimate).toBeUndefined();
    expect(redactedProfile.values.length).toBeUndefined();

    const dated: WorldProfile = {
      ...undated,
      fieldHistory: [
        historyChange({
          id: "wfh_pop",
          fieldPath: "values.populationEstimate",
          value: { amount: 12000, qualifier: "about" },
          storyEventId: "sev_w5d_dated",
        }),
        historyChange({
          id: "wfh_len",
          fieldPath: "values.length",
          value: { amount: 90, unit: "miles", qualifier: "about" },
          storyEventId: "sev_w5d_dated",
        }),
      ],
    };
    const datedPoint = {
      bookProjectId: BOOK,
      storyEventId: "sev_w5d_dated",
      chapterRecordId: null,
      sceneRecordId: null,
      sequence: null,
      boundary: "at_point" as const,
    };
    const datedResolved = resolveWorldFieldsAtPoint(dated, datedPoint, [], {
      fieldPaths: ["values.populationEstimate", "values.length"],
    });
    expect(datedResolved.fields["values.populationEstimate"]).toMatchObject({
      presence: "set",
      formatted: "about 12,000",
    });
    expect(datedResolved.fields["values.length"]).toMatchObject({
      presence: "set",
      formatted: "about 90 miles",
    });

    const datedSlice = renderWorldContextSlice({
      title: "Harbor",
      recordId: CITY,
      fields: withWorldProfile({ kind: "place" }, dated),
      mode: "drafting",
      point: datedPoint,
      viewingProjectId: BOOK,
    });
    expect(datedSlice.text).toMatch(/about 12,000/);
    expect(datedSlice.text).toMatch(/about 90 miles/);
  });
});
