/**
 * Named compile presets. Applying a preset only fills compile profile layout
 * fields; it does not write manuscript text. Front/back matter and exclusions
 * from the current profile are preserved. World-guide is a layout hint plus a
 * download recommendation (World Portal / wiki), not a second DB profile.
 */

export const EXPORT_PRESET_IDS = [
  "standard_manuscript",
  "formatter_ready",
  "paperback",
  "ebook",
  "beta_reader",
  "world_guide",
] as const;
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

/** Shunn-style standard / submission manuscript (DOCX & PDF). */
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

/** Trade paperback print look (PDF primary). */
export const PAPERBACK_LAYOUT: ExportPresetLayout = {
  sceneBreakGlyph: "***",
  chapterHeadingStyle: "centered",
  includeSynopses: false,
  includeMarginComments: false,
  trimSize: "6x9",
  marginInches: 0.75,
  runningHeader: "",
  runningFooter: "",
  fontPreset: "serif",
  spacingPreset: "novel",
  firstParagraphNoIndent: true,
  dropCap: true,
  includeToc: true,
};

/** Reflowable ebook (EPUB primary). */
export const EBOOK_LAYOUT: ExportPresetLayout = {
  sceneBreakGlyph: "***",
  chapterHeadingStyle: "left",
  includeSynopses: false,
  includeMarginComments: false,
  trimSize: "5x8",
  marginInches: 0.5,
  runningHeader: "",
  runningFooter: "",
  fontPreset: "serif",
  spacingPreset: "novel",
  firstParagraphNoIndent: true,
  dropCap: false,
  includeToc: true,
};

/**
 * Beta-reader manuscript: readable novel spacing, no private annotations in the
 * file. Pair with the beta reader DOCX download for line numbers / glossary.
 */
export const BETA_READER_LAYOUT: ExportPresetLayout = {
  sceneBreakGlyph: "***",
  chapterHeadingStyle: "centered",
  includeSynopses: false,
  includeMarginComments: false,
  trimSize: "Letter",
  marginInches: 1,
  runningHeader: "",
  runningFooter: "",
  fontPreset: "serif",
  spacingPreset: "loose",
  firstParagraphNoIndent: false,
  dropCap: false,
  includeToc: true,
};

/**
 * World guide: reader-safe manuscript layout defaults when someone also downloads
 * a chapter sample; primary handoff is World Portal / wiki with spoiler ceiling.
 */
export const WORLD_GUIDE_LAYOUT: ExportPresetLayout = {
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

const LAYOUTS: Record<ExportPresetId, ExportPresetLayout> = {
  standard_manuscript: STANDARD_MANUSCRIPT_LAYOUT,
  formatter_ready: FORMATTER_READY_LAYOUT,
  paperback: PAPERBACK_LAYOUT,
  ebook: EBOOK_LAYOUT,
  beta_reader: BETA_READER_LAYOUT,
  world_guide: WORLD_GUIDE_LAYOUT,
};

export function layoutForPreset(id: ExportPresetId): ExportPresetLayout {
  return { ...LAYOUTS[id] };
}

function matchesLayout(
  profile: {
    spacingPreset: string;
    trimSize: string;
    fontPreset: string;
    sceneBreakGlyph: string;
    includeToc: boolean;
    dropCap: boolean;
    includeSynopses: boolean;
    includeMarginComments: boolean;
  },
  layout: ExportPresetLayout,
): boolean {
  return (
    profile.spacingPreset === layout.spacingPreset &&
    profile.trimSize === layout.trimSize &&
    profile.fontPreset === layout.fontPreset &&
    profile.sceneBreakGlyph.trim() === layout.sceneBreakGlyph.trim() &&
    profile.includeToc === layout.includeToc &&
    profile.dropCap === layout.dropCap &&
    profile.includeSynopses === layout.includeSynopses &&
    profile.includeMarginComments === layout.includeMarginComments
  );
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

export function activeExportPresetId(profile: {
  spacingPreset: string;
  trimSize: string;
  fontPreset: string;
  sceneBreakGlyph: string;
  includeToc: boolean;
  dropCap: boolean;
  includeSynopses: boolean;
  includeMarginComments: boolean;
}): ExportPresetId | null {
  for (const id of EXPORT_PRESET_IDS) {
    if (matchesLayout(profile, LAYOUTS[id])) return id;
  }
  return null;
}

/** Short title for a Shunn-style running header (uppercase, truncated). */
export function shortTitleForHeader(projectTitle: string, max = 28): string {
  const cleaned = projectTitle.replace(/\s+/g, " ").trim();
  if (!cleaned) return "MANUSCRIPT";
  const upper = cleaned.toUpperCase();
  return upper.length <= max ? upper : `${upper.slice(0, max - 1)}…`;
}
