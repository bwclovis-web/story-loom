import { normalizeWord, spellTokens, stripPossessive, type WordToken } from "./words";

/*
 * The author's dictionary: words and phrases accepted as correctly spelled. An
 * entry applies to one project (a book) or to its whole workspace (every book in
 * the series). Entries only stop spelling flags. Single words match exactly (with
 * optional case rules). Multi-word phrases match only as a whole sequence with
 * the same spacing, at word boundaries. Similar entries are pointed out rather
 * than merged.
 */

export type DictionaryScope = "project" | "workspace";
export const DICTIONARY_SCOPES: readonly DictionaryScope[] = ["project", "workspace"];

export interface DictionaryWord {
  word: string;
  /** Only this exact capitalisation is accepted. Otherwise any capitalisation is. */
  caseSensitive: boolean;
}

export const MAX_WORD_CHARS = 64;
export const MAX_NOTE_CHARS = 200;

export function wordKey(word: string): string {
  return normalizeWord(word).toLowerCase();
}

export function isDictionaryPhrase(word: string): boolean {
  return /\s/.test(normalizeWord(word.trim()));
}

/** Names usually keep their capitals; ordinary invented words usually do not. */
export function defaultCaseSensitive(word: string): boolean {
  return word !== word.toLowerCase();
}

export type WordCheck = { ok: true; word: string } | { ok: false; message: string };

function validateSingleToken(raw: string): WordCheck {
  const word = normalizeWord(raw.trim());
  if (!word) return { ok: false, message: "Type a word." };
  if (word.length > MAX_WORD_CHARS) return { ok: false, message: `A word can have at most ${MAX_WORD_CHARS} characters.` };
  if (word.includes("-")) return { ok: false, message: "Hyphenated words are checked part by part. Add each part separately." };
  const tokens = spellTokens(word);
  if (tokens.length !== 1 || tokens[0].start !== 0 || tokens[0].end !== word.length) {
    return { ok: false, message: "Use letters only, with apostrophes only between letters (no digits, symbols or single letters)." };
  }
  return { ok: true, word };
}

function collapseSpaces(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/** One word, or a phrase of two or more words separated by spaces. */
export function validateDictionaryWord(raw: string): WordCheck {
  const collapsed = collapseSpaces(normalizeWord(raw));
  if (!collapsed) return { ok: false, message: "Type a word or phrase." };
  if (collapsed.length > MAX_WORD_CHARS) return { ok: false, message: `An entry can have at most ${MAX_WORD_CHARS} characters.` };
  if (!/\s/.test(collapsed)) return validateSingleToken(collapsed);

  const parts = collapsed.split(" ");
  for (const part of parts) {
    const check = validateSingleToken(part);
    if (!check.ok) return { ok: false, message: `Each word in a phrase must be a valid dictionary word (${check.message})` };
  }
  if (parts.length < 2) return { ok: false, message: "A phrase needs at least two words separated by spaces." };
  return { ok: true, word: collapsed };
}

/** Why `candidate` cannot be added beside `existing` entries of the same scope, or null. */
export function findDuplicate<T extends DictionaryWord>(existing: readonly T[], candidate: DictionaryWord): T | null {
  const key = wordKey(candidate.word);
  return (
    existing.find(
      (e) => normalizeWord(e.word) === normalizeWord(candidate.word) || (wordKey(e.word) === key && (!e.caseSensitive || !candidate.caseSensitive)),
    ) ?? null
  );
}

function phraseBoundary(text: string, index: number): boolean {
  if (index < 0 || index >= text.length) return true;
  return !/[\p{L}\p{N}_]/u.test(text[index] ?? "");
}

function phraseMatches(text: string, start: number, phrase: string, caseSensitive: boolean): boolean {
  const slice = text.slice(start, start + phrase.length);
  if (slice.length !== phrase.length) return false;
  return caseSensitive
    ? slice === phrase
    : normalizeWord(slice).toLowerCase() === normalizeWord(phrase).toLowerCase();
}

function findPhraseOccurrences(text: string, phrase: string, caseSensitive: boolean): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  if (!phrase.length) return out;
  for (let i = 0; i <= text.length - phrase.length; i++) {
    if (!phraseBoundary(text, i - 1) || !phraseBoundary(text, i + phrase.length)) continue;
    if (phraseMatches(text, i, phrase, caseSensitive)) out.push({ start: i, end: i + phrase.length });
  }
  return out;
}

