import "server-only";
import { AlignmentType, HeadingLevel, ImageRun, PageBreak, Paragraph, TextRun, type FileChild } from "docx";
import { IMAGE_FORMAT_LABELS, PDF_IMAGE_TYPES } from "@/images/imageFormat";
import { inlineText, parseMarkdown, type Block, type Inline } from "@/writing/markdownParse";
import { plainText } from "@/server/pdf/pdfRender";
import { docxImageType, scaledImagePx, type ExportInlineImage } from "./manuscriptExportImages";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const DEFAULT_SCENE_BREAK = "***";

export interface DocxBodyStyle {
  font?: string;
  size?: number;
  line?: number;
  indentTwips?: number;
}

function runOpts(style: DocxBodyStyle | undefined, extra?: { italics?: boolean; font?: string; size?: number }) {
  return {
    font: extra?.font ?? style?.font,
    size: extra?.size ?? style?.size,
    italics: extra?.italics,
  };
}

function paraSpacing(style: DocxBodyStyle | undefined, indent = false) {
  return {
    spacing: style?.line ? { line: style.line } : undefined,
    indent: indent && style?.indentTwips ? { firstLine: style.indentTwips } : undefined,
  };
}

export type DocxParagraphNumbering = { next: number };

export interface EpubImageSink {
  /** Returns a manifest href such as `images/map-a1b2.png`. */
  register(image: ExportInlineImage): string;
}

function imageRun(image: ExportInlineImage, alt: string, style?: DocxBodyStyle): ImageRun | TextRun {
  const type = docxImageType(image.mimeType);
  if (!image.data || !type || !PDF_IMAGE_TYPES.includes(image.mimeType)) {
    const label = image.caption || alt || image.name;
    return new TextRun({
      text: `[${label}. ${IMAGE_FORMAT_LABELS[image.mimeType]} images are not included in DOCX.]`,
      ...runOpts(style, { italics: true }),
    });
  }
  const size = scaledImagePx(image.width, image.height);
  return new ImageRun({
    type,
    data: Buffer.from(image.data),
    transformation: size,
    altText: { title: alt || image.name, description: image.caption || alt || image.name },
  });
}

function inlineToDocxChildren(
  nodes: readonly Inline[],
  style?: DocxBodyStyle,
  images?: ReadonlyMap<string, ExportInlineImage>,
): (TextRun | ImageRun)[] {
  const runs: (TextRun | ImageRun)[] = [];
  for (const node of nodes) {
    switch (node.kind) {
      case "text":
        if (node.text) runs.push(new TextRun({ text: node.text, ...runOpts(style) }));
        break;
      case "break":
        runs.push(new TextRun({ text: " ", ...runOpts(style) }));
        break;
      case "code":
        runs.push(new TextRun({ text: node.text, font: "Courier New", size: style?.size }));
        break;
      case "strong":
        runs.push(new TextRun({ text: inlineText(node.children), bold: true, ...runOpts(style) }));
        break;
      case "em":
        runs.push(new TextRun({ text: inlineText(node.children), italics: true, ...runOpts(style) }));
        break;
      case "del":
        runs.push(new TextRun({ text: inlineText(node.children), strike: true, ...runOpts(style) }));
        break;
      case "link":
        runs.push(new TextRun({ text: inlineText(node.children), ...runOpts(style, { italics: true }) }));
        break;
      case "image": {
        const attached = images?.get(node.name);
        if (attached) runs.push(imageRun(attached, node.alt, style));
        else runs.push(new TextRun({ ...runOpts(style, { italics: true }), text: node.alt || `[Image not found: image:${node.name}]` }));
        break;
      }
      default:
        break;
    }
  }
  return runs;
}

