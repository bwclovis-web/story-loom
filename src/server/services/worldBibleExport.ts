import "server-only";
import { Bookmark, Document, HeadingLevel, InternalHyperlink, Packer, Paragraph, TextRun } from "docx";
import JSZip from "jszip";
import type { DbOrTx } from "../db";
import { imageDataByIds, imagesByRecord, type RecordImageView } from "./imageService";
import { bodyToEpubSectionHtml, escapeHtml } from "./manuscriptExportMarkdown";
import { exportDateStamp, exportSlug } from "./manuscriptExportModel";
import {
  buildWorldBibleExportModel,
  pointScopedEligibleImageNames,
  worldBibleDocxBookmarkId,
  type WorldBibleEntry,
  type WorldBibleExportModel,
  type WorldBiblePolicy,
  type WorldBibleSelection,
} from "./worldBibleModel";
import {
  renderWorldBibleEntryMetaLine,
  renderWorldBibleGroupHeading,
  renderWorldBibleIndexMarkdown,
  renderWorldBibleProfileMarkdown,
  worldBibleLegacyBodyNote,
} from "./worldBibleProfileRender";
import {
  bodyToWikiSectionHtml,
  isEmbeddableWikiImage,
  WIKI_SCRIPT,
  WIKI_STYLES,
  wikiImageZipPath,
  wikiPageHrefFromIndex,
  wikiPageHrefFromPage,
  type WikiExportContext,
  type WikiImageRef,
} from "./wikiExportHtml";

export interface WorldBibleFile {
  filename: string;
  bytes: Buffer;
  documentCount: number;
  contentType: string;
}

/** @deprecated Prefer WorldBiblePolicy; kept for older wiki callers. */
export interface WikiSpoilerCeiling {
  approvedOnly?: boolean;
  spoilerBeforeRecordId?: string | null;
}

function selectionFromRecordIds(recordIds: readonly string[]): WorldBibleSelection {
  return { recordIds: [...recordIds] };
}

function normalizeSelection(
  recordIdsOrSelection: readonly string[] | WorldBibleSelection,
): WorldBibleSelection {
  if (Array.isArray(recordIdsOrSelection)) {
    return selectionFromRecordIds(recordIdsOrSelection as readonly string[]);
  }
  return recordIdsOrSelection as WorldBibleSelection;
}

function policyFromCeiling(ceiling: WikiSpoilerCeiling = {}): WorldBiblePolicy {
  if (ceiling.spoilerBeforeRecordId) {
    return {
      mode: "point",
      storyPointRecordId: ceiling.spoilerBeforeRecordId,
      approvedOnly: ceiling.approvedOnly ?? true,
    };
  }
  return {
    mode: "full",
    approvedOnly: ceiling.approvedOnly ?? false,
  };
}

function resolvePolicyAndNow(
  policyOrNow?: WorldBiblePolicy | Date,
  now?: Date,
): { policy: WorldBiblePolicy; now: Date } {
  if (policyOrNow instanceof Date) return { policy: { mode: "full" }, now: policyOrNow };
  return { policy: policyOrNow ?? { mode: "full" }, now: now ?? new Date() };
}

function stripUnresolvedWikiLinks(body: string, linkTerms: Map<string, string>): string {
  return body.replace(/\[\[([^\]]+)\]\]/g, (whole, inner: string) => {
    const raw = String(inner).trim();
    const pipe = raw.indexOf("|");
    const target = (pipe >= 0 ? raw.slice(0, pipe) : raw).trim();
    const label = (pipe >= 0 ? raw.slice(pipe + 1) : raw).trim() || target;
    if (linkTerms.has(target.toLocaleLowerCase())) return whole;
    return label;
  });
}

/** Turn included [[wiki]] targets into Markdown links for EPUB/MD body pipelines. */
function wikiLinksToMarkdown(body: string, linkTerms: Map<string, string>, ext: "xhtml" | "md"): string {
  return body.replace(/\[\[([^\]]+)\]\]/g, (_whole, inner: string) => {
    const raw = String(inner).trim();
    const pipe = raw.indexOf("|");
    const target = (pipe >= 0 ? raw.slice(0, pipe) : raw).trim();
    const label = (pipe >= 0 ? raw.slice(pipe + 1) : raw).trim() || target;
    const page = linkTerms.get(target.toLocaleLowerCase());
    if (!page) return label;
    return `[${label}](${page}.${ext})`;
  });
}

