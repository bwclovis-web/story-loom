/*
 * Spelling preferences, stored in cookies (so they are per browser): the
 * English variety, and which checker marks the record text. The app's checker
 * uses the bundled English dictionary plus the author's dictionary; the
 * browser's checker uses the browser's own dictionaries and settings and
 * knows nothing of the author's dictionary.
 */

export const SPELLING_LANGUAGES = [
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
] as const;

export type SpellingLanguage = (typeof SPELLING_LANGUAGES)[number]["code"];

export const DEFAULT_SPELLING_LANGUAGE: SpellingLanguage = "en-US";
export const SPELLING_COOKIE = "wordly-spelling";

export function parseSpellingLanguage(value: string | undefined | null): SpellingLanguage {
  return SPELLING_LANGUAGES.some((l) => l.code === value) ? (value as SpellingLanguage) : DEFAULT_SPELLING_LANGUAGE;
}

export function spellingCookie(language: SpellingLanguage): string {
  return `${SPELLING_COOKIE}=${language}; path=/; max-age=31536000; samesite=lax`;
}

export const SPELL_CHECKERS = [
  { code: "app", label: "Wordly (uses your dictionary)" },
  { code: "browser", label: "Browser" },
] as const;

export type SpellChecker = (typeof SPELL_CHECKERS)[number]["code"];

export const DEFAULT_SPELL_CHECKER: SpellChecker = "app";
export const SPELL_CHECKER_COOKIE = "wordly-spellchecker";

export function parseSpellChecker(value: string | undefined | null): SpellChecker {
  return SPELL_CHECKERS.some((c) => c.code === value) ? (value as SpellChecker) : DEFAULT_SPELL_CHECKER;
}

export function spellCheckerCookie(checker: SpellChecker): string {
  return `${SPELL_CHECKER_COOKIE}=${checker}; path=/; max-age=31536000; samesite=lax`;
}
