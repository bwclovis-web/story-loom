/*
 * A small Markdown reader for displaying record bodies. It produces a tree
 * that is rendered as React elements, so no HTML from a record ever reaches
 * the page: raw HTML is shown as the text it is, and links are kept only for
 * http, https, mailto and in-app addresses. `![alt](image:name)` shows an
 * image attached to the same record; any other image address is shown as a
 * link and never loaded.
 *
 * Supported: ATX headings (#), paragraphs, bulleted and numbered lists with
 * nesting, block quotes, fenced code, horizontal rules, GitHub-style tables,
 * emphasis (* _ ** __ ~~), code spans, inline, reference and automatic links.
 * Single line breaks are kept as line breaks, because bodies are typed in a
 * plain text box where the author sees them. Setext headings and indented
 * code blocks are not recognised; such text is shown as paragraphs.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; children: Inline[] }
  | { kind: "em"; children: Inline[] }
  | { kind: "del"; children: Inline[] }
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; children: Inline[] }
  | { kind: "image"; name: string; alt: string }
  | { kind: "break" };

export type Align = "left" | "center" | "right" | null;

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; id: string; text: string; children: Inline[] }
  | { kind: "paragraph"; children: Inline[] }
  | { kind: "list"; ordered: boolean; start: number; tight: boolean; items: Block[][] }
  | { kind: "quote"; children: Block[] }
  | { kind: "code"; text: string }
  | { kind: "table"; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  | { kind: "rule" };

export interface MarkdownDocument {
  blocks: Block[];
  headings: { level: number; id: string; text: string }[];
}

export const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
export const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?/;
const LIST_ITEM = /^( {0,3})([-+*]|\d{1,9}[.)])([ \t]+|$)/;
const LINK_DEFINITION = /^ {0,3}\[([^\]]+)\]:[ \t]*<?([^\s>]+)>?(?:[ \t]+(?:"[^"]*"|'[^']*'|\([^)]*\)))?[ \t]*$/;
const TABLE_DELIMITER = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

const isBlank = (line: string) => line.trim() === "";

function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Allowed link targets: web and mail addresses, and addresses inside the app. Anything else becomes plain text. */
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (!href) return null;
  const compact = href.replace(/[\u0000-\u0020\u007f]/g, "");
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(compact);
  if (scheme) return ["http", "https", "mailto"].includes(scheme[1].toLowerCase()) ? href : null;
  if (compact.startsWith("//")) return null;
  return href;
}

/* ---------------------------------------------------------------- tables */

function splitRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  let inCode = 0;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === "\\" && row[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (ch === "`") {
      let run = 1;
      while (row[i + run] === "`") run++;
      inCode = inCode === run ? 0 : inCode === 0 ? run : inCode;
      cell += row.slice(i, i + run);
      i += run - 1;
    } else if (ch === "|" && inCode === 0) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += ch;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function tableAlign(delimiter: string): Align[] {
  return splitRow(delimiter).map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    return left && right ? "center" : right ? "right" : left ? "left" : null;
  });
}

function startsTable(lines: string[], i: number): boolean {
  const header = lines[i];
  const delimiter = lines[i + 1];
  if (delimiter === undefined || !header.includes("|") || !TABLE_DELIMITER.test(delimiter)) return false;
  return splitRow(header).length === splitRow(delimiter).length;
}

/* ----------------------------------------------------------------- blocks */

export interface Context {
  definitions: Map<string, string>;
}

function listMarker(line: string): { indent: number; ordered: boolean; start: number; contentIndent: number; rest: string } | null {
  const m = LIST_ITEM.exec(line);
  if (!m) return null;
  const ordered = /\d/.test(m[2]);
  const spaces = m[3].replace(/\t/g, "    ").length;
  const blankStart = m[3] === "" || m[0].length === line.length;
  // A marker followed by more than four spaces starts the content after one space.
  const gap = blankStart ? 1 : spaces > 4 ? 1 : spaces;
  const contentIndent = m[1].length + m[2].length + gap;
  return {
    indent: m[1].length,
    ordered,
    start: ordered ? Number.parseInt(m[2], 10) : 1,
    contentIndent,
    rest: blankStart ? "" : line.slice(m[1].length + m[2].length + (spaces > 4 ? 1 : m[3].length)),
  };
}