async function loadWikiImages(
  db: DbOrTx,
  model: WorldBibleExportModel,
): Promise<{
  imagesMeta: Map<string, RecordImageView[]>;
  wikiImagesByRecord: Map<string, Map<string, WikiImageRef>>;
  imageBytes: Map<string, Uint8Array>;
}> {
  const homeIds = [...new Set(model.entries.map((e) => e.record.projectId))];
  const imageMaps = await Promise.all(
    homeIds.map((homeId) =>
      imagesByRecord(
        db,
        homeId,
        model.entries.filter((e) => e.record.projectId === homeId).map((e) => e.record.id),
      ),
    ),
  );
  const eligibleByRecord = new Map(
    model.entries.map((entry) => [
      entry.record.id,
      pointScopedEligibleImageNames(entry, model.mode),
    ] as const),
  );

  const imagesMeta = new Map<string, RecordImageView[]>();
  for (const map of imageMaps) {
    for (const [id, value] of map) {
      const eligible = eligibleByRecord.get(id);
      imagesMeta.set(
        id,
        eligible ? value.filter((img) => eligible.has(img.name)) : value,
      );
    }
  }

  const wikiImagesByRecord = new Map<string, Map<string, WikiImageRef>>();
  for (const [recordId, images] of imagesMeta) {
    if (!model.allowedRecordIds.has(recordId)) continue;
    const byName = new Map<string, WikiImageRef>();
    for (const img of images) {
      if (!isEmbeddableWikiImage(img.mimeType)) continue;
      byName.set(img.name, {
        zipPath: wikiImageZipPath(recordId, img.name, img.mimeType),
        mimeType: img.mimeType,
      });
    }
    if (byName.size) wikiImagesByRecord.set(recordId, byName);
  }

  // Resolve bytes by known image ids from meta (already point-filtered).
  const allIds = [...imagesMeta.values()]
    .flat()
    .filter((img) => isEmbeddableWikiImage(img.mimeType) && model.allowedRecordIds.has(img.recordId))
    .map((img) => img.id);
  const imageBytes = new Map<string, Uint8Array>();
  for (const homeId of homeIds) {
    const homeIdsForFetch = allIds.filter((id) =>
      [...imagesMeta.values()].flat().some((img) => img.id === id && img.recordId && model.entries.some((e) => e.record.projectId === homeId && e.record.id === img.recordId)),
    );
    const chunk = await imageDataByIds(db, homeId, homeIdsForFetch);
    for (const [id, data] of chunk) imageBytes.set(id, data);
  }

  return { imagesMeta, wikiImagesByRecord, imageBytes };
}

function wikiProfileInfobox(entry: WorldBibleEntry, pageById: Map<string, string>): string {
  if (!entry.fields.length && !entry.relations.length && !entry.facts.length) return "";
  const rows = [
    ...entry.fields.map((field) => {
      let value = escapeHtml(field.value);
      if (field.hrefRecordId) {
        const page = pageById.get(field.hrefRecordId);
        if (page) value = `<a class="wiki-link" href="${escapeHtml(wikiPageHrefFromPage(page))}">${value}</a>`;
      }
      return `<dt>${escapeHtml(field.label)}</dt><dd>${value}</dd>`;
    }),
    ...entry.relations.map((rel) => {
      const page = pageById.get(rel.targetRecordId);
      const value = page
        ? `<a class="wiki-link" href="${escapeHtml(wikiPageHrefFromPage(page))}">${escapeHtml(rel.targetTitle)}</a>`
        : escapeHtml(rel.targetTitle);
      return `<dt>${escapeHtml(rel.label)}</dt><dd>${value}</dd>`;
    }),
  ].join("");
  const facts = entry.facts.length
    ? `<h3 class="wiki-infobox-sub">Established facts</h3><ul class="wiki-facts">${entry.facts
        .map((f) => `<li>${escapeHtml(f)}</li>`)
        .join("")}</ul>`
    : "";
  return `<aside class="wiki-infobox" aria-label="At a glance"><h2 class="wiki-infobox-title">At a glance</h2><dl class="wiki-infobox-grid">${rows}</dl>${facts}</aside>`;
}

