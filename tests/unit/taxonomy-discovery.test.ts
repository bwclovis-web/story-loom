import { describe, expect, it } from "vitest";
import {
  emptyTaxonomyFilter,
  filterBoardCardsByTaxonomy,
  filterMapPinsByTaxonomy,
  filterPlaceableRecords,
  recordMatchesTaxonomyFilter,
  TAXONOMY_FILTER_UNCLASSIFIED,
  type PlaceableRecord,
} from "@/world/taxonomyDiscovery";
import { resolveRecordTaxonomy, taxonomyNavSummary } from "@/world/taxonomy";
import {
  checkRelationshipEligibility,
  filterGraphByTaxonomy,
  type RelationshipEdge,
  type RelationshipNode,
} from "@/world/relationshipGraph";

function placeable(
  partial: Pick<PlaceableRecord, "id" | "title"> & Partial<PlaceableRecord> & { fields?: Record<string, unknown>; type?: string },
): PlaceableRecord {
  const type = partial.type ?? "worldbuilding";
  const fields = partial.fields ?? {};
  return {
    id: partial.id,
    title: partial.title,
    typeLabel: partial.typeLabel ?? "Worldbuilding",
    homeLabel: partial.homeLabel ?? null,
    worldScope: partial.worldScope ?? null,
    taxonomy:
      partial.taxonomy ??
      taxonomyNavSummary(resolveRecordTaxonomy({ type: type as "worldbuilding", fields })),
  };
}

const station = placeable({
  id: "rec_station",
  title: "Saltmarsh Station",
  homeLabel: "Book One",
  worldScope: "series",
  fields: {
    kind: "place",
    taxonomy: {
      version: 1,
      primary: { category: "locations" },
      secondary: [{ category: "technology", subcategory: "transportation" }],
    },
  },
});

const guild = placeable({
  id: "rec_guild",
  title: "Harbor Guild",
  fields: {
    kind: "organization",
    taxonomy: { version: 1, primary: { category: "organizations", subcategory: "guilds" } },
  },
});

const loose = placeable({
  id: "rec_loose",
  title: "Loose note",
  type: "reference_note",
  fields: {},
});