function startsBlock(lines: string[], i: number, inParagraph: boolean): boolean {
  const line = lines[i];
  if (FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line)) return true;
  const marker = listMarker(line);
  if (marker) {
    if (!inParagraph) return true;
    // Inside a paragraph, only a non-empty bullet or a list starting at 1 begins a list.
    return marker.rest.trim() !== "" && (!marker.ordered || marker.start === 1);
  }
  return startsTable(lines, i);
}

function stripIndent(line: string, width: number): string {
  let removed = 0;
  let i = 0;
  while (i < line.length && removed < width) {
    if (line[i] === " ") removed++;
    else if (line[i] === "\t") removed += 4;
    else break;
    i++;
  }
  return line.slice(i);
}

function leadingSpaces(line: string): number {
  let n = 0;
  for (const ch of line) {
    if (ch === " ") n++;
    else if (ch === "\t") n += 4;
    else break;
  }
  return n;
}

function parseBlocks(lines: string[], ctx: Context): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence && !(fence[1][0] === "`" && fence[2].includes("`"))) {
      const marker = fence[1];
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        const close = new RegExp(`^ {0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}[ \\t]*$`);
        if (close.test(lines[i])) {
          i++;
          break;
        }
        body.push(lines[i]);
        i++;
      }
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const children = parseInline(heading[2] ?? "", ctx);
      blocks.push({
        kind: "heading",
        level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        id: "",
        text: inlineText(children),
        children,
      });
      i++;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ kind: "rule" });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length) {
        const current = lines[i];
        if (QUOTE.test(current)) {
          inner.push(current.replace(QUOTE, ""));
        } else if (!isBlank(current) && inner.length > 0 && !isBlank(inner[inner.length - 1]) && !startsBlock(lines, i, true)) {
          inner.push(current);
        } else {
          break;
        }
        i++;
      }
      blocks.push({ kind: "quote", children: parseBlocks(inner, ctx) });
      continue;
    }

    const marker = listMarker(line);
    if (marker) {
      const list = parseList(lines, i, marker, ctx);
      blocks.push(list.block);
      i = list.next;
      continue;
    }

    if (startsTable(lines, i)) {
      const head = splitRow(line);
      const align = tableAlign(lines[i + 1]).slice(0, head.length);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines, i, true)) {
        const cells = splitRow(lines[i]);
        rows.push(head.map((_, c) => parseInline(cells[c] ?? "", ctx)));
        i++;
      }
      blocks.push({ kind: "table", align, head: head.map((cell) => parseInline(cell, ctx)), rows });
      continue;
    }

    const definition = LINK_DEFINITION.exec(line);
    if (definition) {
      i++;
      continue;
    }

    const paragraph: string[] = [line.trimStart()];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines, i, true)) {
      paragraph.push(lines[i].trimStart());
      i++;
    }
    blocks.push({ kind: "paragraph", children: parseInline(paragraph.join("\n"), ctx) });
  }
  return blocks;
}

