import { z } from "zod";
import {
  defaultCaseSensitive,
  findDuplicate,
  MAX_NOTE_CHARS,
  validateDictionaryWord,
  type DictionaryScope,
  type DictionaryWord,
} from "./dictionary";

/*
 * Dictionary export and import. Exports are JSON. Imports accept that JSON or
 * a plain word list (one word per line, "#" comments). Importing only
 * proposes words: the author picks which ones to add, nothing is preselected.
 */

export const DICTIONARY_FORMAT = "wordly.dictionary";
export const DICTIONARY_FORMAT_VERSION = 1;
export const MAX_IMPORT_WORDS = 5_000;

const entrySchema = z
  .object({
    word: z.string(),
    caseSensitive: z.boolean(),
    note: z.string().max(MAX_NOTE_CHARS).optional(),
  })
  .strict();

export const dictionaryFileSchema = z
  .object({
    format: z.literal(DICTIONARY_FORMAT),
    formatVersion: z.literal(DICTIONARY_FORMAT_VERSION),
    exportedAt: z.iso.datetime(),
    scope: z.enum(["project", "workspace"]),
    label: z.string(),
    entries: z.array(entrySchema).max(MAX_IMPORT_WORDS),
  })
  .strict();

export type DictionaryFile = z.output<typeof dictionaryFileSchema>;

export interface ExportEntry extends DictionaryWord {
  note: string;
}

export function buildDictionaryExport(scope: DictionaryScope, label: string, entries: readonly ExportEntry[], now = new Date()): DictionaryFile {
  return {
    format: DICTIONARY_FORMAT,
    formatVersion: DICTIONARY_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    scope,
    label,
    entries: [...entries]
      .sort((a, b) => a.word.localeCompare(b.word))
      .map((e) => (e.note ? { word: e.word, caseSensitive: e.caseSensitive, note: e.note } : { word: e.word, caseSensitive: e.caseSensitive })),
  };
}

export type ImportStatus = "new" | "duplicate" | "invalid";

export interface ImportCandidate {
  /** Line number (word lists) or entry number (JSON), from 1. */
  position: number;
  word: string;
  caseSensitive: boolean;
  note: string;
  status: ImportStatus;
  message: string;
}

export type ParsedImport =
  | { ok: true; kind: "wordly" | "word list"; candidates: ImportCandidate[] }
  | { ok: false; message: string };

function candidate(position: number, raw: string, caseSensitive: boolean | null, note: string): ImportCandidate {
  const check = validateDictionaryWord(raw);
  if (!check.ok) return { position, word: raw.trim(), caseSensitive: caseSensitive ?? false, note, status: "invalid", message: check.message };
  return {
    position,
    word: check.word,
    caseSensitive: caseSensitive ?? defaultCaseSensitive(check.word),
    note,
    status: "new",
    message: "",
  };
}

export function parseDictionaryImport(text: string): ParsedImport {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (!trimmed) return { ok: false, message: "The file is empty." };

  if (trimmed.startsWith("{")) {
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch (e) {
      return { ok: false, message: `Not valid JSON: ${(e as Error).message}` };
    }
    const parsed = dictionaryFileSchema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return { ok: false, message: `Not a Wordly dictionary file (${first.path.join(".") || "file"}: ${first.message}).` };
    }
    return {
      ok: true,
      kind: "wordly",
      candidates: parsed.data.entries.map((e, i) => candidate(i + 1, e.word, e.caseSensitive, e.note?.trim() ?? "")),
    };
  }

  const lines = trimmed.split(/\r\n?|\n/);
  const candidates: ImportCandidate[] = [];
  lines.forEach((line, i) => {
    let value = line.trim();
    if (!value || value.startsWith("#")) return;
    // Hunspell .dic files start with a word count and may add "/FLAGS" to words.
    if (i === 0 && /^\d+$/.test(value)) return;
    value = value.replace(/\/\S*$/, "");
    candidates.push(candidate(i + 1, value, null, ""));
  });
  if (candidates.length > MAX_IMPORT_WORDS) {
    return { ok: false, message: `The file has ${candidates.length} words; at most ${MAX_IMPORT_WORDS} can be imported at once.` };
  }
  if (candidates.length === 0) return { ok: false, message: "The file has no words." };
  return { ok: true, kind: "word list", candidates };
}

/** Marks words already in the target dictionary, or repeated in the file, as duplicates. */
export function classifyImport(candidates: readonly ImportCandidate[], existing: readonly DictionaryWord[]): ImportCandidate[] {
  const accepted: DictionaryWord[] = [...existing];
  return candidates.map((c) => {
    if (c.status === "invalid") return c;
    const dup = findDuplicate(accepted, c);
    if (dup) {
      const inFile = !existing.includes(dup);
      return { ...c, status: "duplicate", message: inFile ? `Repeats "${dup.word}" earlier in the file.` : `Already in your dictionary as "${dup.word}".` };
    }
    accepted.push(c);
    return { ...c, status: "new", message: "" };
  });
}
