import { describe, expect, it } from "vitest";
import {
  EXPORT_PRESET_IDS,
  activeExportPresetId,
  isExportPresetId,
  layoutForPreset,
} from "@/writing/exportPresets";

describe("export presets (Phase 5)", () => {
  it("includes submission, paperback, ebook, beta, and world guide ids", () => {
    expect(EXPORT_PRESET_IDS).toContain("standard_manuscript");
    expect(EXPORT_PRESET_IDS).toContain("paperback");
    expect(EXPORT_PRESET_IDS).toContain("ebook");
    expect(EXPORT_PRESET_IDS).toContain("beta_reader");
    expect(EXPORT_PRESET_IDS).toContain("world_guide");
    expect(isExportPresetId("paperback")).toBe(true);
    expect(isExportPresetId("nope")).toBe(false);
  });

  it("keeps reader packages free of synopses and margin comments", () => {
    for (const id of EXPORT_PRESET_IDS) {
      const layout = layoutForPreset(id);
      expect(layout.includeSynopses).toBe(false);
      expect(layout.includeMarginComments).toBe(false);
    }
  });

  it("detects the active paperback layout", () => {
    const layout = layoutForPreset("paperback");
    expect(
      activeExportPresetId({
        ...layout,
      }),
    ).toBe("paperback");
  });
});