describe("taxonomy discovery filters", () => {
  it("matches primary and secondary memberships like the World Hub", () => {
    expect(recordMatchesTaxonomyFilter(station.taxonomy, { category: "locations", subcategory: null })).toBe(true);
    expect(
      recordMatchesTaxonomyFilter(station.taxonomy, {
        category: "technology",
        subcategory: "transportation",
      }),
    ).toBe(true);
    expect(recordMatchesTaxonomyFilter(station.taxonomy, { category: "organizations", subcategory: null })).toBe(
      false,
    );
  });

  it("deduplicates by Record.id and supports title search", () => {
    const rows = filterPlaceableRecords([station, station, guild], {
      query: "station",
      category: "locations",
    });
    expect(rows.map((r) => r.id)).toEqual(["rec_station"]);
  });

  it("keeps legacy kind fallbacks and unclassified sentinel", () => {
    const legacy = placeable({
      id: "rec_legacy",
      title: "Old Place",
      fields: { kind: "place" },
    });
    expect(recordMatchesTaxonomyFilter(legacy.taxonomy, { category: "locations", subcategory: null })).toBe(true);
    expect(
      recordMatchesTaxonomyFilter(loose.taxonomy, {
        category: TAXONOMY_FILTER_UNCLASSIFIED,
        subcategory: null,
      }),
    ).toBe(true);
  });

  it("dims unlinked map pins when taxonomy is active and keeps multiple matching pins", () => {
    const taxonomyById = new Map([[station.id, station.taxonomy]]);
    const result = filterMapPinsByTaxonomy(
      [
        { recordId: station.id },
        { recordId: station.id },
        { recordId: null },
        { recordId: "missing", unavailable: true },
      ],
      { category: "locations", subcategory: null },
      taxonomyById,
    );
    expect(result.map((row) => row.match)).toEqual([true, true, false, false]);
  });

  it("hides note and unlinked image cards under taxonomy filters without dropping stored cards", () => {
    const cards = [
      { id: "c1", kind: "record", recordId: station.id, x: 10, y: 20 },
      { id: "c2", kind: "image", recordId: station.id, x: 30, y: 40 },
      { id: "c3", kind: "note", recordId: null, x: 50, y: 60 },
      { id: "c4", kind: "image", recordId: null, x: 70, y: 80 },
    ];
    const taxonomyById = new Map([[station.id, station.taxonomy]]);
    const visible = filterBoardCardsByTaxonomy(
      cards,
      { category: "technology", subcategory: "transportation" },
      taxonomyById,
      "all",
    );
    expect(visible.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(cards.map((c) => ({ id: c.id, x: c.x, y: c.y }))).toEqual([
      { id: "c1", x: 10, y: 20 },
      { id: "c2", x: 30, y: 40 },
      { id: "c3", x: 50, y: 60 },
      { id: "c4", x: 70, y: 80 },
    ]);
    expect(filterBoardCardsByTaxonomy(cards, emptyTaxonomyFilter(), taxonomyById, "all")).toHaveLength(4);
  });
});

describe("relationship taxonomy + eligibility", () => {
  const nodes: RelationshipNode[] = [
    { id: station.id, title: station.title, typeLabel: "Worldbuilding", taxonomy: station.taxonomy },
    { id: guild.id, title: guild.title, typeLabel: "Worldbuilding", taxonomy: guild.taxonomy },
    { id: "rec_river", title: "River", typeLabel: "Worldbuilding", taxonomy: null },
  ];
  const edges: RelationshipEdge[] = [
    {
      id: "e1",
      fromRecordId: station.id,
      toRecordId: guild.id,
      kind: "governed_by",
      kindLabel: "Governed by",
      family: "place",
    },
    {
      id: "e2",
      fromRecordId: guild.id,
      toRecordId: "rec_river",
      kind: "part_of",
      kindLabel: "Part of",
      family: "place",
    },
  ];

  it("supports matching_only and with_neighbors modes", () => {
    const matching = filterGraphByTaxonomy(
      nodes,
      edges,
      { category: "locations", subcategory: null },
      "matching_only",
    );
    expect(matching.nodes.map((n) => n.id)).toEqual([station.id]);
    expect(matching.edges).toHaveLength(0);

    const neighbors = filterGraphByTaxonomy(
      nodes,
      edges,
      { category: "locations", subcategory: null },
      "with_neighbors",
    );
    expect(neighbors.matchingIds.has(station.id)).toBe(true);
    expect(neighbors.neighborIds.has(guild.id)).toBe(true);
    expect(neighbors.nodes.map((n) => n.id).sort()).toEqual([guild.id, station.id].sort());
    expect(neighbors.edges).toHaveLength(1);
  });

  it("reports series and endpoint eligibility separately from taxonomy", () => {
    expect(
      checkRelationshipEligibility({
        from: { id: "a", recordType: "research_note", worldScope: "series" },
        to: { id: "b", recordType: "character_dossier", worldScope: "series" },
        family: "record",
        scope: "book",
        seriesNamed: true,
      })?.code,
    ).toBe("endpoint_type");
    expect(
      checkRelationshipEligibility({
        from: { id: "a", recordType: "character_dossier", worldScope: "book" },
        to: { id: "b", recordType: "character_dossier", worldScope: "series" },
        family: "record",
        scope: "series",
        seriesNamed: true,
      })?.code,
    ).toBe("series_scope");
    expect(
      checkRelationshipEligibility({
        from: { id: "a", recordType: "character_dossier", worldScope: "series" },
        to: { id: "b", recordType: "character_dossier", worldScope: "series" },
        family: "record",
        scope: "series",
        seriesNamed: false,
      })?.code,
    ).toBe("series_scope");
  });
});
