/**
 * Named compile presets for Milestone 5. Applying a preset only fills compile
 * profile layout fields; it does not write manuscript text. Front/back matter
 * and exclusions from the current profile are preserved.
 */

export const EXPORT_PRESET_IDS = ["standard_manuscript", "formatter_ready"] as const;
export type ExportPresetId = (typeof EXPORT_PRESET_IDS)[number];

export function isExportPresetId(value: string): value is ExportPresetId {
  return (EXPORT_PRESET_IDS as readonly string[]).includes(value);
}

/** Layout fields a preset overwrites (matter bodies are kept separately). */
export interface ExportPresetLayout {
  sceneBreakGlyph: string;
  chapterHeadingStyle: "centered" | "left";
  includeSynopses: boolean;
  includeMarginComments: boolean;
  trimSize: string;
  marginInches: number;
  runningHeader: string;
  runningFooter: string;
  fontPreset: string;
  spacingPreset: string;
  firstParagraphNoIndent: boolean;
  dropCap: boolean;
  includeToc: boolean;
}

/** Shunn-style standard manuscript submission (DOCX & PDF). */
export const STANDARD_MANUSCRIPT_LAYOUT: ExportPresetLayout = {
  sceneBreakGlyph: "#",
  chapterHeadingStyle: "centered",
  includeSynopses: false,
  includeMarginComments: false,
  trimSize: "Letter",
  marginInches: 1,
  runningHeader: "",
  runningFooter: "",
  fontPreset: "mono",
  spacingPreset: "manuscript",
  firstParagraphNoIndent: false,
  dropCap: false,
  includeToc: false,
};

/** Clean handoff for Atticus / Vellum / similar (DOCX & EPUB). */
export const FORMATTER_READY_LAYOUT: ExportPresetLayout = {
  sceneBreakGlyph: "***",
  chapterHeadingStyle: "left",
  includeSynopses: false,
  includeMarginComments: false,
  trimSize: "6x9",
  marginInches: 0.75,
  runningHeader: "",
  runningFooter: "",
  fontPreset: "serif",
  spacingPreset: "novel",
  firstParagraphNoIndent: true,
  dropCap: false,
  includeToc: true,
};

export function layoutForPreset(id: ExportPresetId): ExportPresetLayout {
  return id === "standard_manuscript" ? { ...STANDARD_MANUSCRIPT_LAYOUT } : { ...FORMATTER_READY_LAYOUT };
}

/** True when the saved profile matches the standard manuscript submission look. */
export function isStandardManuscriptProfile(profile: {
  spacingPreset: string;
  trimSize: string;
  fontPreset: string;
  sceneBreakGlyph: string;
}): boolean {
  return (
    profile.spacingPreset === "manuscript" &&
    profile.trimSize === "Letter" &&
    profile.fontPreset === "mono" &&
    profile.sceneBreakGlyph.trim() === "#"
  );
}

/** True when the saved profile matches the formatter-ready look. */
export function isFormatterReadyProfile(profile: {
  spacingPreset: string;
  trimSize: string;
  fontPreset: string;
  sceneBreakGlyph: string;
  includeToc: boolean;
}): boolean {
  return (
    profile.spacingPreset === "novel" &&
    profile.trimSize === "6x9" &&
    profile.fontPreset === "serif" &&
    profile.sceneBreakGlyph.trim() === "***" &&
    profile.includeToc
  );
}

/** Short title for a Shunn-style running header (uppercase, truncated). */
export function shortTitleForHeader(projectTitle: string, max = 28): string {
  const cleaned = projectTitle.replace(/\s+/g, " ").trim();
  if (!cleaned) return "MANUSCRIPT";
  const upper = cleaned.toUpperCase();
  return upper.length <= max ? upper : `${upper.slice(0, max - 1)}…`;
}
