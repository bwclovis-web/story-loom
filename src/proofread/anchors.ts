import type { DraftSuggestion, ProofreadCategory } from "./output";

/*
 * Turns the model's quoted suggestions into located suggestions on the exact
 * text that was proofread. Offsets are UTF-16 code units in the record's
 * Markdown source with line endings as "\n", which is how the editor's text
 * box counts them. They are never derived from rendered text.
 *
 * A suggestion is kept only if its quote occurs exactly once in the text sent
 * (with its context), it changes no line breaks or formatting symbols, and it
 * stays clear of code, link addresses and HTML. Everything else is reported
 * as rejected with a reason; nothing is dropped silently.
 */

export interface TextRange {
  start: number;
  end: number;
}

export interface ProofreadSuggestion {
  /** Stable within one proofreading run: s1, s2, ... in text order. */
  id: string;
  category: ProofreadCategory;
  original: string;
  replacement: string;
  explanation: string;
  /** Range of `original` in the proofread text. */
  start: number;
  end: number;
  /** Text right before and after the range, taken from the proofread text (not from the model). */
  before: string;
  after: string;
  /** Other suggestions whose ranges overlap this one; accepting one makes the others stale. */
  overlaps: string[];
}

export type RejectionReason =
  | "empty"
  | "unchanged"
  | "too_long"
  | "line_break"
  | "formatting"
  | "protected_markup"
  | "invalid_text"
  | "not_found"
  | "ambiguous"
  | "duplicate"
  | "dictionary_word";

export interface RejectedSuggestion {
  original: string;
  replacement: string;
  reason: RejectionReason;
  message: string;
}

export const MAX_SUGGESTION_CHARS = 200;
export const CONTEXT_CHARS = 40;

const REJECTION_TEXT: Record<RejectionReason, string> = {
  empty: "It did not quote any text to change.",
  unchanged: "The replacement is the same as the original.",
  too_long: `It would change more than ${MAX_SUGGESTION_CHARS} characters at once, which is a rewrite rather than a correction.`,
  line_break: "It would add or remove a line break, which changes the document structure.",
  formatting: "It would add, remove or move Markdown formatting symbols.",
  protected_markup: "It falls inside code, a link address, a URL or HTML.",
  invalid_text: "It would split a character (for example an accent or emoji from its base).",
  not_found: "Its quoted text does not appear exactly in the text sent (it may differ in quotes, accents or spacing).",
  ambiguous: "Its quoted text appears more than once and the context does not say which one.",
  duplicate: "It repeats another suggestion.",
  dictionary_word: "It would change a word in your dictionary.",
};

export function rejectionText(reason: RejectionReason): string {
  return REJECTION_TEXT[reason];
}

/** The text the editor shows and proofreading uses: the stored body with "\r\n" and "\r" as "\n". */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** Markdown symbols a correction must leave in place, in order. */
const MARKUP_CHARS = new Set(["*", "_", "`", "[", "]", "<", ">", "#", "|", "~", "\\"]);

export function markupSignature(text: string): string {
  let out = "";
  for (const ch of text) if (MARKUP_CHARS.has(ch)) out += ch;
  return out;
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const COMBINING = /^\p{M}/u;

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** True if a cut at `index` would separate a character from its second half or from a following accent. */
function splitsCharacter(text: string, index: number): boolean {
  if (index <= 0 || index >= text.length) return false;
  return isLowSurrogate(text.charCodeAt(index)) || COMBINING.test(text.slice(index, index + 2));
}

/**
 * Parts of Markdown source that are not prose: fenced code blocks, inline
 * code, link and image addresses, reference definitions, HTML tags and
 * comments, autolinks and bare URLs.
 */
export function markdownProtectedSpans(text: string): TextRange[] {
  const spans: TextRange[] = [];
  const add = (re: RegExp, offset = 0) => {
    for (const m of text.matchAll(re)) spans.push({ start: m.index + offset, end: m.index + m[0].length });
  };

  let pos = 0;
  let fenceStart = -1;
  let fence = "";
  for (const line of text.split("\n")) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fenceStart < 0 && marker) {
      fenceStart = pos;
      fence = marker[0];
    } else if (fenceStart >= 0 && marker && marker[0] === fence) {
      spans.push({ start: fenceStart, end: pos + line.length });
      fenceStart = -1;
    }
    pos += line.length + 1;
  }
  if (fenceStart >= 0) spans.push({ start: fenceStart, end: text.length });

  add(/(`+)[^`\n][^\n]*?\1/g);
  add(/\]\([^)\n]*\)/g);
  add(/^ {0,3}\[[^\]\n]+\]:[^\n]*$/gm);
  add(/<!--[\s\S]*?-->/g);
  add(/<\/?[A-Za-z][^>\n]*>/g);
  add(/<[A-Za-z][A-Za-z0-9+.-]*:[^>\s]*>/g);
  add(/\bhttps?:\/\/[^\s)>\]]+/g);
  return spans;
}

