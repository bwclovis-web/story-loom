import "server-only";
import {
  collectWtText,
  isHeadingStyle,
  loadDocxZip,
  outlineLevel,
  parseCommentsXml,
  paragraphStyleId,
  splitParagraphs,
  type DocxComment,
} from "./docxXml";

export interface DocxBlock {
  kind: "heading" | "paragraph" | "scene_break";
  level?: number;
  text: string;
  /** Stable anchor when present as a Story Loom bookmark. */
  recordAnchor?: string | null;
}

export interface DocxTrackedSpan {
  kind: "ins" | "del";
  text: string;
  author: string | null;
}

export interface DocxParsedComment {
  id: string;
  author: string;
  body: string;
  /** Approximate passage from the commented range in the final text. */
  passageExcerpt: string;
}

export interface ParsedDocx {
  blocks: DocxBlock[];
  /** Final accepted text with markdown-ish headings. */
  markdown: string;
  tracked: DocxTrackedSpan[];
  comments: DocxParsedComment[];
  /** True when the document contains w:ins or w:del. */
  hasTrackedChanges: boolean;
}

const SCENE_BREAK_RE = /^(?:\*\*\*|• • •|\* \* \*|#{3,})$/;
/** Bookmarks written by manuscript DOCX export: sl_record_{recordId with non-alnum → _}. */
const ANCHOR_RE = /^sl_record_(.+)$/i;

export function recordIdFromDocxBookmark(name: string): string | null {
  const m = name.match(ANCHOR_RE);
  if (!m) return null;
  // Exact id is recovered later by matching live record ids after the same sanitize.
  return m[1];
}

export function docxBookmarkNameForRecord(recordId: string): string {
  return `sl_record_${recordId.replace(/[^A-Za-z0-9]/g, "_")}`;
}

function bookmarkName(paragraphXml: string): string | null {
  const m = paragraphXml.match(/<w:bookmarkStart\b[^>]*\bw:name="([^"]+)"/i);
  return m ? m[1] : null;
}

function extractTracked(paragraphXml: string): DocxTrackedSpan[] {
  const out: DocxTrackedSpan[] = [];
  for (const m of paragraphXml.matchAll(/<(w:ins|w:del)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const kind = m[1].toLowerCase() === "w:ins" ? "ins" : "del";
    const author = m[2].match(/\bw:author="([^"]*)"/i)?.[1] ?? null;
    const text = collectWtText(m[3], "all").trim();
    if (text) out.push({ kind, text, author });
  }
  return out;
}

function commentRanges(paragraphXml: string): Array<{ id: string; text: string }> {
  const ranges: Array<{ id: string; text: string }> = [];
  const re = /<w:commentRangeStart\b[^>]*\bw:id="([^"]+)"[^/]*\/>/gi;
  let start: RegExpExecArray | null;
  while ((start = re.exec(paragraphXml))) {
    const id = start[1];
    const endRe = new RegExp(`<w:commentRangeEnd\\b[^>]*\\bw:id="${id}"[^/]*/>`, "i");
    const endMatch = endRe.exec(paragraphXml.slice(start.index));
    const slice = endMatch ? paragraphXml.slice(start.index, start.index + endMatch.index + endMatch[0].length) : paragraphXml.slice(start.index);
    const text = collectWtText(slice, "final").replace(/\s+/g, " ").trim();
    ranges.push({ id, text });
  }
  return ranges;
}

/**
 * Parse a .docx buffer into markdown-ish blocks, tracked-change spans, and comments.
 * Uses Word XML directly so Heading styles and redlines survive.
 */
