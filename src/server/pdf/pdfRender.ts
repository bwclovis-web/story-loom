import path from "node:path";
import PDFDocument from "pdfkit";
import { IMAGE_FORMAT_LABELS, PDF_IMAGE_TYPES, type ImageMimeType } from "@/images/imageFormat";
import { inlineText, type Block, type Inline } from "@/writing/markdownParse";

/*
 * Draws parsed Markdown into a PDF with PDFKit. Only text and the author's
 * own images are drawn; links to the web become underlined text with a link
 * annotation, and in-app links become plain text. The DejaVu fonts cover far
 * more than Latin text, so names with accents or other scripts print as
 * written.
 */

const FONT_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "node_modules", "dejavu-fonts-ttf", "ttf");

const FONTS = {
  body: "DejaVuSerif.ttf",
  bodyBold: "DejaVuSerif-Bold.ttf",
  bodyItalic: "DejaVuSerif-Italic.ttf",
  bodyBoldItalic: "DejaVuSerif-BoldItalic.ttf",
  sans: "DejaVuSans.ttf",
  sansBold: "DejaVuSans-Bold.ttf",
  sansItalic: "DejaVuSans-Oblique.ttf",
  mono: "DejaVuSansMono.ttf",
} as const;

export type FontName = keyof typeof FONTS;

const fontPath = (file: string) => path.join(/*turbopackIgnore: true*/ FONT_DIR, file);

export const COLORS = { text: "#1f1b16", muted: "#5f574c", rule: "#d8cfbf", link: "#6e5618", sunken: "#f3eee5" } as const;

export const SIZES = { body: 11, small: 9, caption: 9.5, code: 9.5, h: [17, 14.5, 12.5, 11.5, 11, 11] } as const;

export interface PdfImage {
  name: string;
  mimeType: ImageMimeType;
  width: number;
  height: number;
  caption: string;
  /** Present for formats PDF can embed. */
  data?: Uint8Array;
}

export interface RenderContext {
  /** Images attached to the record being drawn, by name. */
  images: ReadonlyMap<string, PdfImage>;
  /** Counts images actually embedded, across the whole document. */
  embedded: number;
}

export function createPdf(info: { title: string; subject: string }): PDFKit.PDFDocument {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 64, bottom: 64, left: 66, right: 66 },
    bufferPages: true,
    autoFirstPage: true,
    font: fontPath(FONTS.body),
    info: { Title: info.title, Subject: info.subject, Creator: "Wordly Editor", Producer: "Wordly Editor (PDFKit)" },
    displayTitle: true,
    lang: "en",
  });
  for (const [name, file] of Object.entries(FONTS)) doc.registerFont(name, fontPath(file));
  doc.font("body").fontSize(SIZES.body).fillColor(COLORS.text);
  return doc;
}

export function pdfToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

export const contentLeft = (doc: PDFKit.PDFDocument) => doc.page.margins.left;
export const contentWidth = (doc: PDFKit.PDFDocument) => doc.page.width - doc.page.margins.left - doc.page.margins.right;
const bottomLimit = (doc: PDFKit.PDFDocument) => doc.page.height - doc.page.margins.bottom;

/** Starts a new page unless at least `needed` points remain. */
export function ensureSpace(doc: PDFKit.PDFDocument, needed: number) {
  if (doc.y + needed > bottomLimit(doc)) doc.addPage();
}

/* ---------------------------------------------------------------- inlines */

interface Run {
  text: string;
  bold: boolean;
  italic: boolean;
  code: boolean;
  strike: boolean;
  link: string | null;
}

type Piece = { kind: "runs"; runs: Run[] } | { kind: "image"; name: string; alt: string };

const isWebLink = (href: string) => /^(https?:|mailto:)/i.test(href.trim());

function collect(nodes: readonly Inline[], style: Omit<Run, "text">, out: Piece[]) {
  const runs = () => {
    const last = out[out.length - 1];
    if (last && last.kind === "runs") return last.runs;
    const piece: Piece = { kind: "runs", runs: [] };
    out.push(piece);
    return piece.runs;
  };
  for (const node of nodes) {
    switch (node.kind) {
      case "text":
        runs().push({ ...style, text: node.text });
        break;
      case "break":
        runs().push({ ...style, text: "\n" });
        break;
      case "code":
        runs().push({ ...style, code: true, text: node.text });
        break;
      case "strong":
        collect(node.children, { ...style, bold: true }, out);
        break;
      case "em":
        collect(node.children, { ...style, italic: true }, out);
        break;
      case "del":
        collect(node.children, { ...style, strike: true }, out);
        break;
      case "link":
        collect(node.children, { ...style, link: isWebLink(node.href) ? node.href : null }, out);
        break;
      case "image":
        out.push({ kind: "image", name: node.name, alt: node.alt });
        break;
    }
  }
}