function intersects(a: TextRange, b: TextRange): boolean {
  return a.start < b.end && b.start < a.end;
}

function occurrences(haystack: string, needle: string): number[] {
  const found: number[] = [];
  if (!needle) return found;
  for (let i = haystack.indexOf(needle); i >= 0; i = haystack.indexOf(needle, i + 1)) found.push(i);
  return found;
}

function check(draft: DraftSuggestion): RejectionReason | null {
  if (!draft.original) return "empty";
  if (draft.original === draft.replacement) return "unchanged";
  if (draft.original.length > MAX_SUGGESTION_CHARS || draft.replacement.length > MAX_SUGGESTION_CHARS) return "too_long";
  if (/[\r\n]/.test(draft.original) || /[\r\n]/.test(draft.replacement)) return "line_break";
  if (markupSignature(draft.original) !== markupSignature(draft.replacement)) return "formatting";
  if ([draft.before, draft.original, draft.after, draft.replacement].some((s) => LONE_SURROGATE.test(s))) return "invalid_text";
  return null;
}

/**
 * Locates the model's suggestions in `text` (the whole proofread document)
 * within `range` (the part that was sent).
 */
export function resolveSuggestions(
  text: string,
  range: TextRange,
  drafts: readonly DraftSuggestion[],
  /** Further reasons to leave a suggestion out, such as changing a dictionary word. */
  extraCheck?: (draft: DraftSuggestion) => RejectionReason | null,
): { suggestions: ProofreadSuggestion[]; rejected: RejectedSuggestion[] } {
  const sent = text.slice(range.start, range.end);
  const protectedSpans = markdownProtectedSpans(text);
  const rejected: RejectedSuggestion[] = [];
  const located: Omit<ProofreadSuggestion, "id" | "overlaps">[] = [];
  const reject = (d: DraftSuggestion, reason: RejectionReason) =>
    rejected.push({ original: d.original, replacement: d.replacement, reason, message: REJECTION_TEXT[reason] });

  for (const draft of drafts) {
    const problem = check(draft) ?? extraCheck?.(draft) ?? null;
    if (problem) {
      reject(draft, problem);
      continue;
    }
    const withContext = occurrences(sent, draft.before + draft.original + draft.after);
    let index: number;
    if (withContext.length === 1) index = withContext[0] + draft.before.length;
    else if (withContext.length > 1) {
      reject(draft, "ambiguous");
      continue;
    } else {
      const bare = occurrences(sent, draft.original);
      if (bare.length !== 1) {
        reject(draft, bare.length ? "ambiguous" : "not_found");
        continue;
      }
      index = bare[0];
    }

    const start = range.start + index;
    const end = start + draft.original.length;
    if (splitsCharacter(text, start) || splitsCharacter(text, end)) {
      reject(draft, "invalid_text");
      continue;
    }
    if (protectedSpans.some((s) => intersects(s, { start, end }))) {
      reject(draft, "protected_markup");
      continue;
    }
    if (located.some((l) => l.start === start && l.end === end && l.replacement === draft.replacement)) {
      reject(draft, "duplicate");
      continue;
    }
    located.push({
      category: draft.category,
      original: draft.original,
      replacement: draft.replacement,
      explanation: draft.explanation.trim(),
      start,
      end,
      before: text.slice(Math.max(0, start - CONTEXT_CHARS), start),
      after: text.slice(end, end + CONTEXT_CHARS),
    });
  }

  const sorted = located
    .map((l, i) => ({ l, i }))
    .sort((a, b) => a.l.start - b.l.start || a.l.end - b.l.end || a.i - b.i)
    .map(({ l }, n) => ({ ...l, id: `s${n + 1}`, overlaps: [] as string[] }));
  for (const a of sorted) {
    for (const b of sorted) if (a !== b && intersects(a, b)) a.overlaps.push(b.id);
  }
  return { suggestions: sorted, rejected };
}
