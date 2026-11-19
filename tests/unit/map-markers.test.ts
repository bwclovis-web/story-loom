import { describe, expect, it } from "vitest";
import { clampMapPan, clampMapZoom, pushMapTrail, trailWithoutCurrent } from "@/world/mapMarkers";

describe("map marker helpers", () => {
  it("clamps zoom and pan without turning coordinates into pixels", () => {
    expect(clampMapZoom(0.2)).toBe(1);
    expect(clampMapZoom(9)).toBe(4);
    expect(clampMapZoom(Number.NaN)).toBe(1);
    expect(clampMapPan(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("keeps a breadcrumb trail of maps and drops the current one", () => {
    const trail = pushMapTrail(
      [{ id: "wmp_coast", title: "Coast" }],
      { id: "wmp_harbour", title: "Harbour" },
    );
    expect(trail.map((item) => item.id)).toEqual(["wmp_coast", "wmp_harbour"]);
    expect(trailWithoutCurrent(trail, "wmp_harbour").map((item) => item.title)).toEqual(["Coast"]);
    expect(pushMapTrail(trail, { id: "wmp_coast", title: "Coast" }).map((item) => item.id)).toEqual([
      "wmp_harbour",
      "wmp_coast",
    ]);
  });
});
