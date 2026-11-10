/*
 * Text appearance for chapter, scene and reference text: font, size, line
 * spacing and line width. Kept in this browser as a cookie so the server can
 * set the CSS variables on the first paint. Sizes, spacing and width are
 * factors on the app's defaults, so "Medium" / "Normal" leave every page as
 * designed.
 */

export const TEXT_COOKIE = "wordly-text";

/** Fonts that ship with Windows, each with fallbacks for other systems. */
export const TEXT_FONTS = [
  { id: "book", label: "Book (default)", stack: "var(--font-document)" },
  { id: "georgia", label: "Georgia", stack: 'Georgia, "Times New Roman", serif' },
  { id: "cambria", label: "Cambria", stack: "Cambria, Georgia, serif" },
  { id: "constantia", label: "Constantia", stack: "Constantia, Georgia, serif" },
  { id: "sitka", label: "Sitka Text", stack: '"Sitka Text", Georgia, serif' },
  { id: "times", label: "Times New Roman", stack: '"Times New Roman", Times, serif' },
  { id: "garamond", label: "Garamond (if installed)", stack: 'Garamond, "EB Garamond", "Palatino Linotype", serif' },
  { id: "segoe", label: "Segoe UI", stack: '"Segoe UI", system-ui, sans-serif' },
  { id: "calibri", label: "Calibri", stack: 'Calibri, "Segoe UI", sans-serif' },
  { id: "verdana", label: "Verdana", stack: 'Verdana, "Segoe UI", sans-serif' },
  { id: "courier", label: "Courier New (typewriter)", stack: '"Courier New", Courier, monospace' },
  { id: "consolas", label: "Consolas", stack: 'Consolas, "Courier New", monospace' },
] as const;

export const TEXT_SIZES = [
  { id: "small", label: "Small", factor: 0.9 },
  { id: "medium", label: "Medium (default)", factor: 1 },
  { id: "large", label: "Large", factor: 1.15 },
  { id: "xlarge", label: "Extra large", factor: 1.3 },
] as const;

export const TEXT_SPACINGS = [
  { id: "compact", label: "Compact", factor: 0.85 },
  { id: "normal", label: "Normal (default)", factor: 1 },
  { id: "relaxed", label: "Relaxed", factor: 1.15 },
  { id: "open", label: "Very open", factor: 1.3 },
] as const;

export const TEXT_WIDTHS = [
  { id: "narrow", label: "Narrow", factor: 0.8 },
  { id: "medium", label: "Medium (default)", factor: 1 },
  { id: "wide", label: "Wide", factor: 1.25 },
  { id: "full", label: "Full width", factor: 4 },
] as const;

export interface TextAppearance {
  font: (typeof TEXT_FONTS)[number]["id"];
  size: (typeof TEXT_SIZES)[number]["id"];
  spacing: (typeof TEXT_SPACINGS)[number]["id"];
  width: (typeof TEXT_WIDTHS)[number]["id"];
}

export const DEFAULT_TEXT_APPEARANCE: TextAppearance = { font: "book", size: "medium", spacing: "normal", width: "medium" };

function pick<T extends { id: string }>(options: readonly T[], value: unknown, fallback: T["id"]): T["id"] {
  return options.some((o) => o.id === value) ? (value as T["id"]) : fallback;
}

export function parseTextAppearance(value: string | undefined): TextAppearance {
  if (!value) return DEFAULT_TEXT_APPEARANCE;
  let raw: Partial<Record<keyof TextAppearance, unknown>>;
  try {
    raw = JSON.parse(value.startsWith("%") ? decodeURIComponent(value) : value) as typeof raw;
  } catch {
    return DEFAULT_TEXT_APPEARANCE;
  }
  if (!raw || typeof raw !== "object") return DEFAULT_TEXT_APPEARANCE;
  return {
    font: pick(TEXT_FONTS, raw.font, DEFAULT_TEXT_APPEARANCE.font),
    size: pick(TEXT_SIZES, raw.size, DEFAULT_TEXT_APPEARANCE.size),
    spacing: pick(TEXT_SPACINGS, raw.spacing, DEFAULT_TEXT_APPEARANCE.spacing),
    width: pick(TEXT_WIDTHS, raw.width, DEFAULT_TEXT_APPEARANCE.width),
  };
}

export function fontStack(font: TextAppearance["font"]): string {
  return TEXT_FONTS.find((f) => f.id === font)!.stack;
}

/** CSS custom properties read by the text styles in globals.css. */
export function textAppearanceVars(pref: TextAppearance): Record<string, string> {
  return {
    "--text-font": fontStack(pref.font),
    "--text-scale": String(TEXT_SIZES.find((s) => s.id === pref.size)!.factor),
    "--text-leading": String(TEXT_SPACINGS.find((s) => s.id === pref.spacing)!.factor),
    "--text-measure": String(TEXT_WIDTHS.find((s) => s.id === pref.width)!.factor),
  };
}
