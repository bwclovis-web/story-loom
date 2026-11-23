import { describe, expect, it } from "vitest";
import { parseMapClassification } from "@/world/mapClassification";
import { filterAndSortMaps, parseMapLibraryFilter, parseMapLibrarySort, type MapLibraryItem } from "@/world/mapLibrary";

function map(partial: Partial<MapLibraryItem> & Pick<MapLibraryItem, "id" | "title">): MapLibraryItem {
  return {
    imageId: "img_1",
    imageName: "chart.png",
    hostRecordId: "rec_1",
    hostRecordTitle: "Atlas",
    classification: null,
    pinCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...partial,
  };
}

describe("map library helpers", () => {
  const maps = [
    map({
      id: "wmp_b",
      title: "Greyhaven",
      hostRecordTitle: "City notes",
      classification: "city",
      pinCount: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-03T00:00:00.000Z",
    }),
    map({
      id: "wmp_a",
      title: "Aldemar",
      hostRecordTitle: "Aldemar Atlas and Location Names",
      classification: "world",
      pinCount: 3,
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-04T00:00:00.000Z",
    }),
  ];

  it("searches titles and linked reference names", () => {
    expect(filterAndSortMaps(maps, { query: "aldemar", filter: "all", sort: "updated" }).map((m) => m.id)).toEqual([
      "wmp_a",
    ]);
    expect(filterAndSortMaps(maps, { query: "city notes", filter: "all", sort: "updated" }).map((m) => m.id)).toEqual([
      "wmp_b",
    ]);
  });

  it("filters by optional classification without inventing types", () => {
    expect(filterAndSortMaps(maps, { query: "", filter: "city", sort: "updated" }).map((m) => m.id)).toEqual(["wmp_b"]);
    expect(parseMapLibraryFilter("district")).toBe("district");
    expect(parseMapLibraryFilter("bogus")).toBe("all");
    expect(parseMapClassification(null)).toBeNull();
    expect(parseMapClassification("world")).toBe("world");
    expect(parseMapClassification("World")).toBeNull();
  });

  it("sorts by updated, created, and name", () => {
    expect(filterAndSortMaps(maps, { query: "", filter: "all", sort: "updated" }).map((m) => m.id)).toEqual([
      "wmp_a",
      "wmp_b",
    ]);
    expect(filterAndSortMaps(maps, { query: "", filter: "all", sort: "created" }).map((m) => m.id)).toEqual([
      "wmp_a",
      "wmp_b",
    ]);
    expect(filterAndSortMaps(maps, { query: "", filter: "all", sort: "name-asc" }).map((m) => m.id)).toEqual([
      "wmp_a",
      "wmp_b",
    ]);
    expect(filterAndSortMaps(maps, { query: "", filter: "all", sort: "name-desc" }).map((m) => m.id)).toEqual([
      "wmp_b",
      "wmp_a",
    ]);
    expect(parseMapLibrarySort("name-asc")).toBe("name-asc");
    expect(parseMapLibrarySort("nope")).toBe("updated");
  });
});
