/*
 * Literal find and replace over one document's text. Searches never use
 * pattern syntax: every character in the query matches itself. Matches do
 * not overlap. Replacements are expressed as a single range edit so the
 * editor can apply them as one undoable step and, if needed, invert them.
 */

export interface FindOptions {
  matchCase: boolean;
  /** When set, a match must not sit inside a longer word (letters, numbers, underscore). */
  wholeWord?: boolean;
}

export interface Match {
  start: number;
  end: number;
}

/** Replace text[start, end) with `text`. */
export interface TextEdit {
  start: number;
  end: number;
  text: string;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isWordChar(ch: string): boolean {
  return /[\p{L}\p{N}_]/u.test(ch);
}

function isWholeWord(text: string, start: number, end: number): boolean {
  if (start > 0 && isWordChar(text[start - 1]!)) return false;
  if (end < text.length && isWordChar(text[end]!)) return false;
  return true;
}

export function findMatches(text: string, query: string, options: FindOptions): Match[] {
  if (!query) return [];
  const re = new RegExp(escapeRegExp(query), options.matchCase ? "gu" : "giu");
  const raw = [...text.matchAll(re)].map((m) => ({ start: m.index!, end: m.index! + m[0].length }));
  if (!options.wholeWord) return raw;
  return raw.filter((m) => isWholeWord(text, m.start, m.end));
}

/** Stable id for a single literal match within one record field. */
export function matchId(recordId: string, field: "title" | "body", start: number, end: number): string {
  return `${recordId}:${field}:${start}:${end}`;
}

/** Apply the given non-overlapping matches from end to start (replacement is literal). */
export function applySelectedReplacements(
  text: string,
  matches: readonly Match[],
  replacement: string,
): string {
  if (matches.length === 0) return text;
  return applyPerMatchReplacements(
    text,
    matches.map((m) => ({ ...m, replacement })),
  );
}

/** Each match may use a different replacement string. Overlapping matches are not supported. */
export function applyPerMatchReplacements(
  text: string,
  matches: readonly (Match & { replacement: string })[],
): string {
  if (matches.length === 0) return text;
  const sorted = [...matches].sort((a, b) => b.start - a.start);
  let out = text;
  for (const m of sorted) {
    out = out.slice(0, m.start) + m.replacement + out.slice(m.end);
  }
  return out;
}

/** Index of the match occupying exactly [start, end), or -1. */
export function matchAt(matches: readonly Match[], start: number, end: number): number {
  return matches.findIndex((m) => m.start === start && m.end === end);
}

/** The match after the selection (or after the current match), wrapping to the first. */
export function nextMatch(matches: readonly Match[], selStart: number, selEnd: number): number {
  if (matches.length === 0) return -1;
  const from = matchAt(matches, selStart, selEnd) >= 0 ? selEnd : selStart;
  const i = matches.findIndex((m) => m.start >= from && !(m.start === selStart && m.end === selEnd));
  return i >= 0 ? i : 0;
}

/** The match before the selection, wrapping to the last. */
export function previousMatch(matches: readonly Match[], selStart: number): number {
  if (matches.length === 0) return -1;
  for (let i = matches.length - 1; i >= 0; i -= 1) if (matches[i].end <= selStart) return i;
  return matches.length - 1;
}

export function replaceOneEdit(match: Match, replacement: string): TextEdit {
  return { start: match.start, end: match.end, text: replacement };
}

/** One edit spanning the first to the last match, so "replace all" is a single step. */
export function replaceAllEdit(text: string, matches: readonly Match[], replacement: string): TextEdit | null {
  if (matches.length === 0) return null;
  const start = matches[0].start;
  const end = matches[matches.length - 1].end;
  let out = "";
  let pos = start;
  for (const m of matches) {
    out += text.slice(pos, m.start) + replacement;
    pos = m.end;
  }
  return { start, end, text: out };
}

export function applyEdit(text: string, edit: TextEdit): string {
  return text.slice(0, edit.start) + edit.text + text.slice(edit.end);
}

/** The edit that undoes `edit` when applied to the edited text. */
export function invertEdit(original: string, edit: TextEdit): TextEdit {
  return { start: edit.start, end: edit.start + edit.text.length, text: original.slice(edit.start, edit.end) };
}

export type RegexPreviewError = "too_long" | "nested" | "invalid" | "slow";

const MAX_REGEX_LENGTH = 200;
const MAX_REGEX_MATCHES = 500;
const MAX_REGEX_MS = 40;

/** Rejects patterns that are invalid or likely to hang a preview. Does not run the search. */
export function regexPreviewError(pattern: string): RegexPreviewError | null {
  if (!pattern) return null;
  if (pattern.length > MAX_REGEX_LENGTH) return "too_long";
  if (/\([^)]*[+*][^)]*\)[+*{]/.test(pattern) || /\(\?:[^)]*[+*][^)]*\)[+*{]/.test(pattern)) return "nested";
  try {
    const re = new RegExp(pattern, "u");
    re.test("");
  } catch {
    return "invalid";
  }
  return null;
}

/**
 * Finds matches for an author-written pattern. The replacement stays literal:
 * `$1` is not expanded. Returns an error instead of hanging on a bad pattern.
 */
export function findRegexMatches(
  text: string,
  pattern: string,
  options: FindOptions,
): { matches: Match[]; error: RegexPreviewError | null } {
  const error = regexPreviewError(pattern);
  if (error || !pattern) return { matches: [], error };
  let re: RegExp;
  try {
    re = new RegExp(pattern, options.matchCase ? "gu" : "giu");
  } catch {
    return { matches: [], error: "invalid" };
  }
  const matches: Match[] = [];
  const started = Date.now();
  for (const match of text.matchAll(re)) {
    if (Date.now() - started > MAX_REGEX_MS) return { matches: [], error: "slow" };
    if (match[0].length === 0) {
      re.lastIndex += 1;
      continue;
    }
    const found = { start: match.index!, end: match.index! + match[0].length };
    if (options.wholeWord && !isWholeWord(text, found.start, found.end)) continue;
    matches.push(found);
    if (matches.length >= MAX_REGEX_MATCHES) break;
  }
  return { matches, error: null };
}