function buildWikiPageFromEntry(entry: WorldBibleEntry, ctx: WikiExportContext, model: WorldBibleExportModel): string {
  const bodySource = stripUnresolvedWikiLinks(
    worldBibleLegacyBodyNote(entry.body, model.mode),
    ctx.linkTerms,
  );
  const character = entry.characterSlice?.trim()
    ? `<h2>Character</h2><pre class="character-slice">${escapeHtml(entry.characterSlice.trim())}</pre>`
    : "";
  const body = bodyToWikiSectionHtml(bodySource, entry.record.id, ctx);
  const scope = ctx.spoilerNote
    ? `<aside class="wiki-ceiling" role="note"><p>${escapeHtml(ctx.spoilerNote)}</p></aside>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(entry.record.title)} — ${escapeHtml(ctx.projectTitle)}</title>
  <link rel="stylesheet" href="../assets/wiki.css"/>
</head>
<body class="wiki-page">
  <header class="wiki-top">
    <a class="wiki-home" href="../index.html">${escapeHtml(ctx.projectTitle)}</a>
    <p class="wiki-meta">${escapeHtml(renderWorldBibleEntryMetaLine(entry))}</p>
  </header>
  ${scope}
  <main class="wiki-main">
    <h1>${escapeHtml(entry.record.title)}</h1>
    ${wikiProfileInfobox(entry, ctx.pageById)}
    ${character}
    <article class="wiki-body">${body || `<p class="wiki-empty">This document has no text.</p>`}</article>
  </main>
  <footer class="wiki-foot"><p class="wiki-generated">${escapeHtml(ctx.generated)}</p></footer>
</body>
</html>`;
}