function parseList(
  lines: string[],
  first: number,
  marker: NonNullable<ReturnType<typeof listMarker>>,
  ctx: Context,
): { block: Block; next: number } {
  const items: string[][] = [];
  let tight = true;
  let i = first;
  let current = marker;
  while (i < lines.length) {
    const item: string[] = [current.rest];
    i++;
    let sawBlank = false;
    while (i < lines.length) {
      const line = lines[i];
      if (isBlank(line)) {
        item.push("");
        sawBlank = true;
        i++;
        continue;
      }
      if (leadingSpaces(line) >= current.contentIndent) {
        item.push(stripIndent(line, current.contentIndent));
        if (sawBlank) tight = false;
        sawBlank = false;
        i++;
        continue;
      }
      const next = listMarker(line);
      if (next) break;
      if (!sawBlank && !startsBlock(lines, i, true)) {
        item.push(line.trimStart());
        i++;
        continue;
      }
      break;
    }
    while (item.length > 1 && isBlank(item[item.length - 1])) item.pop();
    items.push(item);

    if (i >= lines.length) break;
    const next = listMarker(lines[i]);
    if (!next || next.ordered !== marker.ordered || next.indent >= current.contentIndent) break;
    if (sawBlank) tight = false;
    current = next;
  }
  // Trailing blank lines after the last item do not make a list loose.
  return {
    block: {
      kind: "list",
      ordered: marker.ordered,
      start: marker.start,
      tight,
      items: items.map((item) => parseBlocks(item, ctx)),
    },
    next: i,
  };
}

/* ---------------------------------------------------------------- inlines */

const PUNCTUATION = /[!-/:-@[-`{-~]/;
const WORD_CHAR = /[\p{L}\p{N}]/u;

function findClosingBracket(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") {
      i++;
    } else if (ch === "`") {
      let run = 1;
      while (text[i + run] === "`") run++;
      const close = text.indexOf("`".repeat(run), i + run);
      if (close !== -1) i = close + run - 1;
      else i += run - 1;
    } else if (ch === "[") {
      depth++;
    } else if (ch === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** `(destination "title")` right after a link's text; returns the destination and where it ends. */
function parseDestination(text: string, open: number): { href: string; end: number } | null {
  if (text[open] !== "(") return null;
  let i = open + 1;
  while (text[i] === " " || text[i] === "\t" || text[i] === "\n") i++;
  let href = "";
  if (text[i] === "<") {
    const close = text.indexOf(">", i);
    if (close === -1) return null;
    href = text.slice(i + 1, close);
    i = close + 1;
  } else {
    let depth = 0;
    const start = i;
    while (i < text.length) {
      const ch = text[i];
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (/\s/.test(ch)) break;
      if (ch === "(") depth++;
      if (ch === ")") {
        if (depth === 0) break;
        depth--;
      }
      i++;
    }
    href = text.slice(start, i);
  }
  while (text[i] === " " || text[i] === "\t" || text[i] === "\n") i++;
  const quote = text[i];
  if (quote === '"' || quote === "'" || quote === "(") {
    const closer = quote === "(" ? ")" : quote;
    const close = text.indexOf(closer, i + 1);
    if (close === -1) return null;
    i = close + 1;
    while (text[i] === " " || text[i] === "\t" || text[i] === "\n") i++;
  }
  if (text[i] !== ")") return null;
  return { href: href.replace(/\\(.)/g, "$1"), end: i + 1 };
}

function delimiterRun(text: string, i: number): number {
  let n = 1;
  while (text[i + n] === text[i]) n++;
  return n;
}

function canOpen(text: string, i: number, run: number): boolean {
  const after = text[i + run];
  if (after === undefined || /\s/.test(after)) return false;
  if (text[i] === "_") {
    const before = text[i - 1];
    return before === undefined || !WORD_CHAR.test(before);
  }
  return true;
}

function canClose(text: string, i: number, run: number): boolean {
  const before = text[i - 1];
  if (before === undefined || /\s/.test(before)) return false;
  if (text[i] === "_") {
    const after = text[i + run];
    return after === undefined || !WORD_CHAR.test(after);
  }
  return true;
}

/** Where a delimiter of `size` characters closes, or -1. */
function findCloser(text: string, from: number, ch: string, size: number): number {
  let i = from;
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "`") {
      const run = delimiterRun(text, i);
      const close = text.indexOf("`".repeat(run), i + run);
      i = close === -1 ? i + run : close + run;
      continue;
    }
    if (c === ch) {
      const run = delimiterRun(text, i);
      if (canClose(text, i, run) && i > from) {
        if (run === size) return i;
        if (run > size && (size === 2 || run % 2 === 1)) return i + run - size;
      }
      i += run;
      continue;
    }
    i++;
  }
  return -1;
}

