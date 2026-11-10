/*
 * Tidy for manuscript text: paragraph spacing, headings, scene breaks and,
 * optionally, typographer's quotes, dashes and ellipses. Pure and idempotent:
 * tidying tidy text changes nothing. Fenced code, YAML front matter, code
 * spans, link addresses, URLs and HTML comments are left exactly as they are.
 * Single line breaks inside a paragraph are kept, because the app shows them
 * as line breaks.
 */

import { SCENE_BREAK } from "./markdownFormat";

export interface TidyOptions {
  /** Curly quotes and apostrophes, em dashes for `--`, and … for `...`. */
  typography: boolean;
}

export interface TidyReport {
  blankLines: number;
  /** Blank lines added so a heading or scene break stands apart. */
  spacing: number;
  trailingSpaces: number;
  headings: number;
  sceneBreaks: number;
  quotes: number;
  dashes: number;
  ellipses: number;
}

export interface TidyResult {
  text: string;
  changed: boolean;
  report: TidyReport;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const BREAK_LINE = /^ {0,3}(?:([-*_])(?:[ \t]*\1){2,}|#|⁂)[ \t]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const HEADING_NO_SPACE = /^ {0,3}(#{1,6})(\p{L}.*?)(?:[ \t]+#+)?[ \t]*$/u;
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
const FRONT_MATTER_LINE = /^(?:[\w-]+:.*|[ \t].*|- .*|)$/;
/** Pieces of a line that typography must not touch. */
const PROTECTED = /(`+)[^`]*?\1|\]\([^)]*\)|<!--.*?-->|<[^>\s]+>|https?:\/\/\S+/g;
const OPENS_BEFORE = /[\s([{\u2014\u2013\u2018\u201C*_~/-]/;
/** After a dash, a quote followed by a space or punctuation closes speech ("I was going to—" she said). */
const CLOSES_AFTER = /^$|[\s.,;:!?)\]}]/;
const ELISION = /^(?:\d\ds?\b|tis\b|twas\b|em\b|cause\b|n\b|til\b)/i;

function emptyReport(): TidyReport {
  return { blankLines: 0, spacing: 0, trailingSpaces: 0, headings: 0, sceneBreaks: 0, quotes: 0, dashes: 0, ellipses: 0 };
}

function frontMatterEnd(lines: string[]): number {
  if (lines[0] !== "---") return -1;
  for (let i = 1; i < Math.min(lines.length, 60); i++) {
    if (lines[i] === "---" || lines[i] === "...") return i;
    if (!FRONT_MATTER_LINE.test(lines[i])) return -1;
  }
  return -1;
}

function typographize(gap: string, before: string, report: TidyReport): string {
  let out = "";
  let prev = before;
  for (let i = 0; i < gap.length; i++) {
    const ch = gap[i];
    const rest = gap.slice(i + 1);
    let next = ch;
    if (ch === '"') {
      const after = gap[i + 1] ?? "";
      const opens = !prev || /[\s([{\u201C\u2018]/.test(prev) || (!CLOSES_AFTER.test(after) && OPENS_BEFORE.test(prev));
      next = opens ? "\u201C" : "\u201D";
      report.quotes++;
    } else if (ch === "'") {
      const after = gap[i + 1] ?? "";
      if (/[\p{L}\p{N}]/u.test(prev)) next = "\u2019";
      else if (!prev || OPENS_BEFORE.test(prev)) next = ELISION.test(rest) ? "\u2019" : after && /\S/.test(after) ? "\u2018" : "\u2019";
      else next = "\u2019";
      report.quotes++;
    } else if (ch === "-" && gap[i + 1] === "-") {
      let run = 2;
      while (gap[i + run] === "-") run++;
      if (run <= 3) {
        next = "\u2014";
        i += run - 1;
        report.dashes++;
      } else {
        next = gap.slice(i, i + run);
        i += run - 1;
      }
    } else if (ch === "." && gap.startsWith("..", i + 1)) {
      next = "\u2026";
      i += 2;
      report.ellipses++;
    } else if (ch === "." && gap.startsWith(" . .", i + 1)) {
      next = "\u2026";
      i += 4;
      report.ellipses++;
    }
    out += next;
    prev = next[next.length - 1];
  }
  return out;
}

function typographyLine(line: string, report: TidyReport): string {
  if (TABLE_RULE.test(line) && line.includes("|")) return line;
  let out = "";
  let last = 0;
  for (const m of line.matchAll(PROTECTED)) {
    out += typographize(line.slice(last, m.index), out[out.length - 1] ?? "", report) + m[0];
    last = m.index + m[0].length;
  }
  return out + typographize(line.slice(last), out[out.length - 1] ?? "", report);
}

export function tidyText(input: string, options: TidyOptions = { typography: true }): TidyResult {
  const report = emptyReport();
  const lines = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const fmEnd = frontMatterEnd(lines);

  type Line = { text: string; verbatim: boolean; block?: boolean };
  const out: Line[] = [];
  let fence: string | null = null;

  for (const [i, raw] of lines.entries()) {
    if (i <= fmEnd) {
      out.push({ text: raw, verbatim: true });
      continue;
    }
    if (fence) {
      out.push({ text: raw, verbatim: true });
      if (new RegExp(`^ {0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}[ \\t]*$`).test(raw)) fence = null;
      continue;
    }
    const open = FENCE.exec(raw);
    if (open) {
      fence = open[1];
      out.push({ text: raw.replace(/[ \t]+$/, ""), verbatim: true });
      continue;
    }

    let line = raw.replace(/[ \t]+$/, "");
    if (line !== raw) report.trailingSpaces++;

    if (BREAK_LINE.test(line)) {
      if (line !== SCENE_BREAK) report.sceneBreaks++;
      out.push({ text: SCENE_BREAK, verbatim: false, block: true });
      continue;
    }
    const heading = HEADING.exec(line) ?? HEADING_NO_SPACE.exec(line);
    if (heading && heading[2]) {
      let tidy = `${heading[1]} ${heading[2].trim()}`;
      if (options.typography) tidy = typographyLine(tidy, report);
      const plain = options.typography ? typographyLine(line, emptyReport()) : line;
      if (tidy !== plain) report.headings++;
      out.push({ text: tidy, verbatim: false, block: true });
      continue;
    }
    if (options.typography) line = typographyLine(line, report);
    out.push({ text: line, verbatim: false });
  }

  // Headings and scene breaks stand apart; runs of blank lines become one.
  const spaced: Line[] = [];
  for (const [i, line] of out.entries()) {
    const prev = spaced[spaced.length - 1];
    if (line.block && prev && prev.text !== "") {
      spaced.push({ text: "", verbatim: false });
      report.spacing++;
    } else if (!line.verbatim && line.text === "" && prev && prev.text === "" && !prev.verbatim) {
      report.blankLines++;
      continue;
    }
    spaced.push(line);
    const next = out[i + 1];
    if (line.block && next && next.text !== "" && !next.block) {
      spaced.push({ text: "", verbatim: false });
      report.spacing++;
    }
  }
  while (spaced.length && spaced[0].text === "" && !spaced[0].verbatim) {
    spaced.shift();
    report.blankLines++;
  }
  while (spaced.length && spaced[spaced.length - 1].text === "" && !spaced[spaced.length - 1].verbatim) {
    spaced.pop();
    report.blankLines++;
  }

  const text = spaced.map((l) => l.text).join("\n");
  return { text, changed: text !== input, report };
}
