import { describe, expect, it } from "vitest";
import { parseSmartCollectionFilter } from "@/domain/smartCollection";
import { projectWorldHubRecord, worldHubHref } from "@/world/hubDiscovery";
import {
  applyWorldCollectionFilter,
  collectionFilterFromWorldHubQuery,
  summarizeWorldCollectionFilter,
  unsupportedWorldCollectionFilters,
  worldCollectionHasSavableFilters,
  worldHubQueryFromCollectionFilter,
} from "@/world/worldHubCollections";

describe("worldHubCollections", () => {
  const station = projectWorldHubRecord({
    id: "rec_station",
    title: "Saltmarsh Station",
    type: "worldbuilding",
    authorityStatus: "approved",
    protected: false,
    currentRevision: 1,
    worldScope: "series",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    fields: {
      kind: "place",
      taxonomy: {
        version: 1,
        primary: { category: "locations" },
        secondary: [{ category: "technology", subcategory: "transportation" }],
      },
    },
    home: { projectId: "prj_b1", title: "Book One", bookName: "Book One" },
  });

  const ferry = projectWorldHubRecord({
    id: "rec_ferry",
    title: "Harbor Ferry",
    type: "worldbuilding",
    authorityStatus: "draft",
    protected: false,
    currentRevision: 1,
    worldScope: "book",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-03T00:00:00.000Z",
    fields: {
      kind: "place",
      taxonomy: {
        version: 1,
        primary: { category: "technology", subcategory: "transportation" },
      },
    },
    home: null,
  });

  it("round-trips Hub filters through SmartCollectionFilter stable ids", () => {
    const query = {
      type: null,
      kind: null,
      q: "",
      list: true,
      category: "technology",
      subcategory: "transportation",
      tag: null,
      customKind: null,
      unclassified: false,
      scope: null,
      status: null,
      protected: null,
      sort: "title" as const,
      view: "cards" as const,
    };
    const filter = collectionFilterFromWorldHubQuery(query);
    expect(filter).toMatchObject({
      category: "technology",
      subcategory: "transportation",
      sort: "title",
      view: "cards",
      list: true,
    });
    const restored = worldHubQueryFromCollectionFilter(filter);
    expect(restored.category).toBe("technology");
    expect(restored.subcategory).toBe("transportation");
    expect(restored.sort).toBe("title");
    expect(restored.view).toBe("cards");
    expect(restored.list).toBe(true);
    expect(worldCollectionHasSavableFilters(query)).toBe(true);
    expect(unsupportedWorldCollectionFilters(query)).toEqual([]);
    expect(summarizeWorldCollectionFilter(filter)).toContain("Technology");
    expect(summarizeWorldCollectionFilter(filter)).toContain("Transportation");
  });

  it("parses older manuscript filterJson without dropping unknown-safe world fields", () => {
    const filter = parseSmartCollectionFilter({
      query: "river",
      pov: "Mira",
      category: "technology",
      subcategory: "transportation",
      hubScope: "series",
    });
    expect(filter.query).toBe("river");
    expect(filter.pov).toBe("Mira");
    expect(filter.category).toBe("technology");
    expect(filter.hubScope).toBe("series");
  });

  it("matches secondary Technology → Transportation once by Record.id", () => {
    const filter = collectionFilterFromWorldHubQuery({
      type: null,
      kind: null,
      q: "",
      list: true,
      category: "technology",
      subcategory: "transportation",
      tag: null,
      customKind: null,
      unclassified: false,
      scope: null,
      status: null,
      protected: null,
      sort: "updated",
      view: "list",
    });
    const matched = applyWorldCollectionFilter([station, ferry], filter);
    expect(matched.map((r) => r.id).sort()).toEqual(["rec_ferry", "rec_station"]);
    expect(matched.filter((r) => r.id === "rec_station")).toHaveLength(1);
  });

  it("open href restores filters and collection id", () => {
    const href = worldHubHref("prj_b2", {
      category: "technology",
      subcategory: "transportation",
      list: true,
      collection: "scol_transport",
    });
    expect(href).toContain("category=technology");
    expect(href).toContain("subcategory=transportation");
    expect(href).toContain("collection=scol_transport");
    expect(href).toContain("list=1");
  });
});