export async function parseDocx(bytes: ArrayBuffer | Uint8Array | Buffer): Promise<ParsedDocx> {
  const zip = await loadDocxZip(bytes);
  const documentXml = (await zip.file("word/document.xml")!.async("string")) ?? "";
  const commentMap = await parseCommentsXml(zip);
  const blocks: DocxBlock[] = [];
  const tracked: DocxTrackedSpan[] = [];
  const comments: DocxParsedComment[] = [];
  const seenComments = new Set<string>();
  let hasTrackedChanges = /<w:ins\b|<w:del\b/i.test(documentXml);

  for (const p of splitParagraphs(documentXml)) {
    tracked.push(...extractTracked(p));
    for (const range of commentRanges(p)) {
      if (seenComments.has(range.id)) continue;
      seenComments.add(range.id);
      const meta: DocxComment | undefined = commentMap.get(range.id);
      if (!meta) continue;
      comments.push({
        id: range.id,
        author: meta.author,
        body: meta.body || "(empty comment)",
        passageExcerpt: range.text.slice(0, 500),
      });
    }

    const text = collectWtText(p, "final").replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").trim();
    const style = paragraphStyleId(p);
    const level = isHeadingStyle(style, outlineLevel(p));
    const bookmark = bookmarkName(p);
    const recordAnchor = bookmark && ANCHOR_RE.test(bookmark) ? bookmark : null;

    if (!text && !recordAnchor) continue;

    if (text && SCENE_BREAK_RE.test(text)) {
      blocks.push({ kind: "scene_break", text: "***" });
      continue;
    }
    if (level) {
      blocks.push({ kind: "heading", level, text: text || "Untitled", recordAnchor });
      continue;
    }
    if (text) blocks.push({ kind: "paragraph", text, recordAnchor: recordAnchor ?? undefined });
    else if (recordAnchor) blocks.push({ kind: "paragraph", text: "", recordAnchor });
  }

  const markdown = blocksToMarkdown(blocks);
  return { blocks, markdown, tracked, comments, hasTrackedChanges };
}

export function blocksToMarkdown(blocks: readonly DocxBlock[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.kind === "scene_break") {
      lines.push("", "***", "");
      continue;
    }
    if (block.kind === "heading") {
      const hashes = "#".repeat(Math.min(6, Math.max(1, block.level ?? 1)));
      lines.push("", `${hashes} ${block.text}`, "");
      continue;
    }
    lines.push(block.text, "");
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + (blocks.length ? "\n" : "");
}

export interface DocxChapterSlice {
  title: string;
  body: string;
  /** Filename-safe stem used for ChapterFile matching. */
  filenameStem: string;
  recordAnchor: string | null;
}

/**
 * Split a parsed DOCX into chapter bodies.
 * Heading 1 (or Title) starts a chapter; Heading 2 and *** become scene breaks inside the body.
 * A document with no Heading 1 becomes a single chapter titled from the filename.
 */
export function splitDocxIntoChapters(parsed: ParsedDocx, fallbackTitle: string): DocxChapterSlice[] {
  const chapters: DocxChapterSlice[] = [];
  let current: { title: string; parts: string[]; anchor: string | null } | null = null;

  const flush = () => {
    if (!current) return;
    const body = current.parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    const title = current.title.trim() || fallbackTitle;
    chapters.push({
      title,
      body: body ? `${body}\n` : "",
      filenameStem: sanitizeStem(title),
      recordAnchor: current.anchor,
    });
    current = null;
  };

  for (const block of parsed.blocks) {
    if (block.kind === "heading" && (block.level ?? 1) <= 1) {
      flush();
      current = { title: block.text, parts: [], anchor: block.recordAnchor ?? null };
      continue;
    }
    if (!current) {
      current = { title: fallbackTitle, parts: [], anchor: block.recordAnchor ?? null };
    } else if (block.recordAnchor && !current.anchor) {
      current.anchor = block.recordAnchor;
    }
    if (block.kind === "scene_break") {
      current.parts.push("", "***", "");
      continue;
    }
    if (block.kind === "heading") {
      current.parts.push("", `## ${block.text}`, "");
      continue;
    }
    current.parts.push(block.text, "");
  }
  flush();

  if (chapters.length === 0) {
    return [{ title: fallbackTitle, body: parsed.markdown, filenameStem: sanitizeStem(fallbackTitle), recordAnchor: null }];
  }
  return chapters;
}

function sanitizeStem(title: string): string {
  const stem = title
    .trim()
    .replace(/[^\w\s-]+/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 80);
  return stem || "Chapter";
}
