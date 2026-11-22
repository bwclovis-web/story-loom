import { describe, expect, it } from "vitest";
import {
  formatTravelDuration,
  presetTravelSpeed,
  scaleUsesImperialUnits,
  travelHoursFromDistance,
} from "@/world/mapScale";
import { pinMatchesMapFilter } from "@/world/mapPinFilter";

describe("map scale travel estimates", () => {
  it("detects imperial scale captions", () => {
    expect(scaleUsesImperialUnits("miles")).toBe(true);
    expect(scaleUsesImperialUnits("10 km")).toBe(false);
  });

  it("estimates hours from distance and preset speed", () => {
    const reading = { value: 30, unit: "miles" };
    const hours = travelHoursFromDistance(reading, presetTravelSpeed("walk", true), true);
    expect(hours).toBe(10);
    expect(formatTravelDuration(hours!)).toBe("~10 h");
  });

  it("formats sub-hour travel", () => {
    expect(formatTravelDuration(0.5)).toBe("~30 min");
  });
});

describe("map pin highlight filter", () => {
  const index = {
    eraIds: ["era_founding"],
    eventDraftScopes: ["all"],
    sceneDraftKeys: ["unscoped"],
    sceneBookKeys: ["ungrouped"],
  };

  it("passes when filter is off", () => {
    expect(
      pinMatchesMapFilter("ref_town", { era: "all", draft: "all", book: "all" }, index),
    ).toBe(true);
  });

  it("matches era and draft dimensions together", () => {
    expect(
      pinMatchesMapFilter("ref_town", { era: "era_founding", draft: "all", book: "all" }, index),
    ).toBe(true);
    expect(
      pinMatchesMapFilter("ref_town", { era: "era_other", draft: "all", book: "all" }, index),
    ).toBe(false);
    expect(
      pinMatchesMapFilter("ref_town", { era: "all", draft: "unscoped", book: "all" }, index),
    ).toBe(true);
  });
});