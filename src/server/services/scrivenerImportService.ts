import "server-only";
import JSZip from "jszip";
import { errorIssue, type Issue } from "@/domain/issues";
import type { ChapterFile } from "./chapterImportService";
import type { MarkdownFile } from "./markdownImportService";

/*
 * Read-only Scrivener package parser. Draft binder items become chapter text
 * (nested docs become ## headings + *** scene breaks inside the parent chapter).
 * Research / Notes folders become Markdown reference files. Unsupported binder
 * items are listed in the import report and never silently dropped without notice.
 */

export interface ScrivenerUnsupportedItem {
  title: string;
  reason: string;
  path: string;
}

export interface ScrivenerParseResult {
  chapters: ChapterFile[];
  references: MarkdownFile[];
  unsupported: ScrivenerUnsupportedItem[];
  projectTitle: string | null;
  issues: Issue[];
}

interface BinderNode {
  id: string;
  title: string;
  type: string;
  children: BinderNode[];
}

const DRAFT_TITLES = /^(draft|manuscript|novel|book)$/i;
const RESEARCH_TITLES = /^(research|notes|notes\s*&\s*research|reference)$/i;
const UNSUPPORTED_TYPES = new Set(["PDF", "Snapshot", "Image", "Movie", "Sound", "WebArchive", "Sketch"]);

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`, "i"));
  return m ? decodeXml(m[1]) : null;
}

function parseBinderItems(fragment: string): BinderNode[] {
  const nodes: BinderNode[] = [];
  let depth = 0;
  let topStart = -1;
  let topAttrs = "";
  const tokenRe = /<BinderItem\b([^>]*)>|<\/BinderItem>/gi;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(fragment))) {
    if (m[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0 && topStart >= 0) {
        const inner = fragment.slice(topStart, m.index);
        const id = attr(topAttrs, "UUID") ?? attr(topAttrs, "ID") ?? `item-${nodes.length}`;
        const type = attr(topAttrs, "Type") ?? "Text";
        const titleMatch = inner.match(/<Title>([\s\S]*?)<\/Title>/i);
        const title = titleMatch ? decodeXml(titleMatch[1]).trim() : "Untitled";
        // Nested BinderItems (usually under <Children>) become this node's children.
        nodes.push({ id, title, type, children: parseBinderItems(inner) });
        topStart = -1;
      }
      continue;
    }
    if (depth === 0) {
      topAttrs = m[1];
      topStart = m.index + m[0].length;
    }
    depth += 1;
  }
  return nodes;
}

function parseBinderXml(xml: string): { title: string | null; roots: BinderNode[] } {
  const projectTitle =
    xml.match(/<ProjectTitle>([\s\S]*?)<\/ProjectTitle>/i)?.[1]?.trim() ??
    attr(xml.match(/<ScrivenerProject\b[^>]*>/i)?.[0] ?? "", "Title");
  const binder = xml.match(/<Binder\b[^>]*>([\s\S]*?)<\/Binder>/i)?.[1] ?? xml;
  return { title: projectTitle ? decodeXml(projectTitle) : null, roots: parseBinderItems(binder) };
}

function rtfToPlain(rtf: string): string {
  // Minimal RTF stripper for Scrivener scene text (not a full RTF engine).
  let text = rtf.replace(/\r\n?/g, "\n");
  text = text.replace(/\{\\fonttbl[\s\S]*?\}/g, "");
  text = text.replace(/\{\\colortbl[\s\S]*?\}/g, "");
  text = text.replace(/\{\\stylesheet[\s\S]*?\}/g, "");
  text = text.replace(/\\'[0-9a-fA-F]{2}/g, (m) => String.fromCharCode(parseInt(m.slice(2), 16)));
  text = text.replace(/\\u(-?\d+)\??/g, (_, n) => {
    const code = Number(n);
    return String.fromCharCode(code < 0 ? code + 65536 : code);
  });
  text = text.replace(/\\par\b/g, "\n");
  text = text.replace(/\\line\b/g, "\n");
  text = text.replace(/\\tab\b/g, "\t");
  text = text.replace(/\\[a-zA-Z]+\-?\d* ?/g, "");
  text = text.replace(/[{}]/g, "");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim() + (text.trim() ? "\n" : "");
}

async function loadDocText(zip: JSZip, id: string): Promise<{ text: string; kind: string } | null> {
  const candidates = [
    `Files/Docs/${id}.txt`,
    `Files/Docs/${id}.rtf`,
    `Docs/${id}.txt`,
    `Docs/${id}.rtf`,
  ];
  // Scrivener often nests the package folder as Project.scriv/...
  const allPaths = Object.keys(zip.files);
  for (const cand of candidates) {
    const hit = allPaths.find((p) => p.replace(/\\/g, "/").endsWith(cand));
    if (!hit) continue;
    const raw = await zip.file(hit)!.async("string");
    if (hit.toLowerCase().endsWith(".rtf")) return { text: rtfToPlain(raw), kind: "rtf" };
    return { text: raw.replace(/\r\n?/g, "\n"), kind: "txt" };
  }
  return null;
}

function findScrivxPath(paths: string[]): string | null {
  const exact = paths.find((p) => /\.scrivx$/i.test(p) && !p.includes("__MACOSX"));
  return exact ?? null;
}

function collectUnsupported(node: BinderNode, path: string, into: ScrivenerUnsupportedItem[]) {
  if (UNSUPPORTED_TYPES.has(node.type) || /\.pdf$/i.test(node.title)) {
    into.push({
      title: node.title,
      reason: node.type === "PDF" || /\.pdf$/i.test(node.title) ? "PDF not imported" : `${node.type} items are not imported`,
      path: path ? `${path} / ${node.title}` : node.title,
    });
  }
  for (const child of node.children) collectUnsupported(child, path ? `${path} / ${node.title}` : node.title, into);
}

async function chapterFromNode(
  zip: JSZip,
  node: BinderNode,
  filename: string,
): Promise<ChapterFile> {
  const parts: string[] = [`# ${node.title}`, ""];
  const own = await loadDocText(zip, node.id);
  if (own?.text.trim()) parts.push(own.text.trim(), "");

  const walk = async (children: BinderNode[], depth: number) => {
    for (const child of children) {
      if (UNSUPPORTED_TYPES.has(child.type)) continue;
      const doc = await loadDocText(zip, child.id);
      if (depth === 0) {
        parts.push("***", "", `## ${child.title}`, "");
      } else {
        parts.push(`### ${child.title}`, "");
      }
      if (doc?.text.trim()) parts.push(doc.text.trim(), "");
      if (child.children.length) await walk(child.children, depth + 1);
    }
  };
  await walk(node.children, 0);

  return {
    filename,
    content: parts.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n",
  };
}

