/*
 * The one word-count implementation, used by the editor (live document and
 * selection counts) and by server pages (chapter and book totals).
 *
 * Record bodies are Markdown typed into a plain text box. Counting works on
 * the prose a reader would see, so Markdown symbols, link targets, image
 * references, HTML tags and comments are removed first.
 *
 * A word is a run of letters, digits and combining marks. These join two runs
 * into one word: an apostrophe (' or ’) or a hyphen (-, ‐, ‑) between them,
 * and ".", "," or ":" between digits. So "don't", "Mara’s", "well-known",
 * "mother-in-law", "3.14", "1,000" and "10:30" each count as one word.
 * Dashes (– —), slashes and spaced hyphens separate words: "yes—no" is two.
 * A leading or trailing apostrophe is not part of the word ("'tis" is one).
 * Symbol-only lines such as scene breaks (***, * * *, ---, #) count nothing.
 */

const IMAGE = /!\[[^\]]*\]\([^)]*\)/g;
const LINK = /\[([^\]]*)\]\([^)]*\)/g;
const REFERENCE_LINK = /\[([^\]]+)\]\[[^\]]*\]/g;
const LINK_DEFINITION = /^[ \t]{0,3}\[[^\]]+\]:[ \t]*\S+.*$/gm;
const FOOTNOTE_REF = /\[\^[^\]]+\]/g;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const HTML_TAG = /<\/?[A-Za-z][^>]*>/g;
const AUTOLINK = /<(?:https?:\/\/|mailto:)[^>]*>/gi;
const BARE_URL = /\bhttps?:\/\/\S+/gi;
const ORDERED_LIST_MARKER = /^([ \t]*(?:>[ \t]*)*)\d+[.)](?=[ \t])/gm;

const WORD = /[\p{L}\p{M}\p{N}]+(?:['’\u2010\u2011-][\p{L}\p{M}\p{N}]+|(?<=\p{N})[.,:]\p{N}+)*/gu;

/** The Markdown source reduced to the words a reader would see. */
export function visibleProse(markdown: string): string {
  return markdown
    .replace(HTML_COMMENT, " ")
    .replace(AUTOLINK, " ")
    .replace(IMAGE, " ")
    .replace(LINK, "$1")
    .replace(REFERENCE_LINK, "$1")
    .replace(LINK_DEFINITION, " ")
    .replace(FOOTNOTE_REF, " ")
    .replace(HTML_TAG, " ")
    .replace(BARE_URL, " ")
    .replace(ORDERED_LIST_MARKER, "$1");
}

export function countWords(markdown: string): number {
  if (!markdown) return 0;
  return visibleProse(markdown).match(WORD)?.length ?? 0;
}

const NUMBER_FORMAT = new Intl.NumberFormat("en-US");

export function formatWordCount(count: number): string {
  return `${NUMBER_FORMAT.format(count)} word${count === 1 ? "" : "s"}`;
}
