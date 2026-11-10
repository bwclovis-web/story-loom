"use server";

import { revalidatePath } from "next/cache";
import { DICTIONARY_SCOPES, MAX_NOTE_CHARS, MAX_WORD_CHARS, type DictionaryScope, type DictionaryWord } from "@/spelling/dictionary";
import { MAX_IMPORT_WORDS } from "@/spelling/dictionaryFile";
import { getDb } from "@/server/db";
import {
  addDictionaryEntries,
  addDictionaryEntry,
  DictionaryError,
  dictionaryWordsForProject,
  removeDictionaryEntry,
  suggestReferenceTerms,
  updateDictionaryEntry,
  type DictionaryEntryInput,
  type ReferenceTermSuggestion,
} from "@/server/services/dictionaryService";
import { standardWordChecker } from "@/server/spellDictionaries";
import { parseSpellingLanguage } from "@/writing/spelling";

export type DictionaryActionResult =
  | { ok: true; message: string; words: DictionaryWord[] }
  | { ok: false; message: string };

export interface BulkActionResult {
  ok: boolean;
  message: string;
  skipped: { word: string; message: string }[];
  words: DictionaryWord[];
}

function isScope(value: unknown): value is DictionaryScope {
  return DICTIONARY_SCOPES.includes(value as DictionaryScope);
}

/** Server actions can be called with anything, so the shape is checked here before the service checks the content. */
function cleanItem(raw: unknown, maxWord = MAX_WORD_CHARS * 4): { word: string; caseSensitive: boolean; note: string } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { word, caseSensitive, note } = raw as Record<string, unknown>;
  if (typeof word !== "string" || word.length > maxWord || typeof caseSensitive !== "boolean") return null;
  if (note !== undefined && (typeof note !== "string" || note.length > MAX_NOTE_CHARS * 4)) return null;
  return { word, caseSensitive, note: (note as string | undefined) ?? "" };
}

function cleanInput(raw: unknown): DictionaryEntryInput | null {
  const item = cleanItem(raw);
  const scope = (raw as { scope?: unknown } | null)?.scope;
  return item && isScope(scope) ? { ...item, scope } : null;
}

function failure(error: unknown): { ok: false; message: string } {
  if (error instanceof DictionaryError) return { ok: false, message: error.message };
  throw error;
}

async function done(projectId: string, message: string): Promise<DictionaryActionResult> {
  revalidatePath(`/projects/${projectId}/dictionary`);
  return { ok: true, message, words: await dictionaryWordsForProject(getDb(), projectId) };
}

const SCOPE_NAME: Record<DictionaryScope, string> = { project: "project", workspace: "workspace" };

export async function addDictionaryWordAction(projectId: string, raw: unknown, fromEditor: boolean): Promise<DictionaryActionResult> {
  const input = cleanInput(raw);
  if (!input) return { ok: false, message: "That word could not be read." };
  try {
    const entry = await addDictionaryEntry(getDb(), projectId, input, fromEditor ? "editor" : "manual");
    return done(projectId, `Added "${entry.word}" to the ${SCOPE_NAME[entry.scope]} dictionary.`);
  } catch (error) {
    return failure(error);
  }
}

export async function updateDictionaryWordAction(projectId: string, entryId: string, raw: unknown): Promise<DictionaryActionResult> {
  const input = cleanInput(raw);
  if (!input || typeof entryId !== "string") return { ok: false, message: "That word could not be read." };
  try {
    const entry = await updateDictionaryEntry(getDb(), projectId, entryId, input);
    return done(projectId, `Saved "${entry.word}".`);
  } catch (error) {
    return failure(error);
  }
}

export async function removeDictionaryWordAction(projectId: string, entryId: string): Promise<DictionaryActionResult> {
  if (typeof entryId !== "string") return { ok: false, message: "That entry could not be read." };
  try {
    await removeDictionaryEntry(getDb(), projectId, entryId);
    return done(projectId, "Removed.");
  } catch (error) {
    return failure(error);
  }
}

/** Adds only the words the author ticked, from an imported file or from reference names. */
export async function addDictionaryWordsAction(
  projectId: string,
  scope: unknown,
  rawItems: unknown,
  source: "import" | "reference",
): Promise<BulkActionResult> {
  const empty = { skipped: [], words: [] };
  if (!isScope(scope) || !Array.isArray(rawItems) || (source !== "import" && source !== "reference")) {
    return { ok: false, message: "The selection could not be read.", ...empty };
  }
  if (rawItems.length === 0) return { ok: false, message: "Tick at least one word.", ...empty };
  if (rawItems.length > MAX_IMPORT_WORDS) return { ok: false, message: `At most ${MAX_IMPORT_WORDS} words can be added at once.`, ...empty };
  const items = rawItems.map((r) => cleanItem(r));
  if (items.some((i) => i === null)) return { ok: false, message: "The selection could not be read.", ...empty };
  try {
    const db = getDb();
    const result = await addDictionaryEntries(db, projectId, scope, items as NonNullable<(typeof items)[number]>[], source);
    revalidatePath(`/projects/${projectId}/dictionary`);
    const n = result.added.length;
    return {
      ok: n > 0,
      message: `Added ${n} word${n === 1 ? "" : "s"} to the ${SCOPE_NAME[scope]} dictionary.${result.skipped.length ? ` ${result.skipped.length} skipped:` : ""}`,
      skipped: result.skipped,
      words: await dictionaryWordsForProject(db, projectId),
    };
  } catch (error) {
    return { ...failure(error), ...empty };
  }
}

export async function findReferenceNamesAction(projectId: string, language: string): Promise<ReferenceTermSuggestion[]> {
  return suggestReferenceTerms(getDb(), projectId, standardWordChecker(parseSpellingLanguage(language)));
}
