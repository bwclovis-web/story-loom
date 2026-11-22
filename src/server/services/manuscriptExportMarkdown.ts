import "server-only";
import { AlignmentType, HeadingLevel, PageBreak, Paragraph, TextRun, type FileChild } from "docx";
import { inlineText, parseMarkdown, type Block } from "@/writing/markdownParse";
import { plainText } from "@/server/pdf/pdfRender";

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

function blockToParagraphs(block: Block, style?: DocxBodyStyle): Paragraph[] {
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
    case "paragraph":
      return [
        new Paragraph({
          ...paraSpacing(style, true),
          children: [new TextRun({ text: inlineText(block.children), ...runOpts(style) })],
        }),
      ];
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
        return blockToParagraphs(child, style);
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

export function bodyToDocxChildren(body: string, style?: DocxBodyStyle): FileChild[] {
  const parsed = parseMarkdown(body);
  return parsed.blocks.flatMap((block) => blockToParagraphs(block, style));
}

export function bodyToEpubSectionHtml(body: string): string {
  const parsed = parseMarkdown(body);
  const parts: string[] = [];
  for (const block of parsed.blocks) {
    parts.push(blockToEpubHtml(block));
  }
  return parts.join("\n");
}

function inlineToHtml(nodes: Parameters<typeof inlineText>[0]): string {
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
        chunks.push(`<strong>${inlineToHtml(node.children)}</strong>`);
        break;
      case "em":
        chunks.push(`<em>${inlineToHtml(node.children)}</em>`);
        break;
      case "del":
        chunks.push(`<del>${inlineToHtml(node.children)}</del>`);
        break;
      case "link":
        chunks.push(inlineToHtml(node.children));
        break;
      case "image":
        chunks.push(escapeHtml(`[image: ${node.name}]`));
        break;
      default:
        break;
    }
  }
  return chunks.join("");
}

function blockToEpubHtml(block: Block): string {
  switch (block.kind) {
    case "heading": {
      const level = Math.min(6, Math.max(1, block.level));
      return `<h${level}>${escapeHtml(block.text || inlineText(block.children))}</h${level}>`;
    }
    case "paragraph":
      return `<p>${inlineToHtml(block.children)}</p>`;
    case "list": {
      const tag = block.ordered ? "ol" : "ul";
      const items = block.items
        .map((item) => `<li>${item.map((b) => blockToEpubHtml(b)).join("")}</li>`)
        .join("");
      return `<${tag}>${items}</${tag}>`;
    }
    case "quote":
      return `<blockquote>${block.children.map(blockToEpubHtml).join("")}</blockquote>`;
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