function pushText(out: Inline[], text: string) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.kind === "text") last.text += text;
  else out.push({ kind: "text", text });
}

const BARE_URL = /^(?:https?:\/\/|www\.)[^\s<]+/i;

function trimUrl(url: string): string {
  let end = url.length;
  while (end > 0 && /[.,:;!?'"*_~]/.test(url[end - 1])) end--;
  let trimmed = url.slice(0, end);
  while (trimmed.endsWith(")") && (trimmed.match(/\(/g)?.length ?? 0) < (trimmed.match(/\)/g)?.length ?? 0)) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed;
}

export function parseInline(text: string, ctx: Context = { definitions: new Map() }): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  let plainStart = 0;
  const flush = (to: number) => {
    pushText(out, text.slice(plainStart, to));
  };

  while (i < text.length) {
    const ch = text[i];

    if (ch === "\\") {
      if (text[i + 1] === "\n") {
        flush(i);
        out.push({ kind: "break" });
        i += 2;
        plainStart = i;
        continue;
      }
      if (text[i + 1] !== undefined && PUNCTUATION.test(text[i + 1])) {
        flush(i);
        pushText(out, text[i + 1]);
        i += 2;
        plainStart = i;
        continue;
      }
      i++;
      continue;
    }

    if (ch === "\n") {
      let end = i;
      while (end > plainStart && text[end - 1] === " ") end--;
      flush(end);
      out.push({ kind: "break" });
      i++;
      while (text[i] === " ") i++;
      plainStart = i;
      continue;
    }

    if (ch === "`") {
      const run = delimiterRun(text, i);
      const close = findCodeClose(text, i + run, run);
      if (close !== -1) {
        flush(i);
        let code = text.slice(i + run, close).replace(/\n/g, " ");
        if (code.length > 2 && code.startsWith(" ") && code.endsWith(" ") && code.trim()) code = code.slice(1, -1);
        out.push({ kind: "code", text: code });
        i = close + run;
        plainStart = i;
        continue;
      }
      i += run;
      continue;
    }

    if (ch === "!" && text[i + 1] === "[") {
      const close = findClosingBracket(text, i + 1);
      const dest = close === -1 ? null : parseDestination(text, close + 1);
      if (dest) {
        flush(i);
        const alt = text.slice(i + 2, close);
        const attached = /^image:(\S+)$/.exec(dest.href.trim());
        if (attached) {
          out.push({ kind: "image", name: attached[1], alt: inlineText(parseInline(alt, ctx)) });
          i = dest.end;
          plainStart = i;
          continue;
        }
        const href = safeHref(dest.href);
        const children = parseInline(alt || dest.href, ctx);
        if (href) out.push({ kind: "link", href, children: [{ kind: "text", text: "Image: " }, ...children] });
        else out.push(...children);
        i = dest.end;
        plainStart = i;
        continue;
      }
    }

    if (ch === "[") {
      const close = findClosingBracket(text, i);
      if (close !== -1) {
        const label = text.slice(i + 1, close);
        const dest = parseDestination(text, close + 1);
        let href: string | undefined;
        let end = close + 1;
        if (dest) {
          href = dest.href;
          end = dest.end;
        } else {
          const ref = /^\[([^\]]*)\]/.exec(text.slice(close + 1));
          const key = normalizeLabel(ref && ref[1] ? ref[1] : label);
          if (ctx.definitions.has(key)) {
            href = ctx.definitions.get(key);
            end = ref ? close + 1 + ref[0].length : close + 1;
          }
        }
        if (href !== undefined) {
          flush(i);
          const children = parseInline(label, ctx);
          const safe = safeHref(href);
          if (safe) out.push({ kind: "link", href: safe, children });
          else out.push(...children);
          i = end;
          plainStart = i;
          continue;
        }
      }
    }

    if (ch === "<") {
      const auto = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(text.slice(i));
      if (auto) {
        flush(i);
        out.push({ kind: "link", href: auto[1], children: [{ kind: "text", text: auto[1].replace(/^mailto:/i, "") }] });
        i += auto[0].length;
        plainStart = i;
        continue;
      }
    }

    if ((ch === "h" || ch === "H" || ch === "w" || ch === "W") && (i === 0 || !WORD_CHAR.test(text[i - 1]))) {
      const bare = BARE_URL.exec(text.slice(i));
      if (bare) {
        const url = trimUrl(bare[0]);
        if (url.length > 4) {
          flush(i);
          const href = /^www\./i.test(url) ? `https://${url}` : url;
          out.push({ kind: "link", href, children: [{ kind: "text", text: url }] });
          i += url.length;
          plainStart = i;
          continue;
        }
      }
    }

    if (ch === "*" || ch === "_" || (ch === "~" && text[i + 1] === "~")) {
      const run = delimiterRun(text, i);
      if (canOpen(text, i, run)) {
        const size = ch === "~" ? 2 : run >= 2 ? 2 : 1;
        if (ch !== "~" || run === 2) {
          const closer = findCloser(text, i + size, ch, size);
          if (closer !== -1) {
            flush(i);
            const children = parseInline(text.slice(i + size, closer), ctx);
            out.push({ kind: ch === "~" ? "del" : size === 2 ? "strong" : "em", children });
            i = closer + size;
            plainStart = i;
            continue;
          }
          if (size === 2 && ch !== "~") {
            const single = findCloser(text, i + 1, ch, 1);
            if (single !== -1) {
              flush(i);
              const children = parseInline(text.slice(i + 1, single), ctx);
              out.push({ kind: "em", children });
              i = single + 1;
              plainStart = i;
              continue;
            }
          }
        }
      }
      i += run;
      continue;
    }

    i++;
  }
  flush(text.length);
  return out;
}

