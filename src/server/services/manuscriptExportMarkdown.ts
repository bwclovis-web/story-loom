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

const SCENE_BREAK = "***";

function blockToParagraphs(block: Block): Paragraph[] {
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
      return [new Paragraph({ heading: level, children: [new TextRun(block.text || inlineText(block.children))] })];
    }
    case "paragraph":
      return [new Paragraph({ children: [new TextRun(inlineText(block.children))] })];
    case "list":
      return block.items.flatMap((item, index) => {
        const text = item.map((b) => (b.kind === "paragraph" ? inlineText(b.children) : blockKindPlain(b))).join(" ");
        const prefix = block.ordered ? `${block.start + index}. ` : "• ";
        return [new Paragraph({ children: [new TextRun(prefix + text)] })];
      });
    case "quote":
      return block.children.flatMap((child) => {
        if (child.kind === "paragraph") {
          return [new Paragraph({ children: [new TextRun({ text: inlineText(child.children), italics: true })] })];
        }
        return blockToParagraphs(child);
      });
    case "code":
      return [new Paragraph({ children: [new TextRun({ text: block.text, font: "Courier New" })] })];
    case "table": {
      const head = block.head.map((cell) => plainText(cell)).join(" | ");
      const rows = block.rows.map((row) => row.map((cell) => plainText(cell)).join(" | ")).join("\n");
      return [new Paragraph({ children: [new TextRun([head, rows].filter(Boolean).join("\n"))] })];
    }
    case "rule":
      return [new Paragraph({ children: [new TextRun("—")], alignment: AlignmentType.CENTER })];
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

export function bodyToDocxChildren(body: string): FileChild[] {
  const parsed = parseMarkdown(body);
  return parsed.blocks.flatMap(blockToParagraphs);
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

export function sceneBreakParagraph(): Paragraph {
  return new Paragraph({ children: [new TextRun(SCENE_BREAK)], alignment: AlignmentType.CENTER });
}

export function sceneBreakHtml(): string {
  return `<p style="text-align:center">${escapeHtml(SCENE_BREAK)}</p>`;
}

export function chapterBreak(): Paragraph {
  return new Paragraph({ children: [new PageBreak()] });
}

export { SCENE_BREAK };