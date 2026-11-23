import { describe, expect, it } from "vitest";
import {
  categoryBrowseCounts,
  defaultRecordTypeForCategory,
  discoverWorldHubRecords,
  filterWorldHubRecords,
  hubHasActiveFilters,
  listHubTags,
  parseWorldHubQuery,
  projectWorldHubRecord,
  sortWorldHubRecords,
  suggestedKindForCategory,
  worldHubHref,
  type WorldHubRecord,
} from "@/world/hubDiscovery";
import { WORLD_TAXONOMY_CATEGORIES } from "@/world/taxonomy";

function hub(partial: Partial<WorldHubRecord> & Pick<WorldHubRecord, "id" | "title" | "type" | "fields">): WorldHubRecord {
  return projectWorldHubRecord({
    id: partial.id,
    title: partial.title,
    type: partial.type,
    authorityStatus: partial.authorityStatus ?? "draft",
    protected: partial.protected ?? false,
    currentRevision: partial.currentRevision ?? 1,
    worldScope: partial.worldScope ?? null,
    createdAt: partial.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: partial.updatedAt ?? "2026-01-02T00:00:00.000Z",
    fields: partial.fields,
    home: partial.home ?? null,
  });
}

const records: WorldHubRecord[] = [
  hub({
    id: "a",
    title: "Mara Venn",
    type: "character_dossier",
    worldScope: "book",
    fields: {
      taxonomy: {
        version: 1,
        primary: { category: "characters", subcategory: "protagonists" },
        secondary: [{ category: "organizations" }],
        tags: ["cast"],
      },
    },
  }),
  hub({
    id: "b",
    title: "Salt Guild",
    type: "worldbuilding",
    authorityStatus: "approved",
    protected: true,
    worldScope: "series",
    updatedAt: "2026-01-05T00:00:00.000Z",
    fields: {
      kind: "organization",
      taxonomy: {
        version: 1,
        primary: { category: "organizations", subcategory: "guilds" },
        tags: ["salt"],
      },
    },
  }),
  hub({
    id: "c",
    title: "Tide Courts",
    type: "worldbuilding",
    createdAt: "2026-01-03T00:00:00.000Z",
    fields: { kind: "place" },
  }),
  hub({
    id: "d",
    title: "Custom Rite",
    type: "worldbuilding",
    fields: { kind: "rite of salt" },
  }),
  hub({
    id: "e",
    title: "Loose note",
    type: "reference_note",
    fields: {},
  }),
];

describe("parseWorldHubQuery / worldHubHref", () => {
  it("keeps legacy type/kind/q/list and adds hub filters", () => {
    expect(parseWorldHubQuery({ type: "worldbuilding", kind: "place", list: "1", q: " salt " })).toMatchObject({
      type: "worldbuilding",
      kind: "place",
      list: true,
      q: "salt",
      sort: "updated",
      view: "list",
    });
    expect(
      parseWorldHubQuery({
        category: "magic",
        subcategory: "rules",
        tag: "salt",
        scope: "series",
        status: "approved",
        protected: "yes",
        sort: "title",
        view: "cards",
        unclassified: "1",
        customKind: "rite of salt",
      }),
    ).toMatchObject({
      category: "magic",
      subcategory: "rules",
      tag: "salt",
      scope: "series",
      status: "approved",
      protected: "yes",
      sort: "title",
      view: "cards",
      unclassified: true,
      customKind: "rite of salt",
    });
    expect(worldHubHref("prj", { category: "magic", list: true, view: "cards" })).toBe(
      "/projects/prj/world?list=1&category=magic&view=cards",
    );
  });
});

describe("World Hub discovery", () => {
  it("lists all 14 taxonomy categories in browse counts", () => {
    const browse = categoryBrowseCounts(records);
    for (const category of WORLD_TAXONOMY_CATEGORIES) {
      expect(browse.byCategory[category.id]).toBeTypeOf("number");
    }
    expect(browse.byCategory.characters).toBe(1);
    expect(browse.byCategory.organizations).toBe(2); // primary + secondary
    expect(browse.byCategory.locations).toBe(1); // legacy place
    expect(browse.unclassified).toBeGreaterThanOrEqual(1);
    expect(browse.customKinds["rite of salt"]).toBe(1);
    expect(browse.tags.salt).toBe(1);
  });

  it("filters by category, subcategory, tag, scope, status, protected, and custom kind", () => {
    expect(filterWorldHubRecords(records, parseWorldHubQuery({ category: "organizations" })).map((r) => r.id)).toEqual([
      "a",
      "b",
    ]);
    expect(
      filterWorldHubRecords(records, parseWorldHubQuery({ category: "organizations", subcategory: "guilds" })).map(
        (r) => r.id,
      ),
    ).toEqual(["b"]);
    expect(filterWorldHubRecords(records, parseWorldHubQuery({ tag: "CAST" })).map((r) => r.id)).toEqual(["a"]);
    expect(filterWorldHubRecords(records, parseWorldHubQuery({ scope: "series" })).map((r) => r.id)).toEqual(["b"]);
    expect(filterWorldHubRecords(records, parseWorldHubQuery({ scope: "unset" })).map((r) => r.id)).toEqual([
      "c",
      "d",
      "e",
    ]);
    expect(filterWorldHubRecords(records, parseWorldHubQuery({ status: "approved" })).map((r) => r.id)).toEqual(["b"]);
    expect(filterWorldHubRecords(records, parseWorldHubQuery({ protected: "yes" })).map((r) => r.id)).toEqual(["b"]);
    expect(filterWorldHubRecords(records, parseWorldHubQuery({ customKind: "rite of salt" })).map((r) => r.id)).toEqual([
      "d",
    ]);
    expect(filterWorldHubRecords(records, parseWorldHubQuery({ type: "worldbuilding", kind: "place" })).map((r) => r.id)).toEqual([
      "c",
    ]);
  });

  it("returns each multi-membership record once", () => {
    const found = discoverWorldHubRecords(records, parseWorldHubQuery({ category: "organizations" }));
    expect(found.map((r) => r.id)).toEqual(["b", "a"]);
    expect(new Set(found.map((r) => r.id)).size).toBe(found.length);
  });

  it("sorts by title, updated, and created", () => {
    expect(sortWorldHubRecords(records, "title").map((r) => r.id)).toEqual(["d", "e", "a", "b", "c"]);
    expect(sortWorldHubRecords(records, "updated")[0]!.id).toBe("b");
    expect(sortWorldHubRecords(records, "created").map((r) => r.id).slice(0, 1)).toEqual(["c"]);
  });

  it("lists tags and category defaults", () => {
    expect(listHubTags(records)).toEqual(["cast", "salt"]);
    expect(defaultRecordTypeForCategory("characters")).toBe("character_dossier");
    expect(defaultRecordTypeForCategory("magic")).toBe("worldbuilding");
    expect(suggestedKindForCategory("locations")).toBe("place");
    expect(hubHasActiveFilters(parseWorldHubQuery({}))).toBe(false);
    expect(hubHasActiveFilters(parseWorldHubQuery({ list: "1" }))).toBe(true);
  });
});
