import { describe, expect, it } from "vitest";
import { writingContextPolicy } from "@/domain/characterWritingContext";
import {
  emptyWorldProfile,
  formatGlossedLines,
  formatWorldProfileFieldValue,
  glossedLinesFromEditorRows,
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
  definitionFromKindTemplate,
  getBuiltinWorldProfileDefinition,
  getSubcategorySection,
  isDescriptiveSubcategoryField,
  listAllSubcategorySections,
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
      "organizations:guilds",
      "religion:rituals",
      "languages:dialects",
      "locations:buildings",
      "locations:rooms",
      "magic:workings",
    ]);
  });

  it("reuses membership and adds only missing guild, ritual, and dialect fields", () => {
    const organizations = getBuiltinWorldProfileDefinition("category:organizations");
    const religion = getBuiltinWorldProfileDefinition("category:religion");
    expect(organizations?.fields.some((field) => field.key === "membership")).toBe(true);
    expect(religion?.fields.some((field) => field.key === "rituals" && field.type === "long_text")).toBe(true);

    const guilds = getSubcategorySection("organizations:guilds");
    const rituals = getSubcategorySection("religion:rituals");
    const dialects = getSubcategorySection("languages:dialects");
    expect(guilds?.fields.map((field) => field.key)).toEqual([
      "admissionRequirements",
      "apprenticeshipStages",
      "credentialsIssued",
    ]);
    expect(guilds?.fields.some((field) => field.key === "membership")).toBe(false);
    expect(guilds?.fields.find((field) => field.key === "apprenticeshipStages")?.type).toBe("ordered_list");
    expect(rituals?.fields.map((field) => field.key)).toEqual([
      "ritualOccasion",
      "participantRoles",
      "ritualSteps",
      "ritualVariations",
    ]);
    expect(rituals?.fields.some((field) => field.key === "rituals")).toBe(false);
    expect(rituals?.fields.find((field) => field.key === "ritualSteps")?.type).toBe("ordered_list");
    expect(dialects?.fields.find((field) => field.key === "parentLanguage")).toMatchObject({
      type: "record_ref",
      storage: "profile",
    });
    expect(dialects?.fields.find((field) => field.key === "exampleLines")?.type).toBe("glossed_lines");
    expect(isDescriptiveSubcategoryField("exampleLines")).toBe(true);
    expect(isDescriptiveSubcategoryField("ritualSteps")).toBe(true);
    expect(isDescriptiveSubcategoryField("parentLanguage")).toBe(false);
    expect(isDescriptiveSubcategoryField("membership")).toBe(false);
  });

  it("keeps example lines paired with glosses through read and format", () => {
    const pairs = [
      { line: "Kael tor ven", gloss: "the tide turns" },
      { line: "Vael mir sen", gloss: "the lamp is low" },
    ];
    expect(readWorldProfileFieldValue(pairs)).toEqual(pairs);
    expect(formatWorldProfileFieldValue(pairs)).toBe(
      "Kael tor ven — the tide turns; Vael mir sen — the lamp is low",
    );
    const profile: WorldProfile = {
      ...emptyWorldProfile(),
      definitionId: "category:languages",
      enabledSections: ["languages:dialects"],
      values: { exampleLines: pairs, parentLanguage: { recordId: "rec_parent" } },
    };
    const read = readWorldProfile(withWorldProfile({ kind: "language" }, profile));
    expect(read.ok).toBe(true);
    expect(read.profile.values.exampleLines).toEqual(pairs);
    expect(read.profile.values.parentLanguage).toEqual({ recordId: "rec_parent" });
    expect(validateSubcategorySectionValues(read.profile)).toEqual([]);
  });

  it("keeps a literal pipe in a glossed history row and an optional place record id", () => {
    const stored = glossedLinesFromEditorRows([
      { line: "dock|side call", gloss: "tide | turns" },
      { line: "Workshop door", gloss: "the adjoining workshop", recordId: " rec_shop " },
    ]);
    expect(stored).toEqual([
      { line: "dock|side call", gloss: "tide | turns" },
      { line: "Workshop door", gloss: "the adjoining workshop", recordId: "rec_shop" },
    ]);
    expect(readWorldProfileFieldValue(stored)).toEqual(stored);
    expect(formatWorldProfileFieldValue(stored)).toBe(
      "dock|side call — tide | turns; Workshop door — the adjoining workshop (rec_shop)",
    );
    expect(formatGlossedLines(stored ?? [], new Map([["rec_shop", "Copper Lane Workshop"]]))).toBe(
      "dock|side call — tide | turns; Workshop door — the adjoining workshop (Copper Lane Workshop)",
    );
    expect(formatGlossedLines(stored ?? [], new Map())).toBe(
      "dock|side call — tide | turns; Workshop door — the adjoining workshop",
    );
  });

  it("adds building entrances and room doorways without copying location owners", () => {
    const locations = getBuiltinWorldProfileDefinition("category:locations");
    const owned = ["layout", "atmosphere", "access", "uses", "distinctiveFeatures"];
    for (const key of owned) {
      expect(locations?.fields.some((field) => field.key === key)).toBe(true);
    }
    const buildings = getSubcategorySection("locations:buildings");
    const rooms = getSubcategorySection("locations:rooms");
    expect(buildings?.fields.map((field) => field.key)).toEqual(["entrances"]);
    expect(rooms?.fields.map((field) => field.key)).toEqual(["doorways", "sightlines"]);
    for (const field of [...(buildings?.fields ?? []), ...(rooms?.fields ?? [])]) {
      expect(owned).not.toContain(field.key);
      expect(field.type).toBe("glossed_lines");
      expect(field.continuity).toBe("descriptive");
    }
    expect(buildings?.fields[0]?.glossedConfig?.recordLabel).toBe("Place record id");
    expect(rooms?.fields[0]?.glossedConfig?.recordLabel).toBe("Place record id");
    expect(rooms?.fields[1]?.glossedConfig?.recordLabel).toBeUndefined();
    expect(isDescriptiveSubcategoryField("entrances")).toBe(true);
    expect(isDescriptiveSubcategoryField("doorways")).toBe(true);
    expect(isDescriptiveSubcategoryField("sightlines")).toBe(true);
    expect(isDescriptiveSubcategoryField("layout")).toBe(false);
    expect(isDescriptiveSubcategoryField("access")).toBe(false);
  });

  it("adds magic workings fields without copying source, limits, costs, exceptions, or the overview", () => {
    const magic = getBuiltinWorldProfileDefinition("category:magic");
    const owned = ["source", "limits", "workings", "costs", "exceptions"];
    for (const key of owned) {
      expect(magic?.fields.some((field) => field.key === key)).toBe(true);
    }
    const workings = getSubcategorySection("magic:workings");
    expect(workings?.fields.map((field) => field.key)).toEqual([
      "preconditions",
      "observableSigns",
      "signsOfFailure",
    ]);
    for (const field of workings?.fields ?? []) {
      expect(owned).not.toContain(field.key);
      expect(field.type).toBe("long_text");
      expect(field.continuity).toBe("descriptive");
    }
    expect(isDescriptiveSubcategoryField("preconditions")).toBe(true);
    expect(isDescriptiveSubcategoryField("observableSigns")).toBe(true);
    expect(isDescriptiveSubcategoryField("signsOfFailure")).toBe(true);
    expect(isDescriptiveSubcategoryField("workings")).toBe(false);
    expect(isDescriptiveSubcategoryField("source")).toBe(false);
    expect(
      listSubcategorySectionsForTaxonomy({
        primary: { category: "magic", subcategory: "workings" },
      }).map((section) => section.id),
    ).toEqual(["magic:workings"]);
  });

  it("reads an older profile without enabledSections as an empty list", () => {
    const read = readWorldProfile({
      [WORLD_PROFILE_KEY]: {
        version: 1,
        definitionId: "category:organizations",
        values: { membership: "Journeymen and masters." },
      },
    });
    expect(read.ok).toBe(true);
    expect(read.profile.enabledSections).toEqual([]);
    expect(read.profile.definitionId).toBe("category:organizations");
    expect(read.profile.values.membership).toBe("Journeymen and masters.");
  });

  it("suggests guilds, rituals, and dialects from taxonomy without gating them on the definition", () => {
    const mixed = listSubcategorySectionsForTaxonomy({
      primary: { category: "organizations", subcategory: "guilds" },
      secondary: [
        { category: "religion", subcategory: "rituals" },
        { category: "languages", subcategory: "dialects" },
      ],
    });
    expect(mixed.map((section) => section.id)).toEqual([
      "organizations:guilds",
      "religion:rituals",
      "languages:dialects",
    ]);
    expect(
      listSubcategorySectionsForTaxonomy({
        primary: { category: "languages", subcategory: "dock-cant" },
      }).map((section) => section.id),
    ).toEqual([]);

    const custom = definitionFromKindTemplate({
      id: "wkt_harbor_guild",
      projectId: "prj_home",
      kind: "organization",
      fields: [{ key: "goal", label: "Goal", multiline: false }],
      worldScope: "series",
      home: { projectId: "prj_home", title: "Home Book", bookName: "Home Book" },
      definitionId: "kind:harbor-guild",
      label: "Harbor guild",
      categorySlug: "organizations",
      subcategorySlug: "guilds",
      profileSpecJson: null,
    });
    expect(custom.id).toBe("kind:harbor-guild");
    expect(custom.fields.some((field) => field.key === "membership")).toBe(false);
    expect(listAllSubcategorySections().some((section) => section.id === "organizations:guilds")).toBe(true);

    const profile: WorldProfile = {
      ...emptyWorldProfile(),
      definitionId: custom.id,
      enabledSections: ["organizations:guilds"],
      values: {
        admissionRequirements: "A living sponsor and one finished cask.",
      },
    };
    const fields = withRecordTaxonomy(withWorldProfile({ kind: "organization" }, profile), {
      version: 1,
      primary: { category: "organizations", subcategory: "guilds" },
      secondary: [{ category: "religion", subcategory: "rituals" }],
    });
    const read = readWorldProfile(fields);
    expect(read.profile.definitionId).toBe("kind:harbor-guild");
    expect(read.profile.enabledSections).toEqual(["organizations:guilds"]);
    expect(read.profile.values.admissionRequirements).toBe("A living sponsor and one finished cask.");
    expect(listSubcategorySectionsWithStoredValues(read.profile).map((section) => section.id)).toContain(
      "organizations:guilds",
    );
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
