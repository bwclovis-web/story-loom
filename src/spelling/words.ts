import { markdownProtectedSpans } from "@/proofread/anchors";

/*
 * Words for spell checking, found in the Markdown source exactly as the
 * editor's text box holds it (UTF-16 offsets, line endings as "\n"). Code,
 * link addresses, URLs and HTML are skipped, as are words joined to digits
 * or underscores (identifiers, "3rd" style tokens). A hyphenated word is
 * checked part by part.
 */

export interface WordToken {
  start: number;
  end: number;
  word: string;
}

/** Letters and marks, with apostrophes only between letters ("don't", "Aldreth's"). */
const WORD = /[\p{L}\p{M}](?:[\p{L}\p{M}]|['’](?=[\p{L}\p{M}]))*/gu;
const JOINED = /[\p{N}_]/u;

function mergedSpans(text: string): { start: number; end: number }[] {
  const merged: { start: number; end: number }[] = [];
  for (const span of markdownProtectedSpans(text).sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}

export function spellTokens(text: string): WordToken[] {
  const spans = mergedSpans(text);
  const tokens: WordToken[] = [];
  let s = 0;
  for (const m of text.matchAll(WORD)) {
    const start = m.index;
    const end = start + m[0].length;
    while (s < spans.length && spans[s].end <= start) s++;
    if (s < spans.length && spans[s].start < end) continue;
    if (m[0].length < 2) continue;
    const prev = text[start - 1] ?? "";
    const next = text[end] ?? "";
    if (JOINED.test(prev) || JOINED.test(next)) continue;
    if (prev === "&" && next === ";") continue;
    tokens.push({ start, end, word: m[0] });
  }
  return tokens;
}

/** The form words are compared in: composed accents, straight apostrophes. */
export function normalizeWord(word: string): string {
  return word.normalize("NFC").replace(/’/g, "'");
}

export function stripAccents(word: string): string {
  return word.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");
}

/** "Aldreth's" -> "Aldreth"; null when there is no possessive ending. */
export function stripPossessive(word: string): string | null {
  const m = /^(.+)'[sS]$/.exec(word);
  return m ? m[1] : null;
}

export interface BaseDictionary {
  check(word: string): boolean;
}

/**
 * Wraps the standard dictionary: compares normalised words, falls back to the
 * accent-free form (the bundled English dictionaries store words without
 * accents), and caches results because a chapter repeats most of its words.
 */
export function createWordChecker(base: BaseDictionary, maxCache = 100_000): (word: string) => boolean {
  const cache = new Map<string, boolean>();
  return (word) => {
    const w = normalizeWord(word);
    const hit = cache.get(w);
    if (hit !== undefined) return hit;
    let known = base.check(w);
    if (!known) {
      const plain = stripAccents(w);
      if (plain !== w) known = base.check(plain);
    }
    if (cache.size >= maxCache) cache.clear();
    cache.set(w, known);
    return known;
  };
}
