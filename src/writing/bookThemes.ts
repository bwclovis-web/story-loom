import type { ChapterHeadingStyle } from "@/server/services/compileProfileService";
import type { FontPreset, SpacingPreset } from "./compileLayout";

export const BOOK_THEME_KEYS = [
  "classic_novel",
  "fantasy_ornamental",
  "thriller_clean",
  "nonfiction",
  "romance_warm",
] as const;

export type BookThemeKey = (typeof BOOK_THEME_KEYS)[number];

export interface BookThemeLayout {
  fontPreset: FontPreset;
  spacingPreset: SpacingPreset;
  chapterHeadingStyle: ChapterHeadingStyle;
  dropCap: boolean;
}

const THEMES: Record<BookThemeKey, BookThemeLayout> = {
  classic_novel: {
    fontPreset: "serif",
    spacingPreset: "novel",
    chapterHeadingStyle: "centered",
    dropCap: false,
  },
  fantasy_ornamental: {
    fontPreset: "serif",
    spacingPreset: "loose",
    chapterHeadingStyle: "centered",
    dropCap: true,
  },
  thriller_clean: {
    fontPreset: "sans",
    spacingPreset: "tight",
    chapterHeadingStyle: "left",
    dropCap: false,
  },
  nonfiction: {
    fontPreset: "sans",
    spacingPreset: "novel",
    chapterHeadingStyle: "left",
    dropCap: false,
  },
  romance_warm: {
    fontPreset: "serif",
    spacingPreset: "loose",
    chapterHeadingStyle: "centered",
    dropCap: false,
  },
};

export function parseBookTheme(value: string | null | undefined): BookThemeKey | null {
  if (!value) return null;
  return (BOOK_THEME_KEYS as readonly string[]).includes(value) ? (value as BookThemeKey) : null;
}

export function bookThemeLayout(key: BookThemeKey | null): BookThemeLayout | null {
  return key ? THEMES[key] : null;
}

/** Typography used at export time when an optional book theme is set. */
export function exportTypography(compile: {
  bookTheme: BookThemeKey | null;
  fontPreset: FontPreset;
  spacingPreset: SpacingPreset;
  chapterHeadingStyle: ChapterHeadingStyle;
  dropCap: boolean;
}): {
  fontPreset: FontPreset;
  spacingPreset: SpacingPreset;
  chapterHeadingStyle: ChapterHeadingStyle;
  dropCap: boolean;
} {
  const theme = bookThemeLayout(compile.bookTheme);
  if (!theme) {
    return {
      fontPreset: compile.fontPreset,
      spacingPreset: compile.spacingPreset,
      chapterHeadingStyle: compile.chapterHeadingStyle,
      dropCap: compile.dropCap,
    };
  }
  return {
    fontPreset: theme.fontPreset,
    spacingPreset: theme.spacingPreset,
    chapterHeadingStyle: theme.chapterHeadingStyle,
    dropCap: theme.dropCap,
  };
}