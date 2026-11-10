/*
 * Literal find and replace over one document's text. Searches never use
 * pattern syntax: every character in the query matches itself. Matches do
 * not overlap. Replacements are expressed as a single range edit so the
 * editor can apply them as one undoable step and, if needed, invert them.
 */

export interface FindOptions {
  matchCase: boolean;
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

export function findMatches(text: string, query: string, options: FindOptions): Match[] {
  if (!query) return [];
  const re = new RegExp(escapeRegExp(query), options.matchCase ? "gu" : "giu");
  return [...text.matchAll(re)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
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
