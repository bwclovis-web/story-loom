import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import Typo from "typo-js";
import { createWordChecker } from "@/spelling/words";
import type { SpellingLanguage } from "@/writing/spelling";

/*
 * Standard English word lists (Hunspell format) from the dictionary-en and
 * dictionary-en-gb packages (SCOWL; see docs/spelling.md for licences). The
 * browser's checker downloads them from /api/spelling/...; the server loads
 * them only to filter reference-name suggestions.
 */

const PACKAGES: Record<SpellingLanguage, string> = {
  "en-US": "dictionary-en",
  "en-GB": "dictionary-en-gb",
};

export type DictionaryFileKind = "aff" | "dic";

export function dictionaryFilePath(language: SpellingLanguage, kind: DictionaryFileKind): string {
  return path.join(/*turbopackIgnore: true*/ process.cwd(), "node_modules", PACKAGES[language], `index.${kind}`);
}

export function readDictionaryFile(language: SpellingLanguage, kind: DictionaryFileKind): string {
  return readFileSync(dictionaryFilePath(language, kind), "utf8");
}

const checkers = new Map<SpellingLanguage, (word: string) => boolean>();

/** True if the standard dictionary knows the word. Loaded once per language (about 0.3 s). */
export function standardWordChecker(language: SpellingLanguage): (word: string) => boolean {
  let checker = checkers.get(language);
  if (!checker) {
    const typo = new Typo(language, readDictionaryFile(language, "aff"), readDictionaryFile(language, "dic"));
    checker = createWordChecker(typo);
    checkers.set(language, checker);
  }
  return checker;
}