function blockToParagraphs(
  block: Block,
  style?: DocxBodyStyle,
  numbering?: DocxParagraphNumbering,
  images?: ReadonlyMap<string, ExportInlineImage>,
): Paragraph[] {
  switch (block.kind) {
    case "heading": {
      const level =
        block.level <= 1
          ? HeadingLevel.HEADING_1
          : block.level === 2
            ? HeadingLevel.HEADING_2
            : block.level === 3
              ? HeadingLevel.HEADING_3
              : HeadingLevel.HEADING_4;
      return [
        new Paragraph({
          heading: level,
          ...paraSpacing(style),
          children: [new TextRun({ text: block.text || inlineText(block.children), ...runOpts(style) })],
        }),
      ];
    }
    case "paragraph": {
      const paragraphRuns: (TextRun | ImageRun)[] = [];
      if (numbering) {
        numbering.next += 1;
        paragraphRuns.push(
          new TextRun({
            text: `${numbering.next}. `,
            size: Math.max(16, (style?.size ?? 24) - 4),
            font: style?.font,
            color: "777777",
          }),
        );
      }
      paragraphRuns.push(...inlineToDocxChildren(block.children, style, images));
      if (!paragraphRuns.length) return [];
      return [
        new Paragraph({
          ...paraSpacing(style, true),
          children: paragraphRuns,
        }),
      ];
    }
    case "list":
      return block.items.flatMap((item, index) => {
        const text = item.map((b) => (b.kind === "paragraph" ? inlineText(b.children) : blockKindPlain(b))).join(" ");
        const prefix = block.ordered ? `${block.start + index}. ` : "• ";
        return [
          new Paragraph({
            ...paraSpacing(style),
            children: [new TextRun({ text: prefix + text, ...runOpts(style) })],
          }),
        ];
      });
    case "quote":
      return block.children.flatMap((child) => {
        if (child.kind === "paragraph") {
          return [
            new Paragraph({
              ...paraSpacing(style),
              children: [new TextRun({ text: inlineText(child.children), ...runOpts(style, { italics: true }) })],
            }),
          ];
        }
        return blockToParagraphs(child, style, numbering, images);
      });
    case "code":
      return [
        new Paragraph({
          ...paraSpacing(style),
          children: [new TextRun({ text: block.text, font: "Courier New", size: style?.size })],
        }),
      ];
    case "table": {
      const head = block.head.map((cell) => plainText(cell)).join(" | ");
      const rows = block.rows.map((row) => row.map((cell) => plainText(cell)).join(" | ")).join("\n");
      return [
        new Paragraph({
          ...paraSpacing(style),
          children: [new TextRun({ text: [head, rows].filter(Boolean).join("\n"), ...runOpts(style) })],
        }),
      ];
    }
    case "rule":
      return [
        new Paragraph({
          ...paraSpacing(style),
          children: [new TextRun({ text: "—", ...runOpts(style) })],
          alignment: AlignmentType.CENTER,
        }),
      ];
    default:
      return [];
  }
}

function blockKindPlain(block: Block): string {
  if (block.kind === "heading") return block.text || inlineText(block.children);
  if (block.kind === "paragraph") return inlineText(block.children);
  if (block.kind === "code") return block.text;
  return "";
}

export function bodyToDocxChildren(
  body: string,
  style?: DocxBodyStyle,
  numbering?: DocxParagraphNumbering,
  images?: ReadonlyMap<string, ExportInlineImage>,
): FileChild[] {
  const parsed = parseMarkdown(body);
  return parsed.blocks.flatMap((block) => blockToParagraphs(block, style, numbering, images));
}

export function bodyToEpubSectionHtml(
  body: string,
  images?: ReadonlyMap<string, ExportInlineImage>,
  sink?: EpubImageSink,
): string {
  const parsed = parseMarkdown(body);
  const parts: string[] = [];
  for (const block of parsed.blocks) {
    parts.push(blockToEpubHtml(block, images, sink));
  }
  return parts.join("\n");
}

