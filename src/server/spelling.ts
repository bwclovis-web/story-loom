import { cookies } from "next/headers";
import {
  parseSpellChecker,
  parseSpellingLanguage,
  SPELL_CHECKER_COOKIE,
  SPELLING_COOKIE,
  type SpellChecker,
  type SpellingLanguage,
} from "@/writing/spelling";

export async function getSpellingLanguage(): Promise<SpellingLanguage> {
  return parseSpellingLanguage((await cookies()).get(SPELLING_COOKIE)?.value);
}

export async function getSpellChecker(): Promise<SpellChecker> {
  return parseSpellChecker((await cookies()).get(SPELL_CHECKER_COOKIE)?.value);
}
