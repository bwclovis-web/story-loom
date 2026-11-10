/*
 * Toolbar formatting for Markdown text. Each command returns one range edit,
 * so the editor can apply it as a single undoable step, and the selection to
 * restore afterwards. Markdown has no underline, so there is none here.
 */

import type { TextEdit } from "./findReplace";

export interface Selection {
  start: number;
  end: number;
}

export interface FormatResult {
  edit: TextEdit;
  selection: Selection;
}

export type InlineStyle = "bold" | "italic";
export type BlockStyle = "paragraph" | "h1" | "h2" | "h3" | "quote";
export type ListKind = "bullet" | "number";

const STAR_RUN_LIMIT = 3;

function starsBefore(text: string, at: number): number {
  let n = 0;
  while (n < STAR_RUN_LIMIT && at - n - 1 >= 0 && text[at - n - 1] === "*") n++;
  return n;
}

function starsAfter(text: string, at: number): number {
  let n = 0;
  while (n < STAR_RUN_LIMIT && at + n < text.length && text[at + n] === "*") n++;
  return n;
}

/** Selection without surrounding spaces, and inside any star markers the author selected along with the words. */
function innerSelection(text: string, sel: Selection): Selection {
  let { start, end } = sel;
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  let k = 0;
  while (k < STAR_RUN_LIMIT && start + k < end - k && text[start + k] === "*" && text[end - 1 - k] === "*") k++;
  return { start: start + k, end: end - k };
}

function hasStyle(before: number, after: number, style: InlineStyle): boolean {
  const run = Math.min(before, after);
  return style === "bold" ? run >= 2 : run === 1 || run === 3;
}

/** Whether the selection (or the caret) sits inside bold or italic markers. */
export function inlineState(text: string, sel: Selection): Record<InlineStyle, boolean> {
  const inner = innerSelection(text, sel);
  const before = starsBefore(text, inner.start);
  const after = starsAfter(text, inner.end);
  return { bold: hasStyle(before, after, "bold"), italic: hasStyle(before, after, "italic") };
}

/** Adds or removes `**` (bold) or `*` (italic) around the selection. With no selection, inserts an empty pair. */
export function toggleInline(text: string, sel: Selection, style: InlineStyle): FormatResult {
  const marker = style === "bold" ? "**" : "*";
  const inner = innerSelection(text, sel);
  const before = starsBefore(text, inner.start);
  const after = starsAfter(text, inner.end);
  const content = text.slice(inner.start, inner.end);

  if (hasStyle(before, after, style)) {
    const m = marker.length;
    return {
      edit: { start: inner.start - m, end: inner.end + m, text: content },
      selection: { start: inner.start - m, end: inner.end - m },
    };
  }
  return {
    edit: { start: inner.start, end: inner.end, text: marker + content + marker },
    selection: { start: inner.start + marker.length, end: inner.end + marker.length },
  };
}

interface LinePrefix {
  /** Heading, quote or list marker at the start of the line, including its space. */
  block: string;
  heading: number;
  quote: boolean;
  list: ListKind | null;
}

const PREFIX = /^(#{1,6} |> ?|[-*+] |\d+[.)] )?/;

function linePrefix(line: string): LinePrefix {
  const block = PREFIX.exec(line)?.[1] ?? "";
  const heading = /^#{1,6} $/.test(block) ? block.length - 1 : 0;
  return {
    block,
    heading,
    quote: block.startsWith(">"),
    list: /^[-*+] $/.test(block) ? "bullet" : /^\d+[.)] $/.test(block) ? "number" : null,
  };
}

interface LineSpan {
  start: number;
  end: number;
  text: string;
}

/** Whole lines touched by the selection. A selection ending at a line start does not include that line. */
function linesOf(text: string, sel: Selection): LineSpan[] {
  const from = text.lastIndexOf("\n", sel.start - 1) + 1;
  const lastPos = sel.end > sel.start && text[sel.end - 1] === "\n" ? sel.end - 1 : sel.end;
  const toNl = text.indexOf("\n", Math.max(lastPos, from));
  const to = toNl === -1 ? text.length : toNl;
  const lines: LineSpan[] = [];
  let at = from;
  for (const line of text.slice(from, to).split("\n")) {
    lines.push({ start: at, end: at + line.length, text: line });
    at += line.length + 1;
  }
  return lines;
}

/**
 * Replaces each line's prefix and maps the selection through the change.
 * A position inside an old prefix lands just after the new one.
 */
function rewritePrefixes(text: string, sel: Selection, lines: LineSpan[], prefixes: { old: number; next: string }[]): FormatResult {
  let out = "";
  const map = (pos: number) => {
    let shift = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const { old, next } = prefixes[i];
      if (pos <= line.end || i === lines.length - 1) {
        if (pos < line.start) return pos + shift;
        const inLine = pos - line.start;
        return line.start + shift + (inLine <= old ? next.length : inLine - old + next.length);
      }
      shift += next.length - old;
    }
    return pos;
  };
  lines.forEach((line, i) => {
    out += (i ? "\n" : "") + prefixes[i].next + line.text.slice(prefixes[i].old);
  });
  const first = lines[0];
  const last = lines[lines.length - 1];
  return {
    edit: { start: first.start, end: last.end, text: out },
    selection: { start: map(sel.start), end: map(sel.end) },
  };
}

