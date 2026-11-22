import "server-only";
import type { RecordView } from "@/domain/records";
import { isLinkableReferenceType, RECORD_TYPE_LABELS, type RecordType } from "@/domain/recordTypes";
import type { AuthorityStatus } from "@/domain/statuses";
import { PDF_IMAGE_TYPES, type ImageMimeType } from "@/images/imageFormat";
import type { EstablishedFactView } from "@/server/services/establishedFactService";
import { escapeHtml } from "./manuscriptExportMarkdown";
import { exportSlug } from "./manuscriptExportModel";
import { aliasesOf, nameFromTitle, type RecordCrossRefs } from "@/writing/crossRefs";
import { parseMarkdown, type Block, type Inline } from "@/writing/markdownParse";
import { plainText } from "@/server/pdf/pdfRender";
import {
  buildReferenceInfobox,
  type ReferenceInfoboxModel,
} from "@/world/referenceInfobox";
import type { KindTemplateField } from "@/world/kindTemplates";
import { INFOBOX } from "@/ui/labels";

const EMPTY_CROSS_REFS: RecordCrossRefs = {
  defined: [],
  files: [],
  ids: [],
  mentionedBy: [],
  names: [],
  namedIn: [],
  nameForms: [],
};

export function wikiPageBasename(record: Pick<RecordView, "id" | "title">): string {
  return `${exportSlug(record.title)}-${record.id}`;
}

export function wikiPageHref(basename: string): string {
  return `pages/${basename}.html`;
}

export interface WikiImageRef {
  zipPath: string;
  mimeType: ImageMimeType;
}

export interface WikiExportContext {
  projectTitle: string;
  generated: string;
  /** Lower-case lookup term → page basename (without pages/ prefix). */
  linkTerms: Map<string, string>;
  pageById: Map<string, string>;
  imagesByRecord: Map<string, Map<string, WikiImageRef>>;
  spoilerNote: string | null;
}

export interface WikiRecordBundle {
  record: RecordView;
  facts: readonly EstablishedFactView[];
  kindTemplates?: readonly { kind: string; fields: readonly KindTemplateField[] }[];
}

function canonLabel(status: AuthorityStatus): string {
  return status === "approved" ? "Approved (canon)" : `${status} (not canon)`;
}

function registerLinkTerm(terms: Map<string, string>, term: string, basename: string) {
  const key = term.trim().toLocaleLowerCase();
  if (key.length < 2) return;
  if (!terms.has(key)) terms.set(key, basename);
}

export function buildWikiLinkIndex(records: readonly Pick<RecordView, "id" | "title" | "type" | "fields">[]): {
  linkTerms: Map<string, string>;
  pageById: Map<string, string>;
} {
  const linkTerms = new Map<string, string>();
  const pageById = new Map<string, string>();
  for (const record of records) {
    const basename = wikiPageBasename(record);
    pageById.set(record.id, basename);
    registerLinkTerm(linkTerms, record.title, basename);
    const bare = nameFromTitle(record.title);
    if (bare) registerLinkTerm(linkTerms, bare, basename);
    for (const alias of aliasesOf(record.fields)) registerLinkTerm(linkTerms, alias, basename);
  }
  return { linkTerms, pageById };
}

function resolveWikiTarget(term: string, linkTerms: Map<string, string>): string | null {
  const basename = linkTerms.get(term.trim().toLocaleLowerCase());
  return basename ? wikiPageHref(basename) : null;
}

function preprocessWikiLinks(body: string, linkTerms: Map<string, string>): string {
  return body.replace(/\[\[([^\]]+)\]\]/g, (whole, inner: string) => {
    const raw = inner.trim();
    const pipe = raw.indexOf("|");
    const target = (pipe >= 0 ? raw.slice(0, pipe) : raw).trim();
    const label = (pipe >= 0 ? raw.slice(pipe + 1) : raw).trim() || target;
    const href = resolveWikiTarget(target, linkTerms);
    return href ? `[${label}](${href})` : whole;
  });
}

function imageSrc(recordId: string, name: string, ctx: WikiExportContext): WikiImageRef | null {
  return ctx.imagesByRecord.get(recordId)?.get(name) ?? null;
}

