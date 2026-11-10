import { FENCE, HEADING, inlineText, parseInline, parseMarkdown } from "./markdownParse";

/*
 * A document's sections, by heading. A section runs from its heading line to
 * the next heading of the same or a higher level, so it includes its
 * subsections. Offsets are into the stored text exactly as saved (line endings
 * included), so `body.slice(start, end)` is the section's own Markdown.
 * Section ids are the heading anchors the rendered page uses.
 *
 * Status tags are read from headings only and kept word for word. They are
 * the author's own markings; nothing here turns them into a record status.
 */

export interface DocSection {
  /** The heading's anchor on the rendered page. */
  id: string;
  level: number;
  /** Heading text as shown, including any status tag. */
  title: string;
  statusTag: string | null;
  /** Offset of the heading line. */
  start: number;
  /** Offset just past the section (the next heading of the same or higher level, or the end). */
  end: number;
  /** id of the enclosing section, if any. */
  parentId: string | null;
}

/** A capitalised word of three or more letters marks a status, not a date or a note. */
const STATUS_WORD = /\b[A-Z]{3,}\b/;

/**
 * The status tag in a heading, word for word: a final `[...]` containing a
 * capitalised word ("[APPROVED FRAMEWORK]", "[APPROVED / OPEN]"), or the text
 * after a dash when it starts with a capitalised word ("— SELECTED",
 * "— APPROVED FRAMEWORK; implementation gaps OPEN"). Null otherwise.
 */
export function statusTagOf(headingText: string): string | null {
  return splitStatusTag(headingText).tag;
}

/** The heading without its status tag, and the tag word for word (null when there is none). */
export function splitStatusTag(headingText: string): { title: string; tag: string | null } {
  const text = headingText.trim();
  const bracket = /\s*\[([^[\]]+)\]\s*$/.exec(text);
  if (bracket && STATUS_WORD.test(bracket[1])) return { title: text.slice(0, bracket.index), tag: bracket[1].trim() };
  const dash = /\s[—–]\s*([^—–]+)$/.exec(text);
  if (dash && /^[A-Z]{3,}\b/.test(dash[1].trim())) return { title: text.slice(0, dash.index), tag: dash[1].trim() };
  return { title: text, tag: null };
}

interface HeadingLine {
  offset: number;
  level: number;
  title: string;
}

function headingLines(body: string): HeadingLine[] {
  const out: HeadingLine[] = [];
  let fence: string | null = null;
  let offset = 0;
  while (offset <= body.length) {
    const newline = body.indexOf("\n", offset);
    const lineEnd = newline === -1 ? body.length : newline;
    const line = body.slice(offset, lineEnd).replace(/\r$/, "");
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1][0];
      else if (fenceMatch[1][0] === fence && !fenceMatch[2].trim()) fence = null;
    } else if (fence === null) {
      const heading = HEADING.exec(line);
      if (heading) out.push({ offset, level: heading[1].length, title: inlineText(parseInline(heading[2] ?? "")) });
    }
    if (newline === -1) break;
    offset = newline + 1;
  }
  return out;
}

export function listSections(body: string): DocSection[] {
  const lines = headingLines(body);
  if (!lines.length) return [];
  const anchors = parseMarkdown(body).headings;
  let next = 0;
  const ids = lines.map((h, index) => {
    for (let j = next; j < anchors.length; j++) {
      if (anchors[j].level === h.level && anchors[j].text === h.title) {
        next = j + 1;
        return anchors[j].id;
      }
    }
    return `doc-section-${index + 1}`;
  });

  const sections: DocSection[] = [];
  const open: DocSection[] = [];
  lines.forEach((h, index) => {
    let end = body.length;
    for (let j = index + 1; j < lines.length; j++) {
      if (lines[j].level <= h.level) {
        end = lines[j].offset;
        break;
      }
    }
    while (open.length && open[open.length - 1].level >= h.level) open.pop();
    const section: DocSection = {
      id: ids[index],
      level: h.level,
      title: h.title,
      statusTag: statusTagOf(h.title),
      start: h.offset,
      end,
      parentId: open.length ? open[open.length - 1].id : null,
    };
    sections.push(section);
    open.push(section);
  });
  return sections;
}

/** True when any heading carries a status tag, so the text marks status section by section. */
export function hasSectionStatus(body: string): boolean {
  return listSections(body).some((s) => s.statusTag !== null);
}

/** Headings from the outermost section down to this one, for labels such as "Part 2 > Harbour". */
export function sectionPath(sections: readonly DocSection[], id: string): DocSection[] {
  const byId = new Map(sections.map((s) => [s.id, s]));
  const path: DocSection[] = [];
  for (let s = byId.get(id); s; s = s.parentId ? byId.get(s.parentId) : undefined) path.unshift(s);
  return path;
}

/** Drops sections that lie inside another chosen section, keeping document order. */
export function outermostSections(sections: readonly DocSection[], chosen: readonly string[]): DocSection[] {
  const picked = sections.filter((s) => chosen.includes(s.id));
  return picked.filter((s) => !picked.some((o) => o !== s && o.start <= s.start && s.end <= o.end));
}
