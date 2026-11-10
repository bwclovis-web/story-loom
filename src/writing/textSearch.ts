import { findMatches, type FindOptions } from "./findReplace";

/*
 * Literal search across saved text, with short excerpts around each match.
 * Matching is the same as the editor's Find (`findMatches`), so a result that
 * opens the editor with Find filled in shows the same matches.
 */

/** Characters of text kept on each side of a match in an excerpt. */
export const EXCERPT_CONTEXT = 60;

export interface Excerpt {
  before: string;
  match: string;
  after: string;
  /** Text was cut before `before` / after `after`. */
  cutBefore: boolean;
  cutAfter: boolean;
}

export interface TextSearchResult {
  count: number;
  /** Excerpts for the first `limit` matches; `count` says how many there are in all. */
  excerpts: Excerpt[];
}

const flatten = (s: string) => s.replace(/\s+/g, " ");

function excerptAt(text: string, start: number, end: number): Excerpt {
  let from = Math.max(0, start - EXCERPT_CONTEXT);
  let to = Math.min(text.length, end + EXCERPT_CONTEXT);
  // Start and end on a word boundary when one is near.
  if (from > 0) {
    const space = text.indexOf(" ", from);
    if (space >= 0 && space < start) from = space + 1;
  }
  if (to < text.length) {
    const space = text.lastIndexOf(" ", to);
    if (space > end) to = space;
  }
  return {
    before: flatten(text.slice(from, start)).trimStart(),
    match: flatten(text.slice(start, end)),
    after: flatten(text.slice(end, to)).trimEnd(),
    cutBefore: from > 0,
    cutAfter: to < text.length,
  };
}

export function searchText(text: string, query: string, options: FindOptions & { limit: number }): TextSearchResult {
  const matches = findMatches(text, query, options);
  return {
    count: matches.length,
    excerpts: matches.slice(0, options.limit).map((m) => excerptAt(text, m.start, m.end)),
  };
}
