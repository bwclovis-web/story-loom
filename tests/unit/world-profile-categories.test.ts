import { describe, expect, it } from "vitest";
import {
  emptyWorldProfile,
  withWorldProfile,
  worldProfileOnUnsupportedTypeProblems,
} from "@/domain/worldProfile";
import { analyzeWorldProfileUpgrade } from "@/domain/worldProfileUpgrade";
import {
  getBuiltinWorldProfileDefinition,
  listBuiltinWorldProfileDefinitions,
  listPlausibleWorldProfileDefinitions,
  resolveWorldProfileDefinition,
  WORLD_PROFILE_CATEGORY_IDS,
} from "@/world/worldProfileRegistry";
import { withRecordTaxonomy, type RecordTaxonomyV1 } from "@/world/taxonomy";

describe("W5B category Living World Profiles", () => {
  it("ships all 13 non-character category definitions with optional fields", () => {
    for (const id of WORLD_PROFILE_CATEGORY_IDS) {
      const definition = getBuiltinWorldProfileDefinition(`category:${id}`);
      expect(definition, id).toBeTruthy();
      expect(definition!.fields.length).toBeGreaterThan(0);
      expect(definition!.fields.every((field) => field.optional !== false)).toBe(true);
    }
    expect(listBuiltinWorldProfileDefinitions().some((d) => d.id === "category:characters")).toBe(false);
  });

  it("reuses flat place climate on geography and locations instead of duplicating it", () => {
    const geography = getBuiltinWorldProfileDefinition("category:geography")!;
    const climate = geography.fields.find((field) => field.key === "climate");
    expect(climate?.storage).toBe("flat");
    expect(geography.fields.some((field) => field.key === "climateSummary")).toBe(false);
    expect(geography.fields.map((field) => field.key)).toEqual(
      expect.arrayContaining(["terrain", "boundaries", "waterways", "travelConstraints"]),
    );

    const locations = getBuiltinWorldProfileDefinition("category:locations")!;
    expect(locations.fields.find((field) => field.key === "climate")?.storage).toBe("flat");
    expect(locations.fields.map((field) => field.key)).toEqual(
      expect.arrayContaining(["layout", "atmosphere", "access", "uses", "distinctiveFeatures"]),
    );
  });

  it("reuses magic_system flat source/limits and adds workings/costs/exceptions", () => {
    const magic = getBuiltinWorldProfileDefinition("category:magic")!;
    expect(magic.fields.find((field) => field.key === "source")?.storage).toBe("flat");
    expect(magic.fields.find((field) => field.key === "limits")?.storage).toBe("flat");
    expect(magic.fields.find((field) => field.key === "costs")?.storage).toBe("profile");
    expect(magic.fields.find((field) => field.key === "workings")?.storage).toBe("profile");
    expect(magic.fields.find((field) => field.key === "exceptions")?.storage).toBe("profile");
  });

  it("keeps an explicit definition sticky when taxonomy gains a secondary category", () => {
    const fields = withWorldProfile(
      withRecordTaxonomy(
        { kind: "place", climate: "Wet winters" },
        {
          version: 1,
          primary: { category: "geography", subcategory: "cities_and_settlements" },
        } satisfies RecordTaxonomyV1,
      ),
      { ...emptyWorldProfile(), definitionId: "category:geography", values: { terrain: "Cliffs" } },
    );
    const withReligion = withRecordTaxonomy(fields, {
      version: 1,
      primary: { category: "geography", subcategory: "cities_and_settlements" },
      secondary: [{ category: "religion", subcategory: "sacred_places" }],
      tags: ["harbor"],
    });
    const resolved = resolveWorldProfileDefinition({
      fields: withReligion,
      profile: { ...emptyWorldProfile(), definitionId: "category:geography", values: { terrain: "Cliffs" } },
      categorySlugs: ["geography", "religion"],
    });
    expect(resolved?.id).toBe("category:geography");
    expect(resolved?.fields.some((field) => field.key === "terrain")).toBe(true);
  });

  it("offers an author choice when place kind and geography taxonomy both apply", () => {
    const plausible = listPlausibleWorldProfileDefinitions({
      fields: { kind: "place", climate: "Fog" },
      categorySlugs: ["geography", "locations"],
    });
    const ids = plausible.map((item) => item.id);
    expect(ids).toEqual(expect.arrayContaining(["builtin:place", "category:geography", "category:locations"]));
    const resolved = resolveWorldProfileDefinition({
      fields: { kind: "place", climate: "Fog" },
      categorySlugs: ["geography", "locations"],
      categorySlug: "geography",
    });
    expect(resolved).toBeNull();
  });

  it("auto-resolves when only one built-in fits", () => {
    const resolved = resolveWorldProfileDefinition({
      fields: { kind: "place", climate: "Fog" },
    });
    expect(resolved?.id).toBe("builtin:place");
  });

  it("maps Costs and Limits headings on a magic definition", () => {
    const magic = getBuiltinWorldProfileDefinition("category:magic")!;
    const body = `## Costs\nBlood and breath.\n\n## Limits\nCannot raise the dead.\n\n## Workings\nSpoken knots.\n`;
    const analysis = analyzeWorldProfileUpgrade(body, emptyWorldProfile(), { kind: "magic_system" }, magic);
    const byHeading = Object.fromEntries(analysis.items.map((item) => [item.sourceHeading, item]));
    expect(byHeading.Costs?.fieldPath).toBe("costs");
    expect(byHeading.Limits?.fieldPath).toBe("limits");
    expect(byHeading.Workings?.fieldPath).toBe("workings");
  });

  it("leaves character dossiers on characterDevelopment, not world profiles", () => {
    const fields = withWorldProfile({}, { ...emptyWorldProfile(), summary: "nope" });
    expect(worldProfileOnUnsupportedTypeProblems("character_dossier", fields).length).toBeGreaterThan(0);
  });

  it("prefers a home-project custom template over a sibling template of the same kind name", () => {
    const resolved = resolveWorldProfileDefinition({
      fields: { kind: "harbor_league" },
      recordProjectId: "prj_home",
      templates: [
        {
          id: "wkt_home",
          projectId: "prj_home",
          kind: "harbor_league",
          fields: [{ key: "dockFees", label: "Home dock fees", multiline: false }],
          worldScope: null,
          home: null,
          definitionId: "custom:harbor_home",
          label: "Home harbor labels",
          profileSpecJson: null,
        },
        {
          id: "wkt_sibling",
          projectId: "prj_sib",
          kind: "harbor_league",
          fields: [{ key: "dockFees", label: "Sibling dock fees", multiline: false }],
          worldScope: "series",
          home: { projectId: "prj_sib", title: "Book Two", bookName: "Book Two" },
          definitionId: "custom:harbor_sibling",
          label: "Sibling harbor labels",
          profileSpecJson: null,
        },
      ],
    });
    expect(resolved?.id).toBe("custom:harbor_home");
    expect(resolved?.label).toBe("Home harbor labels");
  });
});
