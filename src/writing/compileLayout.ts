/** Trim sizes in PDF points (72 points per inch). A4 and Letter use the standard page sizes. */
export const TRIM_SIZES = {
  "5x8": { width: 5 * 72, height: 8 * 72, label: "5 × 8 in" },
  "5.5x8.5": { width: 5.5 * 72, height: 8.5 * 72, label: "5.5 × 8.5 in" },
  "6x9": { width: 6 * 72, height: 9 * 72, label: "6 × 9 in" },
  A4: { width: 595.28, height: 841.89, label: "A4" },
  Letter: { width: 612, height: 792, label: "Letter" },
} as const;

export type TrimSize = keyof typeof TRIM_SIZES;
export type FontPreset = "serif" | "sans" | "mono";
export type SpacingPreset = "novel" | "tight" | "loose";

export const TRIM_SIZE_KEYS = Object.keys(TRIM_SIZES) as TrimSize[];

export function parseTrimSize(value: string): TrimSize {
  return value in TRIM_SIZES ? (value as TrimSize) : "6x9";
}

export function parseFontPreset(value: string): FontPreset {
  if (value === "sans" || value === "mono") return value;
  return "serif";
}

export function parseSpacingPreset(value: string): SpacingPreset {
  if (value === "tight" || value === "loose") return value;
  return "novel";
}

/** Inches clamped to a printable range, then converted to points. */
export function marginPoints(inches: number): number {
  const clamped = Number.isFinite(inches) ? Math.min(1.25, Math.max(0.5, inches)) : 0.75;
  return Math.round(clamped * 72);
}

export function spacingMetrics(preset: SpacingPreset): { lineGap: number; paragraphGap: number; indent: number } {
  if (preset === "tight") return { lineGap: 1, paragraphGap: 4, indent: 0 };
  if (preset === "loose") return { lineGap: 4, paragraphGap: 12, indent: 18 };
  return { lineGap: 2.5, paragraphGap: 8, indent: 18 };
}

export function parseExcludedIds(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 80);
  } catch {
    return [];
  }
}

export interface CompileTreeNode {
  id: string;
  scenes: { id: string }[];
}

/** Drops excluded chapters. Their scenes that are still included move to the unplaced list. */
export function filterCompileTree<T extends CompileTreeNode, S extends { id: string }>(
  chapters: readonly T[],
  unplaced: readonly S[],
  excluded: ReadonlySet<string>,
): { chapters: T[]; unplaced: S[] } {
  const nextUnplaced = unplaced.filter((scene) => !excluded.has(scene.id));
  const nextChapters: T[] = [];
  for (const chapter of chapters) {
    const scenes = chapter.scenes.filter((scene) => !excluded.has(scene.id));
    if (excluded.has(chapter.id)) {
      nextUnplaced.push(...(scenes as unknown as S[]));
      continue;
    }
    nextChapters.push({ ...chapter, scenes });
  }
  return { chapters: nextChapters, unplaced: nextUnplaced };
}