function inlineToWikiHtml(nodes: Inline[], recordId: string, ctx: WikiExportContext): string {
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
        chunks.push(`<strong>${inlineToWikiHtml(node.children, recordId, ctx)}</strong>`);
        break;
      case "em":
        chunks.push(`<em>${inlineToWikiHtml(node.children, recordId, ctx)}</em>`);
        break;
      case "del":
        chunks.push(`<del>${inlineToWikiHtml(node.children, recordId, ctx)}</del>`);
        break;
      case "link": {
        const href = node.href;
        const inner = inlineToWikiHtml(node.children, recordId, ctx);
        if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("mailto:")) {
          chunks.push(`<a href="${escapeHtml(href)}" rel="noopener noreferrer">${inner}</a>`);
        } else if (href.startsWith("pages/") || href.endsWith(".html")) {
          chunks.push(`<a class="wiki-link" href="${escapeHtml(href)}">${inner}</a>`);
        } else {
          chunks.push(inner);
        }
        break;
      }
      case "image": {
        const ref = imageSrc(recordId, node.name, ctx);
        if (ref) {
          const alt = escapeHtml(node.alt || node.name);
          chunks.push(`<figure class="wiki-figure"><img src="../${ref.zipPath}" alt="${alt}"/>`);
          if (node.alt) chunks.push(`<figcaption>${alt}</figcaption>`);
          chunks.push("</figure>");
        } else {
          chunks.push(escapeHtml(`[image: ${node.name}]`));
        }
        break;
      }
      default:
        break;
    }
  }
  return chunks.join("");
}

