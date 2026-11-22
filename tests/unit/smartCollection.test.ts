import { describe, expect, it } from "vitest";
import { matchesSmartCollection, parseSmartCollectionFilter } from "@/domain/smartCollection";

describe("smartCollection filter", () => {
  it("parses and matches composable predicates", () => {
    const filter = parseSmartCollectionFilter({
      query: "river",
      pov: "Mira",
      wordMin: 10,
      wordMax: 500,
      hasUnresolvedContinuity: true,
      sceneStatuses: ["rough"],
      types: ["manuscript_scene"],
    });
    expect(filter.query).toBe("river");
    expect(filter.pov).toBe("Mira");
    expect(
      matchesSmartCollection(
        {
          id: "rec_1",
          type: "manuscript_scene",
          title: "Crossing the river",
          body: "Mira waded in.",
          authorityStatus: "draft",
          protected: false,
          words: 40,
          pov: "Mira",
          sceneStatus: "rough",
          continuityOpenCount: 2,
        },
        filter,
      ),
    ).toBe(true);
    expect(
      matchesSmartCollection(
        {
          id: "rec_2",
          type: "manuscript_scene",
          title: "Dry road",
          authorityStatus: "draft",
          protected: false,
          words: 40,
          pov: "Mira",
          sceneStatus: "rough",
          continuityOpenCount: 0,
        },
        filter,
      ),
    ).toBe(false);
  });
});