/** The block style of the line the selection starts on. */
export function blockState(text: string, sel: Selection): { style: BlockStyle | "other"; list: ListKind | null } {
  const [line] = linesOf(text, sel);
  const p = linePrefix(line.text);
  const style: BlockStyle | "other" =
    p.heading === 1 ? "h1" : p.heading === 2 ? "h2" : p.heading === 3 ? "h3" : p.heading > 3 ? "other" : p.quote ? "quote" : "paragraph";
  // Every non-empty line in the selection must be a list item of the same kind.
  const kinds = linesOf(text, sel)
    .filter((l) => l.text.trim() !== "")
    .map((l) => linePrefix(l.text).list);
  const list = kinds.length && kinds.every((k) => k === kinds[0]) ? kinds[0] : null;
  return { style, list };
}

const BLOCK_MARK: Record<BlockStyle, string> = { paragraph: "", h1: "# ", h2: "## ", h3: "### ", quote: "> " };

/** Makes the selected lines headings, a quote or plain paragraphs. List markers are removed. */
export function setBlockStyle(text: string, sel: Selection, style: BlockStyle): FormatResult {
  const lines = linesOf(text, sel);
  const prefixes = lines.map((l) => {
    const old = linePrefix(l.text).block.length;
    return { old, next: l.text.trim() === "" && style !== "paragraph" ? "" : BLOCK_MARK[style] };
  });
  return rewritePrefixes(text, sel, lines, prefixes);
}

/** Turns the selected lines into a bulleted or numbered list, or back into paragraphs if they already are one. */
export function toggleList(text: string, sel: Selection, kind: ListKind): FormatResult {
  const lines = linesOf(text, sel);
  const off = blockState(text, sel).list === kind;
  let n = 0;
  const prefixes = lines.map((l) => {
    const old = linePrefix(l.text).block.length;
    if (off || l.text.trim() === "") return { old: off ? old : 0, next: "" };
    n++;
    return { old, next: kind === "bullet" ? "- " : `${n}. ` };
  });
  return rewritePrefixes(text, sel, lines, prefixes);
}

export interface LinkAt {
  start: number;
  end: number;
  label: string;
  url: string;
}

const LINK = /\[([^\]\n]*)\]\(([^)\s]*)\)/g;

/** The Markdown link `[label](url)` containing the selection, if any. */
export function linkAt(text: string, sel: Selection): LinkAt | null {
  const from = text.lastIndexOf("\n", sel.start - 1) + 1;
  const toNl = text.indexOf("\n", sel.end);
  const to = toNl === -1 ? text.length : toNl;
  const line = text.slice(from, to);
  for (const m of line.matchAll(LINK)) {
    const start = from + m.index;
    const end = start + m[0].length;
    if (start <= sel.start && sel.end <= end) return { start, end, label: m[1], url: m[2] };
  }
  return null;
}

/** Inserts `[label](url)`, or updates the link the selection is in. The label is selected afterwards. */
export function insertLink(text: string, sel: Selection, url: string, label?: string): FormatResult {
  const existing = linkAt(text, sel);
  const range = existing ?? sel;
  const chosen = label?.trim() ? label : existing ? existing.label : text.slice(sel.start, sel.end);
  const linkLabel = chosen.replace(/[\[\]\n]/g, " ").trim() || url;
  const safeUrl = url.trim().replace(/\s/g, "%20").replace(/\)/g, "%29");
  const result = `[${linkLabel}](${safeUrl})`;
  return {
    edit: { start: range.start, end: range.end, text: result },
    selection: { start: range.start + 1, end: range.start + 1 + linkLabel.length },
  };
}

export const SCENE_BREAK = "* * *";

/** Inserts a scene break on its own line, separated from the text around it by blank lines. */
export function insertSceneBreak(text: string, sel: Selection): FormatResult {
  const before = text.slice(0, sel.start);
  const after = text.slice(sel.end);
  const lead = before === "" ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const trail = after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  const inserted = lead + SCENE_BREAK + trail;
  const caret = sel.start + inserted.length + (trail === "" ? 2 : trail === "\n" ? 1 : 0);
  return { edit: { start: sel.start, end: sel.end, text: inserted }, selection: { start: caret, end: caret } };
}

/** Shrinks an edit to the part that actually changes, so undo and the spell checker touch as little as possible. */
export function minimalEdit(text: string, edit: TextEdit): TextEdit {
  const old = text.slice(edit.start, edit.end);
  let p = 0;
  while (p < old.length && p < edit.text.length && old[p] === edit.text[p]) p++;
  let s = 0;
  while (s < old.length - p && s < edit.text.length - p && old[old.length - 1 - s] === edit.text[edit.text.length - 1 - s]) s++;
  return { start: edit.start + p, end: edit.end - s, text: edit.text.slice(p, edit.text.length - s) };
}