function buildWikiIndexFromModel(model: WorldBibleExportModel, ctx: WikiExportContext): string {
  const groups = model.groups
    .map((group) => {
      const heading = renderWorldBibleGroupHeading(group);
      const items = [
        ...group.entries.map((entry) => {
          const search = `${entry.record.title} ${entry.categoryLabel}`.toLocaleLowerCase();
          return `<li data-search="${escapeHtml(search)}"><a href="${escapeHtml(wikiPageHrefFromIndex(entry.pageId))}">${escapeHtml(entry.record.title)}</a></li>`;
        }),
        ...group.seeAlso.map((see) => {
          const search = `see ${see.title}`.toLocaleLowerCase();
          return `<li data-search="${escapeHtml(search)}" class="wiki-see">See also: <a href="${escapeHtml(wikiPageHrefFromIndex(see.pageId))}">${escapeHtml(see.title)}</a></li>`;
        }),
      ].join("\n");
      return `<section class="wiki-group"><h2>${escapeHtml(heading)}</h2><ul class="wiki-index">${items}</ul></section>`;
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
<body class="wiki-index-page">
  <header class="wiki-top">
    <h1>${escapeHtml(ctx.projectTitle)}</h1>
    <p class="wiki-meta">Reference wiki · ${model.entries.length} documents</p>
    <label class="wiki-filter">Filter <input type="search" id="wiki-filter" placeholder="Search titles…"/></label>
  </header>
  ${note}
  <main class="wiki-main">${groups}</main>
  <footer class="wiki-foot"><p class="wiki-generated">${escapeHtml(ctx.generated)}</p></footer>
  <script src="assets/wiki.js"></script>
</body>
</html>`;
}

export async function buildReferencesWikiZip(
  db: DbOrTx,
  projectId: string,
  recordIdsOrSelection: readonly string[] | WorldBibleSelection,
  ceilingOrPolicy: WikiSpoilerCeiling | WorldBiblePolicy = {},
  now = new Date(),
): Promise<WorldBibleFile> {
  const selection = normalizeSelection(recordIdsOrSelection);
  const policy =
    ceilingOrPolicy && typeof ceilingOrPolicy === "object" && "mode" in ceilingOrPolicy
      ? (ceilingOrPolicy as WorldBiblePolicy)
      : policyFromCeiling(ceilingOrPolicy as WikiSpoilerCeiling);

  const model = await buildWorldBibleExportModel(db, projectId, selection, policy);
  const { imagesMeta, wikiImagesByRecord, imageBytes } = await loadWikiImages(db, model);
  const generated = `Exported ${now.toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" })}`;
  const ctx: WikiExportContext = {
    projectTitle: model.projectTitle,
    generated,
    linkTerms: model.linkTerms,
    pageById: model.pageById,
    imagesByRecord: wikiImagesByRecord,
    spoilerNote: model.spoilerNote,
  };

  const zip = new JSZip();
  zip.file("assets/wiki.css", WIKI_STYLES);
  zip.file("assets/wiki.js", WIKI_SCRIPT);
  zip.file("index.html", buildWikiIndexFromModel(model, ctx));

  for (const entry of model.entries) {
    zip.file(`pages/${entry.pageId}.html`, buildWikiPageFromEntry(entry, ctx, model));
  }

  for (const [recordId, images] of imagesMeta) {
    if (!model.allowedRecordIds.has(recordId)) continue;
    for (const img of images) {
      if (!isEmbeddableWikiImage(img.mimeType)) continue;
      const bytes = imageBytes.get(img.id);
      if (!bytes) continue;
      const ref = wikiImagesByRecord.get(recordId)?.get(img.name);
      if (!ref) continue;
      zip.file(ref.zipPath, Buffer.from(bytes));
    }
  }

  if (model.spoilerNote) {
    zip.file(
      "SPOILER-CEILING.txt",
      `${model.spoilerNote}\n\nThis static wiki does not run Story Loom continuity rules. Treat it as a read-only snapshot.`,
    );
  }

  const bytes = Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  return {
    filename: `${exportSlug(model.projectTitle)}-wiki-${exportDateStamp(now)}.zip`,
    bytes,
    documentCount: model.entries.length,
    contentType: "application/zip",
  };
}

export async function buildReferencesMarkdownBundle(
  db: DbOrTx,
  projectId: string,
  recordIdsOrSelection: readonly string[] | WorldBibleSelection,
  policyOrNow?: WorldBiblePolicy | Date,
  nowArg?: Date,
): Promise<WorldBibleFile> {
  const selection = normalizeSelection(recordIdsOrSelection);
  const { policy, now } = resolvePolicyAndNow(policyOrNow, nowArg);
  const model = await buildWorldBibleExportModel(db, projectId, selection, policy);
  const zip = new JSZip();
  zip.file("README.md", renderWorldBibleIndexMarkdown(model));
  for (const entry of model.entries) {
    const md = renderWorldBibleProfileMarkdown(entry, model);
    zip.file(`${entry.pageId}.md`, stripUnresolvedWikiLinks(md, model.linkTerms));
  }
  const bytes = Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
  return {
    filename: `${exportSlug(model.projectTitle)}-world-bible-${exportDateStamp(now)}.zip`,
    bytes,
    documentCount: model.entries.length,
    contentType: "application/zip",
  };
}

function docxLinkedOrPlain(
  label: string,
  title: string,
  targetRecordId: string | null | undefined,
  pageById: Map<string, string>,
  recordIdByPageId: Map<string, string>,
): Paragraph {
  const page = targetRecordId ? pageById.get(targetRecordId) : undefined;
  const anchorRecordId = page ? recordIdByPageId.get(page) : undefined;
  if (page && anchorRecordId) {
    return new Paragraph({
      children: [
        new TextRun(`${label}: `),
        new InternalHyperlink({
          anchor: worldBibleDocxBookmarkId(anchorRecordId),
          children: [new TextRun({ text: title, style: "Hyperlink" })],
        }),
      ],
    });
  }
  return new Paragraph({ children: [new TextRun(`${label}: ${title}`)] });
}

export async function buildReferencesDocx(
  db: DbOrTx,
  projectId: string,
  recordIdsOrSelection: readonly string[] | WorldBibleSelection,
  policyOrNow?: WorldBiblePolicy | Date,
  nowArg?: Date,
): Promise<WorldBibleFile> {
  const selection = normalizeSelection(recordIdsOrSelection);
  const { policy, now } = resolvePolicyAndNow(policyOrNow, nowArg);
  const model = await buildWorldBibleExportModel(db, projectId, selection, policy);
  const recordIdByPageId = new Map(model.entries.map((e) => [e.pageId, e.record.id] as const));
  const children: Paragraph[] = [
    new Paragraph({
      text: model.projectTitle,
      heading: HeadingLevel.TITLE,
    }),
  ];
  if (model.spoilerNote) {
    children.push(new Paragraph({ children: [new TextRun({ text: model.spoilerNote, italics: true })] }));
  }

  for (const group of model.groups) {
    children.push(
      new Paragraph({
        text: renderWorldBibleGroupHeading(group),
        heading: HeadingLevel.HEADING_1,
      }),
    );
    for (const entry of group.entries) {
      const bookmarkId = worldBibleDocxBookmarkId(entry.record.id);
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [
            new Bookmark({
              id: bookmarkId,
              children: [new TextRun(entry.record.title)],
            }),
          ],
        }),
      );
      children.push(
        new Paragraph({
          children: [new TextRun({ text: renderWorldBibleEntryMetaLine(entry), italics: true })],
        }),
      );
      for (const field of entry.fields) {
        children.push(
          docxLinkedOrPlain(field.label, field.value, field.hrefRecordId, model.pageById, recordIdByPageId),
        );
      }
      for (const rel of entry.relations) {
        children.push(
          docxLinkedOrPlain(rel.label, rel.targetTitle, rel.targetRecordId, model.pageById, recordIdByPageId),
        );
      }
      for (const fact of entry.facts) {
        children.push(new Paragraph({ children: [new TextRun(`Fact: ${fact}`)] }));
      }
      if (entry.characterSlice?.trim()) {
        children.push(new Paragraph({ children: [new TextRun({ text: "Character", bold: true })] }));
        children.push(new Paragraph({ children: [new TextRun(entry.characterSlice.trim())] }));
      }
      const body = wikiLinksToMarkdown(
        worldBibleLegacyBodyNote(entry.body, model.mode),
        model.linkTerms,
        "md",
      )
        // DOCX notes are plain runs; keep readable labels without Markdown link syntax.
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
        .trim();
      if (body) children.push(new Paragraph({ children: [new TextRun(body)] }));
      children.push(new Paragraph({ children: [new TextRun("")] }));
    }
    for (const see of group.seeAlso) {
      const anchorRecordId = recordIdByPageId.get(see.pageId);
      if (anchorRecordId) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: "See also: ", italics: true }),
              new InternalHyperlink({
                anchor: worldBibleDocxBookmarkId(anchorRecordId),
                children: [
                  new TextRun({
                    text: `${see.title} (${see.pageId})`,
                    italics: true,
                    style: "Hyperlink",
                  }),
                ],
              }),
            ],
          }),
        );
      } else {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: `See also: ${see.title} (${see.pageId})`, italics: true })],
          }),
        );
      }
    }
  }

  const bytes = Buffer.from(
    await Packer.toBuffer(
      new Document({
        title: `${model.projectTitle} world bible`,
        sections: [{ children }],
      }),
    ),
  );
  return {
    filename: `${exportSlug(model.projectTitle)}-world-bible-${exportDateStamp(now)}.docx`,
    bytes,
    documentCount: model.entries.length,
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
}