function findCodeClose(text: string, from: number, run: number): number {
  let i = from;
  while (i < text.length) {
    const close = text.indexOf("`".repeat(run), i);
    if (close === -1) return -1;
    const after = delimiterRun(text, close);
    if (after === run) return close;
    i = close + after;
  }
  return -1;
}

export function inlineText(nodes: readonly Inline[]): string {
  return nodes
    .map((n) =>
      n.kind === "text" || n.kind === "code" ? n.text : n.kind === "break" ? " " : n.kind === "image" ? n.alt : inlineText(n.children),
    )
    .join("");
}

/* ----------------------------------------------------------------- document */

function slug(text: string): string {
  const base = text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `doc-${base || "section"}`;
}

function assignHeadingIds(blocks: Block[], used: Map<string, number>, out: MarkdownDocument["headings"]) {
  for (const block of blocks) {
    if (block.kind === "heading") {
      const base = slug(block.text);
      const n = (used.get(base) ?? 0) + 1;
      used.set(base, n);
      block.id = n === 1 ? base : `${base}-${n}`;
      out.push({ level: block.level, id: block.id, text: block.text });
    } else if (block.kind === "quote") {
      assignHeadingIds(block.children, used, out);
    } else if (block.kind === "list") {
      block.items.forEach((item) => assignHeadingIds(item, used, out));
    }
  }
}

export function parseMarkdown(source: string): MarkdownDocument {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const definitions = new Map<string, string>();
  let inFence: string | null = null;
  for (const line of lines) {
    const fence = FENCE.exec(line);
    if (fence) {
      if (inFence === null) inFence = fence[1][0];
      else if (fence[1][0] === inFence && !fence[2].trim()) inFence = null;
      continue;
    }
    if (inFence) continue;
    const def = LINK_DEFINITION.exec(line);
    if (def && !definitions.has(normalizeLabel(def[1]))) definitions.set(normalizeLabel(def[1]), def[2]);
  }
  const blocks = parseBlocks(lines, { definitions });
  const headings: MarkdownDocument["headings"] = [];
  assignHeadingIds(blocks, new Map(), headings);
  return { blocks, headings };
}