function inlineToHtml(
  nodes: Parameters<typeof inlineText>[0],
  images?: ReadonlyMap<string, ExportInlineImage>,
  sink?: EpubImageSink,
): string {
  const chunks: string[] = [];
  for (const node of nodes) {
    switch (node.kind) {
      case "text":
        chunks.push(escapeHtml(node.text));
        break;
      case "break":
        chunks.push("<br/>");
        break;
      case "code":
        chunks.push(`<code>${escapeHtml(node.text)}</code>`);
        break;
      case "strong":
        chunks.push(`<strong>${inlineToHtml(node.children, images, sink)}</strong>`);
        break;
      case "em":
        chunks.push(`<em>${inlineToHtml(node.children, images, sink)}</em>`);
        break;
      case "del":
        chunks.push(`<del>${inlineToHtml(node.children, images, sink)}</del>`);
        break;
      case "link":
        chunks.push(inlineToHtml(node.children, images, sink));
        break;
      case "image": {
        const attached = images?.get(node.name);
        if (attached?.data && sink && PDF_IMAGE_TYPES.includes(attached.mimeType)) {
          const href = sink.register(attached);
          const alt = escapeAttr(node.alt || attached.caption || attached.name);
          chunks.push(`<img src="${href}" alt="${alt}" style="max-width:100%;height:auto;display:block;margin:0.5em auto"/>`);
          if (attached.caption) chunks.push(`<p class="caption">${escapeHtml(attached.caption)}</p>`);
        } else if (attached) {
          chunks.push(escapeHtml(`[${attached.name}${attached.caption ? `: ${attached.caption}` : ""}]`));
        } else {
          chunks.push(escapeHtml(`[Image not found: image:${node.name}]`));
        }
        break;
      }
      default:
        break;
    }
  }
  return chunks.join("");
}

function escapeAttr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function blockToEpubHtml(
  block: Block,
  images?: ReadonlyMap<string, ExportInlineImage>,
  sink?: EpubImageSink,
): string {
  switch (block.kind) {
    case "heading": {
      const level = Math.min(6, Math.max(1, block.level));
      return `<h${level}>${escapeHtml(block.text || inlineText(block.children))}</h${level}>`;
    }
    case "paragraph":
      return `<p>${inlineToHtml(block.children, images, sink)}</p>`;
    case "list": {
      const tag = block.ordered ? "ol" : "ul";
      const items = block.items
        .map((item) => `<li>${item.map((b) => blockToEpubHtml(b, images, sink)).join("")}</li>`)
        .join("");
      return `<${tag}>${items}</${tag}>`;
    }
    case "quote":
      return `<blockquote>${block.children.map((child) => blockToEpubHtml(child, images, sink)).join("")}</blockquote>`;
    case "code":
      return `<pre><code>${escapeHtml(block.text)}</code></pre>`;
    case "table": {
      const head =
        block.head.length > 0
          ? `<tr>${block.head.map((cell) => `<th>${escapeHtml(plainText(cell))}</th>`).join("")}</tr>`
          : "";
      const rows = block.rows
        .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(plainText(cell))}</td>`).join("")}</tr>`)
        .join("");
      return `<table>${head}${rows}</table>`;
    }
    case "rule":
      return "<hr/>";
    default:
      return "";
  }
}

export function sceneBreakParagraph(glyph = DEFAULT_SCENE_BREAK, style?: DocxBodyStyle): Paragraph {
  const text = glyph.trim() || DEFAULT_SCENE_BREAK;
  return new Paragraph({
    ...paraSpacing(style),
    children: [new TextRun({ text, ...runOpts(style) })],
    alignment: AlignmentType.CENTER,
  });
}

export function sceneBreakHtml(glyph = DEFAULT_SCENE_BREAK): string {
  const text = glyph.trim() || DEFAULT_SCENE_BREAK;
  return `<p style="text-align:center">${escapeHtml(text)}</p>`;
}

export function chapterBreak(): Paragraph {
  return new Paragraph({ children: [new PageBreak()] });
}

export { DEFAULT_SCENE_BREAK };