function blockToWikiHtml(block: Block, recordId: string, ctx: WikiExportContext): string {
  switch (block.kind) {
    case "heading": {
      const level = Math.min(6, Math.max(1, block.level));
      return `<h${level}>${escapeHtml(block.text || inlineToWikiHtml(block.children, recordId, ctx))}</h${level}>`;
    }
    case "paragraph":
      return `<p>${inlineToWikiHtml(block.children, recordId, ctx)}</p>`;
    case "list": {
      const tag = block.ordered ? "ol" : "ul";
      const items = block.items
        .map((item) => `<li>${item.map((b) => blockToWikiHtml(b, recordId, ctx)).join("")}</li>`)
        .join("");
      return `<${tag}>${items}</${tag}>`;
    }
    case "quote":
      return `<blockquote>${block.children.map((b) => blockToWikiHtml(b, recordId, ctx)).join("")}</blockquote>`;
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

export function bodyToWikiSectionHtml(body: string, recordId: string, ctx: WikiExportContext): string {
  const prepared = preprocessWikiLinks(body, ctx.linkTerms);
  const parsed = parseMarkdown(prepared);
  return parsed.blocks.map((block) => blockToWikiHtml(block, recordId, ctx)).join("\n");
}

function infoboxRelationshipHref(href: string, pageById: Map<string, string>): string | null {
  const match = /\/records\/([^/?#]+)/.exec(href);
  if (!match) return null;
  const basename = pageById.get(match[1]!);
  return basename ? wikiPageHref(basename) : null;
}

function infoboxToHtml(model: ReferenceInfoboxModel, pageById: Map<string, string>): string {
  const rows = model.rows
    .map((row) => {
      const wikiHref = row.href ? infoboxRelationshipHref(row.href, pageById) : null;
      const value = wikiHref
        ? `<a class="wiki-link" href="${escapeHtml(wikiHref)}">${escapeHtml(row.value)}</a>`
        : escapeHtml(row.value);
      return `<dt>${escapeHtml(row.label)}</dt><dd>${value}</dd>`;
    })
    .join("");
  const facts = model.facts.length
    ? `<h3 class="wiki-infobox-sub">${escapeHtml(INFOBOX.establishedFacts)}</h3><ul class="wiki-facts">${model.facts
        .map((f) => `<li>${escapeHtml(f)}</li>`)
        .join("")}</ul>`
    : "";
  const open =
    model.openQuestions ?
      `<h3 class="wiki-infobox-sub">${escapeHtml(INFOBOX.openQuestions)}</h3><p class="wiki-open">${escapeHtml(model.openQuestions)}</p>`
    : "";
  return `<aside class="wiki-infobox" aria-label="${escapeHtml(INFOBOX.heading)}"><h2 class="wiki-infobox-title">${escapeHtml(INFOBOX.heading)}</h2><dl class="wiki-infobox-grid">${rows}</dl>${facts}${open}</aside>`;
}

export function buildWikiPageHtml(
  bundle: WikiRecordBundle,
  ctx: WikiExportContext,
): string {
  const { record } = bundle;
  const typeLabel = RECORD_TYPE_LABELS[record.type as RecordType] ?? record.type;
  let infoboxHtml = "";
  if (isLinkableReferenceType(record.type as RecordType)) {
    const model = buildReferenceInfobox({
      projectId: "",
      record,
      bookOrderIds: [],
      crossRefs: EMPTY_CROSS_REFS,
      acceptedFacts: bundle.facts.filter((f) => f.status === "accepted"),
      placeRelations: null,
      recordRelations: null,
      placements: [],
      kindTemplates: bundle.kindTemplates,
    });
    if (model) infoboxHtml = infoboxToHtml(model, ctx.pageById);
  }
  const body = bodyToWikiSectionHtml(record.body, record.id, ctx);
  const status = canonLabel(record.authorityStatus);
  const home = "../index.html";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(record.title)} — ${escapeHtml(ctx.projectTitle)}</title>
  <link rel="stylesheet" href="../assets/wiki.css"/>
</head>
<body class="wiki-page">
  <header class="wiki-top">
    <a class="wiki-home" href="${home}">${escapeHtml(ctx.projectTitle)}</a>
    <p class="wiki-meta">${escapeHtml(typeLabel)} · ${escapeHtml(status)} · Saved version ${record.currentRevision}</p>
  </header>
  <main class="wiki-main">
    <h1>${escapeHtml(record.title)}</h1>
    ${infoboxHtml}
    <article class="wiki-body">${body || `<p class="wiki-empty">This document has no text.</p>`}</article>
  </main>
  <footer class="wiki-foot"><p class="wiki-generated">${escapeHtml(ctx.generated)}</p></footer>
</body>
</html>`;
}

export function buildWikiIndexHtml(
  records: readonly Pick<RecordView, "id" | "title" | "type" | "authorityStatus">[],
  ctx: WikiExportContext,
): string {
  const items = records
    .map((record) => {
      const basename = wikiPageBasename(record);
      const typeLabel = RECORD_TYPE_LABELS[record.type as RecordType] ?? record.type;
      const status = record.authorityStatus === "approved" ? "approved" : record.authorityStatus;
      const search = `${record.title} ${typeLabel} ${status}`.toLocaleLowerCase();
      return `<li data-search="${escapeHtml(search)}"><a href="pages/${basename}.html">${escapeHtml(record.title)}</a> <span class="wiki-type">${escapeHtml(typeLabel)}</span> <span class="wiki-status">${escapeHtml(status)}</span></li>`;
    })
    .join("\n");
  const note = ctx.spoilerNote
    ? `<aside class="wiki-ceiling" role="note"><h2>Spoiler ceiling</h2><p>${escapeHtml(ctx.spoilerNote)}</p></aside>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(ctx.projectTitle)} — reference wiki</title>
  <link rel="stylesheet" href="assets/wiki.css"/>
</head>
<body class="wiki-index">
  <header class="wiki-top">
    <h1>${escapeHtml(ctx.projectTitle)}</h1>
    <p class="wiki-meta">Static HTML wiki · ${records.length} document${records.length === 1 ? "" : "s"} · ${escapeHtml(ctx.generated)}</p>
    <label class="wiki-search-label" for="wiki-search">Search</label>
    <input id="wiki-search" class="wiki-search" type="search" placeholder="Filter by title, type, or status" autocomplete="off"/>
  </header>
  ${note}
  <ul id="wiki-list" class="wiki-list">${items}</ul>
  <script src="assets/wiki.js"></script>
</body>
</html>`;
}

export const WIKI_STYLES = `/* Story Loom static reference wiki */
:root {
  --wiki-text: #1a1a1a;
  --wiki-muted: #555;
  --wiki-link: #3d4a1f;
  --wiki-border: #d4cfc4;
  --wiki-infobox: #f6f3eb;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: Georgia, "Times New Roman", serif;
  line-height: 1.55;
  color: var(--wiki-text);
  background: #faf8f4;
}
a { color: var(--wiki-link); }
a.wiki-link { font-weight: 600; }
.wiki-top { padding: 1.25rem 1.5rem 0.5rem; border-bottom: 1px solid var(--wiki-border); }
.wiki-home { font-size: 0.95rem; text-decoration: none; }
.wiki-meta { margin: 0.35rem 0 0; font-size: 0.9rem; color: var(--wiki-muted); }
.wiki-main { max-width: 44rem; margin: 0 auto; padding: 1.25rem 1.5rem 2.5rem; }
.wiki-body { clear: both; }
.wiki-infobox {
  float: right;
  width: min(100%, 18rem);
  margin: 0 0 1rem 1.25rem;
  padding: 0.75rem 1rem;
  background: var(--wiki-infobox);
  border: 1px solid var(--wiki-border);
  font-size: 0.9rem;
}
.wiki-infobox-title { margin: 0 0 0.5rem; font-size: 1rem; }
.wiki-infobox-grid { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 0.75rem; }
.wiki-infobox-grid dt { margin: 0; font-weight: 600; color: var(--wiki-muted); }
.wiki-infobox-grid dd { margin: 0; }
.wiki-infobox-sub { margin: 0.75rem 0 0.35rem; font-size: 0.95rem; }
.wiki-facts { margin: 0; padding-left: 1.2rem; }
.wiki-open { white-space: pre-wrap; margin: 0; }
.wiki-figure { margin: 1rem 0; }
.wiki-figure img { max-width: 100%; height: auto; }
.wiki-foot { padding: 1rem 1.5rem; border-top: 1px solid var(--wiki-border); font-size: 0.85rem; color: var(--wiki-muted); }
.wiki-index .wiki-list { list-style: none; margin: 0; padding: 0 1.5rem 2rem; max-width: 44rem; }
.wiki-index .wiki-list li { padding: 0.45rem 0; border-bottom: 1px solid #ebe6dc; }
.wiki-type, .wiki-status { font-size: 0.85rem; color: var(--wiki-muted); margin-left: 0.35rem; }
.wiki-search { display: block; width: min(100%, 24rem); margin: 0.75rem 0 0; padding: 0.4rem 0.55rem; font-size: 1rem; }
.wiki-search-label { font-size: 0.85rem; color: var(--wiki-muted); }
.wiki-ceiling { margin: 1rem 1.5rem; padding: 0.75rem 1rem; border: 1px solid var(--wiki-border); background: #fff8e8; font-size: 0.9rem; max-width: 44rem; }
.wiki-ceiling h2 { margin: 0 0 0.35rem; font-size: 1rem; }
.wiki-empty { color: var(--wiki-muted); font-style: italic; }
@media (max-width: 640px) {
  .wiki-infobox { float: none; width: 100%; margin: 0 0 1rem; }
}
`;

export const WIKI_SCRIPT = `(() => {
  const input = document.getElementById("wiki-search");
  const list = document.getElementById("wiki-list");
  if (!input || !list) return;
  const items = [...list.querySelectorAll("li")];
  input.addEventListener("input", () => {
    const q = input.value.trim().toLocaleLowerCase();
    for (const li of items) {
      const hay = li.getAttribute("data-search") || "";
      li.hidden = q.length > 0 && !hay.includes(q);
    }
  });
})();
`;

export function wikiImageZipPath(recordId: string, imageName: string, mimeType: ImageMimeType): string {
  const ext = mimeType === "image/png" ? "png" : "jpg";
  return `images/${recordId}-${exportSlug(imageName)}.${ext}`;
}

export function isEmbeddableWikiImage(mimeType: string): mimeType is ImageMimeType {
  return (PDF_IMAGE_TYPES as readonly string[]).includes(mimeType);
}