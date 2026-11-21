import { describe, expect, it } from "vitest";
import {
  annotatedMapSvg,
  distanceFromScale,
  hiddenLayerIdsForPreset,
  normalizedLength,
  parseScaleLabel,
} from "@/world/mapScale";

describe("map scale", () => {
  it("reads a leading number and unit from the author's caption", () => {
    expect(parseScaleLabel("10 miles")).toEqual({ amount: 10, unit: "miles" });
    expect(parseScaleLabel("about 10 miles")).toBeNull();
  });

  it("treats one scale-bar width as the caption's amount", () => {
    const image = { width: 200, height: 100 };
    const length = normalizedLength(
      [
        { x: 0, y: 0.5 },
        { x: 0.25, y: 0.5 },
      ],
      image,
    );
    expect(length).toBeCloseTo(0.25);
    expect(distanceFromScale(length, 0.25, "10 miles")).toEqual({ value: 10, unit: "miles" });
    expect(distanceFromScale(length, null, "10 miles")).toBeNull();
  });

  it("shortens a vertical span on a wide image", () => {
    const length = normalizedLength(
      [
        { x: 0, y: 0 },
        { x: 0, y: 1 },
      ],
      { width: 200, height: 100 },
    );
    expect(length).toBeCloseTo(0.5);
    expect(distanceFromScale(length, 0.5, "10 km")?.value).toBeCloseTo(10);
  });

  it("hides every layer, none, or every layer outside one group", () => {
    const layers = [
      { id: "places", legacyGroup: "places" },
      { id: "story", legacyGroup: "story" },
    ];
    expect(hiddenLayerIdsForPreset(layers, "all")).toEqual([]);
    expect(hiddenLayerIdsForPreset(layers, "none")).toEqual(["places", "story"]);
    expect(hiddenLayerIdsForPreset(layers, { group: "story" })).toEqual(["places"]);
  });

  it("includes the scale caption in an annotated export", () => {
    const svg = annotatedMapSvg({
      title: "Coast",
      pins: [{ title: "Quay", kind: "point", x: 0.2, y: 0.4, points: [] }],
      scaleLabel: "10 miles",
      scaleBarLength: 0.2,
    });
    expect(svg).toContain("10 miles");
    expect(svg).toContain("estimated from the author's scale bar");
    expect(svg).toContain("Quay");
  });
});