function mergeRanges(ranges: { start: number; end: number }[]): { start: number; end: number }[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: { start: number; end: number }[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.start < last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged;
}

function rangeCovers(token: WordToken, ranges: readonly { start: number; end: number }[]): boolean {
  return ranges.some((r) => token.start >= r.start && token.end <= r.end);
}

export class DictionaryMatcher {
  private readonly exact = new Set<string>();
  private readonly anyCase = new Set<string>();
  private readonly phrases: DictionaryWord[];

  constructor(words: readonly DictionaryWord[]) {
    this.phrases = [];
    for (const w of words) {
      if (isDictionaryPhrase(w.word)) this.phrases.push(w);
      else if (w.caseSensitive) this.exact.add(normalizeWord(w.word));
      else this.anyCase.add(wordKey(w.word));
    }
    this.phrases.sort((a, b) => b.word.length - a.word.length);
  }

  get size(): number {
    return this.exact.size + this.anyCase.size + this.phrases.length;
  }

  /** True if the word, or the word without a possessive "'s", is an entry. */
  accepts(word: string): boolean {
    const w = normalizeWord(word);
    if (this.matches(w)) return true;
    const base = stripPossessive(w);
    return base !== null && this.matches(base);
  }

  private matches(w: string): boolean {
    return this.exact.has(w) || this.anyCase.has(w.toLowerCase());
  }

  phraseEntries(): readonly DictionaryWord[] {
    return this.phrases;
  }

  /** Character ranges in `text` covered by dictionary phrases (longest first). */
  phraseRanges(text: string): { start: number; end: number }[] {
    const raw: { start: number; end: number }[] = [];
    const used = new Set<string>();
    for (const entry of this.phrases) {
      const key = `${wordKey(entry.word)}|${entry.caseSensitive ? "1" : "0"}`;
      if (used.has(key)) continue;
      used.add(key);
      raw.push(...findPhraseOccurrences(text, entry.word, entry.caseSensitive));
    }
    return mergeRanges(raw);
  }
}

/** Optimal string alignment distance (adjacent swaps count as one edit), capped at `max + 1`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    rows.push([i]);
    for (let j = 1; j <= b.length; j++) {
      if (i === 0) {
        rows[0].push(j);
        continue;
      }
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, rows[i - 2][j - 2] + 1);
      rows[i].push(d);
    }
    if (i > 0 && Math.min(...rows[i]) > max) return max + 1;
  }
  return Math.min(rows[a.length][b.length], max + 1);
}

/**
 * Dictionary words close to `word`: same letters in other capitals, or one
 * or two edits away (one for short words). Used to point out a possible
 * misspelling of a name, never to accept it.
 */
export function similarDictionaryWords(word: string, entries: readonly DictionaryWord[], limit = 3): string[] {
  if (isDictionaryPhrase(word)) return [];
  const w = wordKey(word);
  const max = w.length <= 4 ? 1 : 2;
  return entries
    .filter((e) => !isDictionaryPhrase(e.word))
    .map((e) => ({ word: e.word, d: normalizeWord(e.word) === normalizeWord(word) ? Infinity : editDistance(w, wordKey(e.word), max) }))
    .filter((x) => x.d <= max)
    .sort((x, y) => x.d - y.d || x.word.localeCompare(y.word))
    .slice(0, limit)
    .map((x) => x.word);
}

export type SpellFlag = WordToken;

/** Words in `text` that are neither entries nor in the standard dictionary. */
export function findMisspellings(text: string, isKnown: (word: string) => boolean, matcher: DictionaryMatcher): SpellFlag[] {
  const covered = matcher.phraseRanges(text);
  const flags: SpellFlag[] = [];
  for (const token of spellTokens(text)) {
    if (rangeCovers(token, covered)) continue;
    if (matcher.accepts(token.word) || isKnown(token.word)) continue;
    flags.push(token);
  }
  return flags;
}

/** True if `replacement` drops or alters a word of `original` that the dictionary accepts. */
export function changesDictionaryWord(original: string, replacement: string, matcher: DictionaryMatcher): boolean {
  for (const entry of matcher.phraseEntries()) {
    const inOrig = findPhraseOccurrences(original, entry.word, entry.caseSensitive).length;
    const inRepl = findPhraseOccurrences(replacement, entry.word, entry.caseSensitive).length;
    if (inOrig > inRepl) return true;
  }
  const kept = new Map<string, number>();
  for (const t of spellTokens(replacement)) kept.set(t.word, (kept.get(t.word) ?? 0) + 1);
  for (const t of spellTokens(original)) {
    if (!matcher.accepts(t.word)) continue;
    const n = kept.get(t.word) ?? 0;
    if (n === 0) return true;
    kept.set(t.word, n - 1);
  }
  return false;
}

/** Distinct entries that occur in `text`, in the form the author entered them. */
export function dictionaryWordsIn(text: string, entries: readonly DictionaryWord[]): DictionaryWord[] {
  const exact = new Map<string, DictionaryWord[]>();
  const anyCase = new Map<string, DictionaryWord[]>();
  const phraseEntries = entries.filter((e) => isDictionaryPhrase(e.word));
  for (const e of entries) {
    if (isDictionaryPhrase(e.word)) continue;
    const map = e.caseSensitive ? exact : anyCase;
    const key = e.caseSensitive ? normalizeWord(e.word) : wordKey(e.word);
    map.set(key, [...(map.get(key) ?? []), e]);
  }
  const found = new Set<DictionaryWord>();
  const seen = new Set<string>();
  for (const token of spellTokens(text)) {
    const w = normalizeWord(token.word);
    if (seen.has(w)) continue;
    seen.add(w);
    const base = stripPossessive(w);
    for (const form of base === null ? [w] : [w, base]) {
      for (const e of exact.get(form) ?? []) found.add(e);
      for (const e of anyCase.get(form.toLowerCase()) ?? []) found.add(e);
    }
  }
  for (const entry of phraseEntries) {
    if (findPhraseOccurrences(text, entry.word, entry.caseSensitive).length) found.add(entry);
  }
  return entries.filter((e) => found.has(e));
}