function fontFor(run: Run, base: "body" | "sans"): FontName {
  if (run.code) return "mono";
  if (base === "sans") return run.bold ? "sansBold" : run.italic ? "sansItalic" : "sans";
  return run.bold && run.italic ? "bodyBoldItalic" : run.bold ? "bodyBold" : run.italic ? "bodyItalic" : "body";
}

interface TextBox {
  x: number;
  width: number;
  size: number;
  base?: "body" | "sans";
  color?: string;
  align?: "left" | "center" | "right" | "justify";
  gapAfter?: number;
}

function drawRuns(doc: PDFKit.PDFDocument, runs: Run[], box: TextBox) {
  const visible = runs.filter((r) => r.text !== "");
  if (!visible.length || visible.every((r) => !r.text.trim())) return;
  const base = box.base ?? "body";
  doc.fontSize(box.size);
  visible.forEach((run, i) => {
    doc.font(fontFor(run, base)).fillColor(run.link ? COLORS.link : (box.color ?? COLORS.text));
    const options: PDFKit.Mixins.TextOptions = {
      continued: i < visible.length - 1,
      link: run.link ?? undefined,
      underline: Boolean(run.link),
      strike: run.strike,
      lineGap: 2.5,
    };
    if (i === 0) doc.text(run.text, box.x, doc.y, { ...options, width: box.width, align: box.align ?? "left" });
    else doc.text(run.text, options);
  });
  doc.fillColor(COLORS.text);
  doc.y += box.gapAfter ?? 6;
}

/** Plain inline text, for table cells and headings in outlines. */
export function plainText(nodes: readonly Inline[]): string {
  return inlineText(nodes);
}

/* ----------------------------------------------------------------- images */

export function drawImage(doc: PDFKit.PDFDocument, ctx: RenderContext, name: string, alt: string, x: number, width: number) {
  const image = ctx.images.get(name);
  if (!image) {
    note(doc, `[Image not found: image:${name}]`, x, width);
    return;
  }
  const label = image.caption || alt;
  if (!image.data || !PDF_IMAGE_TYPES.includes(image.mimeType)) {
    note(doc, `[Image ${image.name}${label ? `: ${label}` : ""}. ${IMAGE_FORMAT_LABELS[image.mimeType]} images are not included in PDFs.]`, x, width);
    return;
  }
  const maxHeight = (doc.page.height - doc.page.margins.top - doc.page.margins.bottom) * 0.6;
  const scale = Math.min(1, width / image.width, maxHeight / image.height, 0.75);
  const w = image.width * scale;
  const h = image.height * scale;
  ensureSpace(doc, h + (image.caption ? 24 : 8));
  try {
    doc.image(Buffer.from(image.data), x, doc.y, { width: w, height: h });
  } catch {
    note(doc, `[Image ${image.name} could not be read.]`, x, width);
    return;
  }
  ctx.embedded += 1;
  doc.y += h + 4;
  if (image.caption) {
    doc.font("sansItalic").fontSize(SIZES.caption).fillColor(COLORS.muted).text(image.caption, x, doc.y, { width });
    doc.fillColor(COLORS.text);
  }
  doc.y += 8;
}

function note(doc: PDFKit.PDFDocument, text: string, x: number, width: number) {
  doc.font("sansItalic").fontSize(SIZES.small).fillColor(COLORS.muted).text(text, x, doc.y, { width });
  doc.fillColor(COLORS.text);
  doc.y += 6;
}

/* ----------------------------------------------------------------- blocks */

function drawInlineBlock(doc: PDFKit.PDFDocument, nodes: readonly Inline[], box: TextBox, ctx: RenderContext) {
  const pieces: Piece[] = [];
  collect(nodes, { bold: false, italic: false, code: false, strike: false, link: null }, pieces);
  for (const piece of pieces) {
    if (piece.kind === "runs") drawRuns(doc, piece.runs, box);
    else drawImage(doc, ctx, piece.name, piece.alt, box.x, box.width);
  }
}

export function drawHeading(doc: PDFKit.PDFDocument, text: string, level: number, x: number, width: number) {
  const size = SIZES.h[Math.min(5, Math.max(0, level - 1))];
  ensureSpace(doc, size * 3.2);
  doc.y += level <= 2 ? 8 : 4;
  doc.font("sansBold").fontSize(size).fillColor(COLORS.text).text(text, x, doc.y, { width, lineGap: 2 });
  doc.y += 4;
}

function drawTable(doc: PDFKit.PDFDocument, block: Extract<Block, { kind: "table" }>, x: number, width: number) {
  const align = (c: number) => block.align[c] ?? "left";
  const data = [
    block.head.map((cell, c) => ({ text: plainText(cell), type: "TH" as const, font: { src: "sansBold" }, align: { x: align(c) } })),
    ...block.rows.map((row) => row.map((cell, c) => ({ text: plainText(cell), font: { src: "sans" }, align: { x: align(c) } }))),
  ];
  ensureSpace(doc, 40);
  doc.fontSize(SIZES.small + 0.5).fillColor(COLORS.text);
  doc.table({
    position: { x, y: doc.y },
    maxWidth: width,
    defaultStyle: { padding: 4, border: 0.5, borderColor: COLORS.rule },
    data,
  });
  doc.x = x;
  doc.y += 8;
}

