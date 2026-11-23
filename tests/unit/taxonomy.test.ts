import { describe, expect, it } from "vitest";
import { CHARACTER_DEVELOPMENT_KEY } from "@/domain/characterDevelopment";
import type { RecordNavEntry } from "@/ui/navigation";
import {
  filterWorldByTaxonomy,
  listCustomWorldKinds,
  worldTaxonomyCounts,
} from "@/ui/world";
import { WORLD_KIND_KEYS } from "@/world/referenceTemplates";
import {
  getTaxonomyCategory,
  getTaxonomySubcategory,
  isTaxonomyCategoryId,
  isTaxonomyOnlyFieldsChange,
  LEGACY_KIND_TO_CATEGORY,
  normalizeCustomTaxonomySlug,
  readRecordTaxonomy,
  resolveRecordTaxonomy,
  TAXONOMY_FIELD_KEY,
  TAXONOMY_VERSION,
  taxonomyNavSummary,
  taxonomyOnNonWorldTypeProblems,
  taxonomyWriteProblems,
  withRecordTaxonomy,
  withoutRecordTaxonomy,
  WORLD_TAXONOMY_CATEGORIES,
} from "@/world/taxonomy";

describe("World Hub taxonomy registry", () => {
  it("defines fourteen categories with the planned default subcategories", () => {
    expect(WORLD_TAXONOMY_CATEGORIES.map((c) => c.id)).toEqual([
      "characters",
      "geography",
      "locations",
      "magic",
      "peoples",
      "cultures",
      "religion",
      "organizations",
      "languages",
      "history",
      "economy",
      "technology",
      "objects",
      "law",
    ]);
    expect(getTaxonomyCategory("characters")?.subcategories.map((s) => s.id)).toEqual([
      "protagonists",
      "supporting_characters",
      "antagonists",
      "minor_characters",
    ]);
    expect(getTaxonomyCategory("geography")?.subcategories).toHaveLength(9);
    expect(getTaxonomyCategory("locations")?.subcategories).toHaveLength(6);
    expect(getTaxonomyCategory("magic")?.subcategories.map((s) => s.id)).toEqual([
      "systems",
      "abilities",
      "workings",
      "rules",
      "magical_artifacts",
    ]);
    expect(getTaxonomySubcategory("law", "jurisdiction")?.label).toBe("Jurisdiction");
    expect(isTaxonomyCategoryId("economy")).toBe(true);
    expect(isTaxonomyCategoryId("Economy")).toBe(false);
  });

  it("maps every legacy built-in kind without rewriting fields.kind", () => {
    expect(Object.keys(LEGACY_KIND_TO_CATEGORY).sort()).toEqual([...WORLD_KIND_KEYS].sort());
    for (const kind of WORLD_KIND_KEYS) {
      const fields = { kind, climate: "kept" };
      const resolved = resolveRecordTaxonomy({ type: "worldbuilding", fields });
      expect(resolved.primary?.category).toBe(LEGACY_KIND_TO_CATEGORY[kind]);
      expect(resolved.usedLegacyFallback).toBe(true);
      expect(fields.kind).toBe(kind);
      expect(resolved.isUnclassified).toBe(false);
    }
  });

  it("defaults character dossiers to Characters and reuses importance / narrativeRole", () => {
    expect(resolveRecordTaxonomy({ type: "character_dossier", fields: {} }).primary).toEqual({
      category: "characters",
    });
    expect(
      resolveRecordTaxonomy({
        type: "character_dossier",
        fields: {
          [CHARACTER_DEVELOPMENT_KEY]: { version: 1, importance: "protagonist" },
        },
      }).primary,
    ).toEqual({ category: "characters", subcategory: "protagonists" });
    expect(
      resolveRecordTaxonomy({
        type: "character_dossier",
        fields: {
          [CHARACTER_DEVELOPMENT_KEY]: { version: 1, narrativeRole: "antagonist" },
        },
      }).primary?.subcategory,
    ).toBe("antagonists");
    expect(
      resolveRecordTaxonomy({
        type: "character_dossier",
        fields: {
          [CHARACTER_DEVELOPMENT_KEY]: { version: 1, importance: "supporting" },
        },
      }).primary?.subcategory,
    ).toBe("supporting_characters");
    expect(
      resolveRecordTaxonomy({
        type: "character_dossier",
        fields: {
          [CHARACTER_DEVELOPMENT_KEY]: { version: 1, importance: "minor" },
        },
      }).primary?.subcategory,
    ).toBe("minor_characters");
  });

  it("keeps custom kinds individually discoverable and leaves unclassified records accessible", () => {
    const custom = resolveRecordTaxonomy({
      type: "worldbuilding",
      fields: { kind: "River trade pact" },
    });
    expect(custom.customKind).toBe("River trade pact");
    expect(custom.primary?.category).toBe("River trade pact");
    expect(custom.isUnclassified).toBe(false);

    const unset = resolveRecordTaxonomy({ type: "worldbuilding", fields: {} });
    expect(unset.isUnclassified).toBe(true);
    expect(unset.primary).toBe(null);

    const research = resolveRecordTaxonomy({ type: "research_note", fields: {} });
    expect(research.isUnclassified).toBe(true);

    const rules = resolveRecordTaxonomy({
      type: "rules_glossary",
      fields: {
        taxonomy: { version: 1, primary: { category: "magic", subcategory: "rules" } },
      },
    });
    expect(rules.primary).toEqual({ category: "magic", subcategory: "rules" });
    expect(rules.usedLegacyFallback).toBe(false);
  });

  it("supports primary and secondary memberships without duplicating the record", () => {
    const fields = {
      kind: "organization",
      taxonomy: {
        version: 1,
        primary: { category: "organizations", subcategory: "guilds" },
        secondary: [{ category: "magic", subcategory: "systems" }, { category: "law" }],
        tags: ["salt", "harbour"],
      },
      note: "kept",
    };
    const resolved = resolveRecordTaxonomy({ type: "worldbuilding", fields });
    expect(resolved.memberships).toEqual([
      { category: "organizations", subcategory: "guilds" },
      { category: "magic", subcategory: "systems" },
      { category: "law" },
    ]);
    expect(resolved.tags).toEqual(["salt", "harbour"]);
    expect(fields.kind).toBe("organization");
    expect(fields.note).toBe("kept");

    const nav: RecordNavEntry[] = [
      {
        id: "a",
        title: "Salt Guild",
        type: "worldbuilding",
        parentRecordId: null,
        position: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        worldKind: "organization",
        customKind: null,
        taxonomy: taxonomyNavSummary(resolved),
      },
      {
        id: "b",
        title: "Loose note",
        type: "research_note",
        parentRecordId: null,
        position: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        taxonomy: taxonomyNavSummary(resolveRecordTaxonomy({ type: "research_note", fields: {} })),
      },
      {
        id: "c",
        title: "Pact",
        type: "worldbuilding",
        parentRecordId: null,
        position: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        customKind: "River trade pact",
        taxonomy: taxonomyNavSummary(
          resolveRecordTaxonomy({ type: "worldbuilding", fields: { kind: "River trade pact" } }),
        ),
      },
    ];
    const counts = worldTaxonomyCounts(nav);
    expect(counts.byCategory.organizations).toBe(1);
    expect(counts.byCategory.magic).toBe(1);
    expect(counts.byCategory.law).toBe(1);
    expect(counts.unclassified).toBe(1);
    expect(counts.customKinds["River trade pact"]).toBe(1);
    expect(listCustomWorldKinds(nav)).toEqual(["River trade pact"]);
    expect(filterWorldByTaxonomy(nav, { category: "magic" }).map((r) => r.id)).toEqual(["a"]);
    expect(filterWorldByTaxonomy(nav, { customKind: "River trade pact" }).map((r) => r.id)).toEqual(["c"]);
    expect(filterWorldByTaxonomy(nav, { unclassified: true }).map((r) => r.id)).toEqual(["b"]);
  });

  it("rejects invalid taxonomy metadata and preserves unknown keys", () => {
    expect(taxonomyWriteProblems({ version: 2 })).toEqual([
      { path: `${TAXONOMY_FIELD_KEY}.version`, message: "This taxonomy version is not supported." },
    ]);
    expect(taxonomyWriteProblems({ version: 1, primary: { subcategory: "rules" } }).some((p) => p.path.includes("category"))).toBe(
      true,
    );
    expect(
      taxonomyWriteProblems({
        version: 1,
        primary: { category: "magic" },
        secondary: [{ category: "magic" }],
      }).some((p) => p.message.includes("duplicate the primary")),
    ).toBe(true);
    expect(
      taxonomyWriteProblems({
        version: 1,
        secondary: [
          { category: "law" },
          { category: "law" },
        ],
      }).some((p) => p.message.includes("Duplicate secondary")),
    ).toBe(true);
    expect(
      taxonomyWriteProblems({
        version: 1,
        tags: ["Salt", "salt"],
      }).some((p) => p.message.includes("Duplicate taxonomy tag")),
    ).toBe(true);
    expect(taxonomyOnNonWorldTypeProblems("manuscript_chapter", { taxonomy: { version: 1 } })).toHaveLength(1);
    expect(taxonomyOnNonWorldTypeProblems("rules_glossary", { taxonomy: { version: 1, primary: { category: "magic" } } })).toEqual(
      [],
    );

    const merged = withRecordTaxonomy(
      { kind: "place", future: 1, taxonomy: { version: 1, experimental: true, primary: { category: "locations" } } },
      { version: TAXONOMY_VERSION, primary: { category: "geography", subcategory: "regions" }, tags: ["coast"] },
    );
    expect(merged.kind).toBe("place");
    expect(merged.future).toBe(1);
    expect((merged.taxonomy as { experimental?: boolean }).experimental).toBe(true);
    expect((merged.taxonomy as { primary: { category: string } }).primary.category).toBe("geography");
    expect(withoutRecordTaxonomy(merged).taxonomy).toBeUndefined();
    expect(normalizeCustomTaxonomySlug("  Guild  ")).toBe("Guild");
    expect(readRecordTaxonomy({}).taxonomy).toBe(null);
    expect(isTaxonomyOnlyFieldsChange({ kind: "place" }, { kind: "place", taxonomy: { version: 1 } })).toBe(true);
    expect(isTaxonomyOnlyFieldsChange({ kind: "place" }, { kind: "organization", taxonomy: { version: 1 } })).toBe(false);
  });
});
