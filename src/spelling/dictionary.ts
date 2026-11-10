import { normalizeWord, spellTokens, stripPossessive, type WordToken } from "./words";

/*
 * The author's dictionary: words accepted as correctly spelled. An entry
 * applies to one project (a book) or to its whole workspace (every book in
 * the series). Entries only stop spelling flags. They match exactly: a
 * similar but different word is still flagged, and similar entries are
 * pointed out rather than merged, because two close names may be a typo or
 * two different characters.
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

/** Names usually keep their capitals; ordinary invented words usually do not. */
export function defaultCaseSensitive(word: string): boolean {
  return word !== word.toLowerCase();
}

export type WordCheck = { ok: true; word: string } | { ok: false; message: string };

/** An entry must be one word as the spell checker sees it, so that it can match. */
export function validateDictionaryWord(raw: string): WordCheck {
  const word = normalizeWord(raw.trim());
  if (!word) return { ok: false, message: "Type a word." };
  if (word.length > MAX_WORD_CHARS) return { ok: false, message: `A word can have at most ${MAX_WORD_CHARS} characters.` };
  if (/\s/.test(word)) return { ok: false, message: "Add one word at a time. For a name of several words, add each word." };
  if (word.includes("-")) return { ok: false, message: "Hyphenated words are checked part by part. Add each part separately." };
  const tokens = spellTokens(word);
  if (tokens.length !== 1 || tokens[0].start !== 0 || tokens[0].end !== word.length) {
    return { ok: false, message: "Use letters only, with apostrophes only between letters (no digits, symbols or single letters)." };
  }
  return { ok: true, word };
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

export class DictionaryMatcher {
  private readonly exact = new Set<string>();
  private readonly anyCase = new Set<string>();

  constructor(words: readonly DictionaryWord[]) {
    for (const w of words) {
      if (w.caseSensitive) this.exact.add(normalizeWord(w.word));
      else this.anyCase.add(wordKey(w.word));
    }
  }

  get size(): number {
    return this.exact.size + this.anyCase.size;
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
  const w = wordKey(word);
  const max = w.length <= 4 ? 1 : 2;
  return entries
    .map((e) => ({ word: e.word, d: normalizeWord(e.word) === normalizeWord(word) ? Infinity : editDistance(w, wordKey(e.word), max) }))
    .filter((x) => x.d <= max)
    .sort((x, y) => x.d - y.d || x.word.localeCompare(y.word))
    .slice(0, limit)
    .map((x) => x.word);
}

export type SpellFlag = WordToken;

/** Words in `text` that are neither entries nor in the standard dictionary. */
export function findMisspellings(text: string, isKnown: (word: string) => boolean, matcher: DictionaryMatcher): SpellFlag[] {
  const flags: SpellFlag[] = [];
  for (const token of spellTokens(text)) {
    if (matcher.accepts(token.word) || isKnown(token.word)) continue;
    flags.push(token);
  }
  return flags;
}

/** True if `replacement` drops or alters a word of `original` that the dictionary accepts. */
export function changesDictionaryWord(original: string, replacement: string, matcher: DictionaryMatcher): boolean {
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
  for (const e of entries) {
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
  return entries.filter((e) => found.has(e));
}