/** A two-column table of names and plain-text values, such as structured fields. */
export function drawKeyValueTable(doc: PDFKit.PDFDocument, rows: readonly [string, string][], x: number, width: number) {
  if (!rows.length) return;
  ensureSpace(doc, 40);
  doc.fontSize(SIZES.small + 0.5).fillColor(COLORS.text);
  doc.table({
    position: { x, y: doc.y },
    maxWidth: width,
    columnStyles: [width * 0.3, "*"],
    defaultStyle: { padding: 4, border: 0.5, borderColor: COLORS.rule },
    data: rows.map(([key, value]) => [
      { text: key, font: { src: "sansBold" } },
      { text: value || " ", font: { src: "sans" } },
    ]),
  });
  doc.x = x;
  doc.y += 8;
}

/** A line of small grey text. */
export function drawMeta(doc: PDFKit.PDFDocument, text: string, x: number, width: number, gapAfter = 4) {
  doc.font("sans").fontSize(SIZES.small).fillColor(COLORS.muted).text(text, x, doc.y, { width, lineGap: 1.5 });
  doc.fillColor(COLORS.text);
  doc.y += gapAfter;
}

export function drawRule(doc: PDFKit.PDFDocument, x: number, width: number) {
  doc.y += 4;
  doc.save().moveTo(x, doc.y).lineTo(x + width, doc.y).lineWidth(0.6).strokeColor(COLORS.rule).stroke().restore();
  doc.y += 10;
}

export function drawBlocks(doc: PDFKit.PDFDocument, blocks: readonly Block[], ctx: RenderContext, x: number, width: number, tight = false) {
  for (const block of blocks) {
    switch (block.kind) {
      case "heading":
        drawHeading(doc, block.text || " ", block.level + 1, x, width);
        break;
      case "paragraph":
        drawInlineBlock(doc, block.children, { x, width, size: SIZES.body, gapAfter: tight ? 2 : 7 }, ctx);
        break;
      case "list": {
        const indent = 16;
        block.items.forEach((item, i) => {
          ensureSpace(doc, SIZES.body * 2);
          const marker = block.ordered ? `${block.start + i}.` : "•";
          const y = doc.y;
          doc.font("body").fontSize(SIZES.body).fillColor(COLORS.text).text(marker, x, y, { width: indent, lineBreak: false });
          doc.y = y;
          drawBlocks(doc, item, ctx, x + indent, width - indent, block.tight);
        });
        doc.y += tight ? 0 : 4;
        break;
      }
      case "quote": {
        const startPage = doc.bufferedPageRange().start + doc.bufferedPageRange().count - 1;
        const startY = doc.y;
        drawBlocks(doc, block.children, ctx, x + 14, width - 14);
        const endPage = doc.bufferedPageRange().start + doc.bufferedPageRange().count - 1;
        const top = endPage === startPage ? startY : doc.page.margins.top;
        doc.save().moveTo(x + 3, top).lineTo(x + 3, doc.y - 6).lineWidth(2).strokeColor(COLORS.rule).stroke().restore();
        break;
      }
      case "code": {
        doc.font("mono").fontSize(SIZES.code);
        const h = doc.heightOfString(block.text || " ", { width: width - 16 });
        ensureSpace(doc, Math.min(h + 12, 120));
        if (doc.y + h + 12 <= bottomLimit(doc)) doc.save().rect(x, doc.y, width, h + 12).fill(COLORS.sunken).restore();
        doc.fillColor(COLORS.text).text(block.text || " ", x + 8, doc.y + 6, { width: width - 16 });
        doc.y += 12;
        break;
      }
      case "rule":
        ensureSpace(doc, 20);
        doc.y += 2;
        drawRule(doc, x, width);
        break;
      case "table":
        drawTable(doc, block, x, width);
        break;
    }
  }
}

/** A centred scene break. */
export function drawSceneBreak(doc: PDFKit.PDFDocument) {
  ensureSpace(doc, 40);
  doc.y += 6;
  doc.font("body").fontSize(SIZES.body).fillColor(COLORS.muted).text("* * *", contentLeft(doc), doc.y, { width: contentWidth(doc), align: "center" });
  doc.fillColor(COLORS.text);
  doc.y += 12;
}

/** Page numbers and a running title on every page after the first. */
export function drawFooters(doc: PDFKit.PDFDocument, title: string) {
  const range = doc.bufferedPageRange();
  for (let i = range.start + 1; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 40;
    doc.font("sans").fontSize(8.5).fillColor(COLORS.muted);
    doc.text(title, contentLeft(doc), y, { width: contentWidth(doc) * 0.75, lineBreak: false, ellipsis: true });
    doc.text(`${i + 1 - range.start} / ${range.count}`, contentLeft(doc), y, { width: contentWidth(doc), align: "right", lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.fillColor(COLORS.text);
}
