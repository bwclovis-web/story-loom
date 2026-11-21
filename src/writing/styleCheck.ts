import type { CrossRefIndex } from "./crossRefs";
import { findMatches } from "./findReplace";

export type StyleCheckKind = "echo" | "filter" | "adverb" | "long_sentence" | "name_repeat" | "passive" | "weak_verb";

export interface StyleIssue {
  kind: StyleCheckKind;
  start: number;
  end: number;
  detail: string;
}

export interface StyleCheckOptions {
  echoWordWindow?: number;
  echoMinLetters?: number;
  longSentenceWords?: number;
  nameWordWindow?: number;
  nameRepeatCount?: number;
  characterNames?: readonly string[];
  maxIssues?: number;
}

const DEFAULT_OPTS: Required<Omit<StyleCheckOptions, "characterNames">> & { characterNames: readonly string[] } = {
  echoWordWindow: 12,
  echoMinLetters: 4,
  longSentenceWords: 40,
  nameWordWindow: 60,
  nameRepeatCount: 3,
  characterNames: [],
  maxIssues: 400,
};

/** Weak words that often clutter prose. Whole-word, case-insensitive. */
export const FILTER_WORDS = [
  "just",
  "very",
  "really",
  "quite",
  "rather",
  "somewhat",
  "suddenly",
  "actually",
  "basically",
  "literally",
  "maybe",
  "perhaps",
  "seemed",
  "seems",
  "almost",
  "simply",
  "totally",
  "absolutely",
  "definitely",
  "certainly",
  "obviously",
  "apparently",
  "hopefully",
  "finally",
] as const;

/** Words ending in -ly that are usually not adverbs. */
const ADVERB_EXCEPTIONS = new Set([
  "family",
  "only",
  "ugly",
  "lonely",
  "likely",
  "lovely",
  "lively",
  "holy",
  "jelly",
  "belly",
  "ally",
  "apply",
  "supply",
  "reply",
  "early",
  "daily",
  "weekly",
  "monthly",
  "it",
  "italy",
]);

interface WordToken {
  start: number;
  end: number;
  lower: string;
}

function tokenizeWords(text: string): WordToken[] {
  const tokens: WordToken[] = [];
  const re = /[\p{L}\p{M}][\p{L}\p{M}'\u2019-]*/gu;
  for (const m of text.matchAll(re)) {
    const word = m[0];
    tokens.push({ start: m.index!, end: m.index! + word.length, lower: word.toLocaleLowerCase() });
  }
  return tokens;
}

function snippet(text: string, start: number, end: number, radius = 24): string {
  const left = Math.max(0, start - radius);
  const right = Math.min(text.length, end + radius);
  const excerpt = text.slice(left, right).replace(/\s+/g, " ").trim();
  return excerpt.length > 72 ? `${excerpt.slice(0, 69)}…` : excerpt;
}

function pushIssue(out: StyleIssue[], issue: StyleIssue, max: number): boolean {
  if (out.length >= max) return false;
  out.push(issue);
  return true;
}

function findEchoes(text: string, tokens: WordToken[], opts: typeof DEFAULT_OPTS, out: StyleIssue[]): void {
  const { echoWordWindow, echoMinLetters, maxIssues } = opts;
  const flagged = new Set<number>();
  for (let i = 1; i < tokens.length; i++) {
    if (out.length >= maxIssues) return;
    const t = tokens[i]!;
    if (t.lower.length < echoMinLetters || flagged.has(i)) continue;
    let repeated = false;
    for (let j = i - 1; j >= 0 && i - j < echoWordWindow; j--) {
      const prev = tokens[j]!;
      if (prev.lower.length >= echoMinLetters && prev.lower === t.lower) {
        repeated = true;
        break;
      }
    }
    if (!repeated) continue;
    flagged.add(i);
    if (
      !pushIssue(
        out,
        {
          kind: "echo",
          start: t.start,
          end: t.end,
          detail: `“${text.slice(t.start, t.end)}” repeats within ${echoWordWindow} words (${snippet(text, t.start, t.end)})`,
        },
        maxIssues,
      )
    ) {
      return;
    }
  }
}

function findFilterWords(text: string, opts: typeof DEFAULT_OPTS, out: StyleIssue[]): void {
  for (const word of FILTER_WORDS) {
    if (out.length >= opts.maxIssues) return;
    for (const m of findMatches(text, word, { matchCase: false, wholeWord: true })) {
      if (
        !pushIssue(
          out,
          {
            kind: "filter",
            start: m.start,
            end: m.end,
            detail: `Filter word “${text.slice(m.start, m.end)}” (${snippet(text, m.start, m.end)})`,
          },
          opts.maxIssues,
        )
      ) {
        return;
      }
    }
  }
}

function findAdverbs(text: string, opts: typeof DEFAULT_OPTS, out: StyleIssue[]): void {
  const re = /\b[\p{L}\p{M}]+ly\b/gu;
  for (const m of text.matchAll(re)) {
    if (out.length >= opts.maxIssues) return;
    const word = m[0];
    if (ADVERB_EXCEPTIONS.has(word.toLocaleLowerCase())) continue;
    if (word.length < 5) continue;
    const start = m.index!;
    const end = start + word.length;
    if (
      !pushIssue(
        out,
        {
          kind: "adverb",
          start,
          end,
          detail: `Adverb “${word}” (${snippet(text, start, end)})`,
        },
        opts.maxIssues,
      )
    ) {
      return;
    }
  }
}

function sentenceRanges(text: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (!/[.!?]/.test(ch)) continue;
    let j = i + 1;
    while (j < text.length && /[\s\u00a0]/.test(text[j]!)) j++;
    const end = j;
    const body = text.slice(start, i + 1);
    if (body.trim()) ranges.push({ start, end });
    start = end;
    i = j - 1;
  }
  if (start < text.length && text.slice(start).trim()) ranges.push({ start, end: text.length });
  return ranges;
}

