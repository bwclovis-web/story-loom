import { describe, expect, it } from "vitest";
import { writingContextPolicy } from "@/domain/characterWritingContext";
import {
  emptyWorldProfile,
  formatWorldProfileFieldValue,
  readWorldProfile,
  readWorldProfileFieldValue,
  WORLD_PROFILE_KEY,
  withWorldProfile,
  worldProfileWriteProblems,
  type WorldProfile,
} from "@/domain/worldProfile";
import { resolveWorldFieldsAtPoint } from "@/domain/worldProfileHistory";
import { redactWorldFieldsForExport, renderWorldContextSlice } from "@/domain/worldWritingContext";
import { withRecordTaxonomy } from "@/world/taxonomy";
import {
  getSubcategorySection,
  listSubcategorySectionsForTaxonomy,
  listSubcategorySectionsWithStoredValues,
  POPULATION_ESTIMATE_FIELD,
  validateSubcategorySectionValues,
  WORLD_SUBCATEGORY_SECTIONS,
} from "@/world/worldProfileRegistry";

describe("W5D subcategory sections and quantity fields", () => {
  it("round-trips WorldProfileQuantity including documented zero vs unknown", () => {
    expect(formatWorldProfileFieldValue({ amount: 12000, qualifier: "about" })).toBe("about 12,000");
    expect(formatWorldProfileFieldValue({ amount: 500, unit: "km²", qualifier: "at_least" })).toBe(
      "at least 500 km²",
    );
    expect(formatWorldProfileFieldValue({ amount: 90, unit: "miles", qualifier: "about" })).toBe(
      "about 90 miles",
    );
    expect(formatWorldProfileFieldValue({ amount: 0 })).toBe("0");
    expect(formatWorldProfileFieldValue({ amount: 0, qualifier: "about" })).toBe("about 0");
    expect(formatWorldProfileFieldValue(null)).toBe("");

    expect(readWorldProfileFieldValue({ amount: 0, qualifier: "about" })).toEqual({
      amount: 0,
      qualifier: "about",
    });
    expect(readWorldProfileFieldValue({ amount: 90, unit: "miles", qualifier: "about" })).toEqual({
      amount: 90,
      unit: "miles",
      qualifier: "about",
    });
    expect(readWorldProfileFieldValue(null)).toBeNull();
    expect(readWorldProfileFieldValue({ amount: Number.NaN })).toBeNull();

    const problems = worldProfileWriteProblems({
      version: 1,
      values: { populationEstimate: { amount: 0, qualifier: "about" } },
      enabledSections: ["geography:cities_and_settlements"],
    });
    expect(problems).toEqual([]);
  });

  it("shares POPULATION_ESTIMATE_FIELD across cities and regions", () => {
    const cities = getSubcategorySection("geography:cities_and_settlements");
    const regions = getSubcategorySection("geography:regions");
    expect(cities).toBeTruthy();
    expect(regions).toBeTruthy();
    expect(cities!.fields.find((f) => f.key === "populationEstimate")).toBe(POPULATION_ESTIMATE_FIELD);
    expect(regions!.fields.find((f) => f.key === "populationEstimate")).toBe(POPULATION_ESTIMATE_FIELD);
    expect(WORLD_SUBCATEGORY_SECTIONS.map((s) => s.id)).toEqual([
      "geography:cities_and_settlements",
      "geography:regions",
      "geography:waterways",
    ]);
  });

  it("keeps definitionId, enabledSections, and values sticky across taxonomy edits", () => {
    const profile: WorldProfile = {
      ...emptyWorldProfile(),
      definitionId: "category:geography",
      enabledSections: ["geography:cities_and_settlements"],
      values: {
        populationEstimate: { amount: 12000, qualifier: "about" },
        principalIndustries: ["Salt curing", "Shipwrighting"],
      },
    };
    let fields = withWorldProfile(
      {
        kind: "place",
        taxonomy: {
          version: 1,
          primary: { category: "geography", subcategory: "cities_and_settlements" },
        },
      },
      profile,
    );
    fields = withRecordTaxonomy(fields, {
      version: 1,
      primary: { category: "geography", subcategory: "regions" },
      secondary: [{ category: "economy", subcategory: "trade" }],
    });
    const read = readWorldProfile(fields);
    expect(read.ok).toBe(true);
    expect(read.profile.definitionId).toBe("category:geography");
    expect(read.profile.enabledSections).toEqual(["geography:cities_and_settlements"]);
    expect(read.profile.values.populationEstimate).toEqual({ amount: 12000, qualifier: "about" });

    const suggested = listSubcategorySectionsForTaxonomy({
      primary: { category: "geography", subcategory: "regions" },
      secondary: [{ category: "economy", subcategory: "trade" }],
    });
    expect(suggested.map((s) => s.id)).toEqual(["geography:regions"]);

    const discoverable = listSubcategorySectionsWithStoredValues(read.profile);
    expect(discoverable.map((s) => s.id)).toContain("geography:cities_and_settlements");
  });

  it("validates quantity section values and preserves amount 0", () => {
    const profile: WorldProfile = {
      ...emptyWorldProfile(),
      enabledSections: ["geography:waterways"],
      values: {
        length: { amount: 0, unit: "miles", qualifier: "about" },
        waterwaySource: "Greycrag Springs",
      },
    };
    expect(validateSubcategorySectionValues(profile)).toEqual([]);
    expect(formatWorldProfileFieldValue(profile.values.length!)).toBe("about 0 miles");
  });

  it("keeps undated quantity estimates unknown for W5C/W7A earlier-scene drafting", () => {
    const profile: WorldProfile = {
      ...emptyWorldProfile(),
      definitionId: "category:geography",
      enabledSections: ["geography:cities_and_settlements"],
      values: {
        populationEstimate: { amount: 12000, qualifier: "about" },
      },
    };
    const fields = withWorldProfile({}, profile);
    const resolved = resolveWorldFieldsAtPoint(
      profile,
      {
        bookProjectId: "prj_1",
        storyEventId: "sev_early",
        chapterRecordId: null,
        sceneRecordId: null,
        sequence: null,
        boundary: "at_point",
      },
      [],
      { fieldPaths: ["values.populationEstimate"] },
    );
    expect(resolved.fields["values.populationEstimate"]?.presence).toBe("unknown");

    const slice = renderWorldContextSlice({
      recordId: "rec_city",
      title: "Harbor Town",
      fields,
      body: "## Population estimate\n\nabout 12,000",
      mode: "drafting",
      point: {
        bookProjectId: "prj_1",
        storyEventId: "sev_early",
        chapterRecordId: null,
        sceneRecordId: null,
        sequence: null,
        boundary: "at_point",
      },
      viewingProjectId: "prj_1",
    });
    expect(slice.text).not.toMatch(/about 12,000/);
    expect(slice.meta.omissions.some((o) => /Undated current world value/i.test(o.reason))).toBe(true);

    const redacted = redactWorldFieldsForExport(fields, writingContextPolicy("drafting"), {
      point: {
        bookProjectId: "prj_1",
        storyEventId: "sev_early",
        chapterRecordId: null,
        sceneRecordId: null,
        sequence: null,
        boundary: "at_point",
      },
      viewingProjectId: "prj_1",
    });
    const overlay = redacted[WORLD_PROFILE_KEY] as { values?: Record<string, unknown> } | undefined;
    expect(overlay?.values?.populationEstimate).toBeUndefined();
  });
});
