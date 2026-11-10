import { describe, expect, it } from "vitest";
import { DEFAULT_TEXT_APPEARANCE, parseTextAppearance, textAppearanceVars } from "@/ui/textAppearance";

describe("text appearance", () => {
  it("reads a saved choice, plain or URL-encoded, and ignores unknown values", () => {
    const saved = JSON.stringify({ font: "georgia", size: "large", spacing: "relaxed", width: "wide" });
    expect(parseTextAppearance(saved)).toEqual({ font: "georgia", size: "large", spacing: "relaxed", width: "wide" });
    expect(parseTextAppearance(encodeURIComponent(saved)).font).toBe("georgia");
    expect(parseTextAppearance(JSON.stringify({ font: "comic", size: 3 }))).toEqual(DEFAULT_TEXT_APPEARANCE);
    expect(parseTextAppearance("not json")).toEqual(DEFAULT_TEXT_APPEARANCE);
    expect(parseTextAppearance(undefined)).toEqual(DEFAULT_TEXT_APPEARANCE);
  });

  it("leaves the designed sizes alone by default", () => {
    expect(textAppearanceVars(DEFAULT_TEXT_APPEARANCE)).toEqual({
      "--text-font": "var(--font-document)",
      "--text-scale": "1",
      "--text-leading": "1",
      "--text-measure": "1",
    });
    expect(textAppearanceVars({ ...DEFAULT_TEXT_APPEARANCE, font: "courier", size: "small" })["--text-font"]).toContain("Courier New");
  });
});