function wordCountInRange(text: string, start: number, end: number): number {
  return tokenizeWords(text.slice(start, end)).length;
}

function findLongSentences(text: string, opts: typeof DEFAULT_OPTS, out: StyleIssue[]): void {
  for (const range of sentenceRanges(text)) {
    if (out.length >= opts.maxIssues) return;
    const words = wordCountInRange(text, range.start, range.end);
    if (words <= opts.longSentenceWords) continue;
    if (
      !pushIssue(
        out,
        {
          kind: "long_sentence",
          start: range.start,
          end: range.end,
          detail: `Long sentence (${words} words; over ${opts.longSentenceWords})`,
        },
        opts.maxIssues,
      )
    ) {
      return;
    }
  }
}

function tokenIndexFor(tokens: WordToken[], pos: number): number {
  let lo = 0;
  let hi = tokens.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = tokens[mid]!;
    if (pos < t.start) hi = mid - 1;
    else if (pos >= t.end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

function findNameRepeats(text: string, tokens: WordToken[], opts: typeof DEFAULT_OPTS, out: StyleIssue[]): void {
  const names = [...opts.characterNames].sort((a, b) => b.length - a.length || a.localeCompare(b));
  if (!names.length) return;
  for (const name of names) {
    if (out.length >= opts.maxIssues) return;
    const matches = findMatches(text, name, { matchCase: true, wholeWord: true });
    if (matches.length < opts.nameRepeatCount) continue;
    const tokenAt = matches.map((m) => tokenIndexFor(tokens, m.start));
    for (let i = 0; i < matches.length; i++) {
      if (out.length >= opts.maxIssues) return;
      const here = tokenAt[i];
      if (here < 0) continue;
      let cluster = 0;
      for (let j = i; j >= 0; j--) {
        const there = tokenAt[j];
        if (there < 0) continue;
        if (here - there > opts.nameWordWindow) break;
        cluster++;
      }
      if (cluster < opts.nameRepeatCount) continue;
      const m = matches[i]!;
      if (
        !pushIssue(
          out,
          {
            kind: "name_repeat",
            start: m.start,
            end: m.end,
            detail: `“${text.slice(m.start, m.end)}” appears ${cluster} times within ${opts.nameWordWindow} words`,
          },
          opts.maxIssues,
        )
      ) {
        return;
      }
    }
  }
}

/** Deterministic local style pass on Markdown source text. Nothing is changed. */
export function runStyleCheck(text: string, options: StyleCheckOptions = {}): StyleIssue[] {
  const opts = { ...DEFAULT_OPTS, ...options, characterNames: options.characterNames ?? DEFAULT_OPTS.characterNames };
  const out: StyleIssue[] = [];
  if (!text.trim()) return out;
  const tokens = tokenizeWords(text);
  findLongSentences(text, opts, out);
  findFilterWords(text, opts, out);
  findAdverbs(text, opts, out);
  findNameRepeats(text, tokens, opts, out);
  findEchoes(text, tokens, opts, out);
  findPassiveAndWeak(text, opts, out);
  out.sort((a, b) => a.start - b.start || a.end - b.end || a.kind.localeCompare(b.kind));
  return out;
}

const PASSIVE =
  /\b(?:was|were|is|are|been|be|being)\s+(?:[\p{L}\p{M}'-]+ed|known|seen|done|made|taken|given|told|written|found|left|kept)\b/giu;
const WEAK_VERBS = ["got", "get", "went", "looked", "look", "walked", "walk"] as const;

function findPassiveAndWeak(text: string, opts: typeof DEFAULT_OPTS, out: StyleIssue[]): void {
  for (const match of text.matchAll(PASSIVE)) {
    if (
      !pushIssue(
        out,
        {
          kind: "passive",
          start: match.index!,
          end: match.index! + match[0].length,
          detail: `Possible passive: “${snippet(text, match.index!, match.index! + match[0].length)}”`,
        },
        opts.maxIssues,
      )
    ) {
      return;
    }
  }
  for (const verb of WEAK_VERBS) {
    const hits = findMatches(text, verb, { matchCase: false, wholeWord: true });
    for (const hit of hits) {
      if (
        !pushIssue(
          out,
          {
            kind: "weak_verb",
            start: hit.start,
            end: hit.end,
            detail: `Weak verb “${text.slice(hit.start, hit.end)}”`,
          },
          opts.maxIssues,
        )
      ) {
        return;
      }
    }
  }
}

export interface DialogueRatio {
  dialogueWords: number;
  narrationWords: number;
}

/** Words inside straight or curly quotes, compared with the rest of the text. */
export function dialogueRatio(text: string): DialogueRatio {
  const quoted = text.match(/"[^"\n]{0,500}"|“[^”\n]{0,500}”/g) ?? [];
  const dialogueWords = quoted.reduce((sum, part) => sum + tokenizeWords(part).length, 0);
  const narrationWords = Math.max(0, tokenizeWords(text).length - dialogueWords);
  return { dialogueWords, narrationWords };
}

export interface PovCount {
  name: string;
  count: number;
}

export function povCounts(text: string, names: readonly string[]): PovCount[] {
  return names
    .map((name) => ({ name, count: findMatches(text, name, { matchCase: true, wholeWord: true }).length }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function styleCheckNameTerms(index: CrossRefIndex): string[] {
  return [...index.names.keys()].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

/** Selection end for highlighting an issue in the editor (UTF-16 offsets on saved text). */
export function styleIssueSelectionEnd(issue: Pick<StyleIssue, "kind" | "start" | "end">): number {
  return styleRangeHighlightEnd(issue.start, issue.end, issue.kind === "long_sentence");
}

/** From a start/end pair (e.g. a style-check deep link). Long spans select an initial slice only. */
export function styleRangeHighlightEnd(start: number, end: number, forceLong = false): number {
  const span = end - start;
  return forceLong || span > 120 ? start + Math.min(80, span) : end;
}

export function parseStyleRangeQuery(input: {
  styleStart?: string;
  styleEnd?: string;
}): { start: number; end: number } | null {
  if (input.styleStart === undefined || input.styleEnd === undefined) return null;
  const start = Number(input.styleStart);
  const end = Number(input.styleEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) return null;
  return { start: Math.floor(start), end: Math.floor(end) };
}