async function referenceFromNode(zip: JSZip, node: BinderNode, filename: string): Promise<MarkdownFile | null> {
  const doc = await loadDocText(zip, node.id);
  const childParts: string[] = [];
  for (const child of node.children) {
    if (UNSUPPORTED_TYPES.has(child.type)) continue;
    const childDoc = await loadDocText(zip, child.id);
    childParts.push(`## ${child.title}`, "");
    if (childDoc?.text.trim()) childParts.push(childDoc.text.trim(), "");
  }
  const body = [doc?.text.trim() ?? "", ...childParts].filter(Boolean).join("\n\n").trim();
  if (!body && node.children.length === 0) return null;
  return {
    filename,
    content: `# ${node.title}\n\n${body}\n`,
  };
}

/**
 * Parse a Scrivener project zip (or a zip that contains a .scriv package) into
 * chapter files, reference files, and an unsupported-item report. No DB writes.
 */
export async function parseScrivenerPackage(bytes: ArrayBuffer | Uint8Array | Buffer): Promise<ScrivenerParseResult> {
  const zip = await JSZip.loadAsync(bytes);
  const paths = Object.keys(zip.files).map((p) => p.replace(/\\/g, "/"));
  const scrivxPath = findScrivxPath(paths);
  if (!scrivxPath) {
    return {
      chapters: [],
      references: [],
      unsupported: [],
      projectTitle: null,
      issues: [errorIssue("IMPORT_INVALID", "No Binder.scrivx (or project.scrivx) was found in that archive.")],
    };
  }

  const xml = await zip.file(scrivxPath)!.async("string");
  const { title, roots } = parseBinderXml(xml);
  const unsupported: ScrivenerUnsupportedItem[] = [];
  for (const root of roots) collectUnsupported(root, "", unsupported);

  const draftRoot =
    roots.find((r) => DRAFT_TITLES.test(r.title) || r.type === "DraftFolder") ??
    roots.find((r) => r.children.some((c) => c.type === "Text" || c.type === "Folder"));
  const researchRoots = roots.filter((r) => RESEARCH_TITLES.test(r.title) || r.type === "ResearchFolder");

  const chapters: ChapterFile[] = [];
  if (draftRoot) {
    let n = 0;
    for (const child of draftRoot.children) {
      if (UNSUPPORTED_TYPES.has(child.type)) continue;
      if (child.type === "Folder" || child.type === "Text" || child.children.length || child.type === "") {
        n += 1;
        chapters.push(await chapterFromNode(zip, child, `${String(n).padStart(2, "0")}-${sanitize(child.title)}.scriv.md`));
      }
    }
  }

  const references: MarkdownFile[] = [];
  let refN = 0;
  const researchNodes = researchRoots.length
    ? researchRoots.flatMap((r) => r.children)
    : roots.filter((r) => !draftRoot || r.id !== draftRoot.id).flatMap((r) => (RESEARCH_TITLES.test(r.title) ? r.children : []));

  for (const node of researchNodes) {
    if (UNSUPPORTED_TYPES.has(node.type)) continue;
    refN += 1;
    const file = await referenceFromNode(zip, node, `${String(refN).padStart(2, "0")}-${sanitize(node.title)}.md`);
    if (file) references.push(file);
  }

  // Snapshots folder names often appear under Files — flag if present.
  if (paths.some((p) => /\/Snapshots\//i.test(p) || /Snapshots\.scrivx$/i.test(p))) {
    if (!unsupported.some((u) => /snapshot/i.test(u.reason))) {
      unsupported.push({
        title: "Snapshots",
        reason: "Scrivener snapshots are not imported",
        path: "Files/Docs/Snapshots",
      });
    }
  }
  if (paths.some((p) => /\.pdf$/i.test(p))) {
    const pdfs = paths.filter((p) => /\.pdf$/i.test(p) && !p.includes("__MACOSX"));
    for (const p of pdfs.slice(0, 20)) {
      unsupported.push({ title: p.split("/").pop() ?? p, reason: "PDF not imported", path: p });
    }
  }

  return {
    chapters,
    references,
    unsupported,
    projectTitle: title,
    issues: chapters.length === 0 && references.length === 0
      ? [errorIssue("IMPORT_INVALID", "The Scrivener binder had no Draft or Research text documents to import.")]
      : [],
  };
}

function sanitize(title: string): string {
  return title.trim().replace(/[^\w\s-]+/g, "").replace(/\s+/g, "_").slice(0, 80) || "Item";
}
