import { describe, expect, it } from "vitest";
import { filterCompileTree, marginPoints, parseTrimSize, spacingMetrics, TRIM_SIZES } from "@/writing/compileLayout";

describe("compile layout", () => {
  it("maps trim names to page sizes and clamps margins", () => {
    expect(parseTrimSize("nope")).toBe("6x9");
    expect(TRIM_SIZES["6x9"]).toEqual({ width: 432, height: 648, label: "6 × 9 in" });
    expect(TRIM_SIZES.Letter.width).toBe(612);
    expect(marginPoints(0.1)).toBe(36);
    expect(marginPoints(2)).toBe(90);
    expect(spacingMetrics("tight").indent).toBe(0);
    expect(spacingMetrics("novel").indent).toBe(18);
  });

  it("omits an excluded chapter and keeps a scene that is still included", () => {
    const tree = filterCompileTree(
      [{ id: "ch", scenes: [{ id: "sc" }, { id: "drop" }] }],
      [{ id: "loose" }],
      new Set(["ch", "drop"]),
    );
    expect(tree.chapters).toEqual([]);
    expect(tree.unplaced.map((scene) => scene.id)).toEqual(["loose", "sc"]);
  });
});