export async function buildReferencesEpub(
  db: DbOrTx,
  projectId: string,
  recordIdsOrSelection: readonly string[] | WorldBibleSelection,
  policyOrNow?: WorldBiblePolicy | Date,
  nowArg?: Date,
): Promise<WorldBibleFile> {
  const selection = normalizeSelection(recordIdsOrSelection);
  const { policy, now } = resolvePolicyAndNow(policyOrNow, nowArg);
  const model = await buildWorldBibleExportModel(db, projectId, selection, policy);
  const zip = new JSZip();
  const uid = `story-loom-world-${exportSlug(model.projectTitle)}-${now.getTime()}`;
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
  );

  const docs = model.entries.map((entry) => ({
    id: `doc-${entry.pageId}`,
    href: `${entry.pageId}.xhtml`,
    entry,
  }));

  const manifest = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    ...docs.map((doc) => `<item id="${doc.id}" href="${doc.href}" media-type="application/xhtml+xml"/>`),
  ].join("");
  const spine = docs.map((doc) => `<itemref idref="${doc.id}"/>`).join("");

  const navGroups = model.groups
    .map((group) => {
      const heading = escapeHtml(renderWorldBibleGroupHeading(group));
      const items = [
        ...group.entries.map(
          (entry) =>
            `<li><a href="${escapeHtml(entry.pageId)}.xhtml">${escapeHtml(entry.record.title)}</a></li>`,
        ),
        ...group.seeAlso.map(
          (see) =>
            `<li>See also: <a href="${escapeHtml(see.pageId)}.xhtml">${escapeHtml(see.title)}</a></li>`,
        ),
      ].join("");
      return `<li><span>${heading}</span><ol>${items}</ol></li>`;
    })
    .join("");

  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">${escapeHtml(uid)}</dc:identifier>
    <dc:title>${escapeHtml(model.projectTitle)}</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>${manifest}</manifest>
  <spine>${spine}</spine>
</package>`,
  );
  const scopeNote = model.spoilerNote
    ? `<p class="scope-note"><em>${escapeHtml(model.spoilerNote)}</em></p>`
    : "";
  zip.file(
    "OEBPS/nav.xhtml",
    `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body>${scopeNote}<nav epub:type="toc"><ol>${navGroups}</ol></nav></body>
</html>`,
  );

  for (const doc of docs) {
    const entry = doc.entry;
    const fields = entry.fields
      .map((field) => {
        const page = field.hrefRecordId ? model.pageById.get(field.hrefRecordId) : undefined;
        const value = page
          ? `<a href="${escapeHtml(page)}.xhtml">${escapeHtml(field.value)}</a>`
          : escapeHtml(field.value);
        return `<li><strong>${escapeHtml(field.label)}:</strong> ${value}</li>`;
      })
      .join("");
    const body = bodyToEpubSectionHtml(
      wikiLinksToMarkdown(worldBibleLegacyBodyNote(entry.body, model.mode), model.linkTerms, "xhtml"),
    );
    const relations = entry.relations
      .map((rel) => {
        const page = model.pageById.get(rel.targetRecordId);
        const target = page
          ? `<a href="${escapeHtml(page)}.xhtml">${escapeHtml(rel.targetTitle)}</a>`
          : escapeHtml(rel.targetTitle);
        return `<li><strong>${escapeHtml(rel.label)}:</strong> ${target}</li>`;
      })
      .join("");
    const facts = entry.facts.map((f) => `<li>${escapeHtml(f)}</li>`).join("");
    zip.file(
      `OEBPS/${doc.href}`,
      `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${escapeHtml(entry.record.title)}</title></head><body>
${scopeNote}
<h1 id="${escapeHtml(worldBibleDocxBookmarkId(entry.record.id))}">${escapeHtml(entry.record.title)}</h1>
<p><em>${escapeHtml(renderWorldBibleEntryMetaLine(entry))}</em></p>
${fields ? `<h2>Profile</h2><ul>${fields}</ul>` : ""}
${relations ? `<h2>Relationships</h2><ul>${relations}</ul>` : ""}
${facts ? `<h2>Established facts</h2><ul>${facts}</ul>` : ""}
${entry.characterSlice?.trim() ? `<h2>Character</h2><pre>${escapeHtml(entry.characterSlice.trim())}</pre>` : ""}
${body}
</body></html>`,
    );
  }

  const bytes = Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  return {
    filename: `${exportSlug(model.projectTitle)}-world-bible-${exportDateStamp(now)}.epub`,
    bytes,
    documentCount: model.entries.length,
    contentType: "application/epub+zip",
  };
}

export { buildWorldBibleExportModel };
export type { WorldBibleExportModel, WorldBiblePolicy, WorldBibleSelection };
