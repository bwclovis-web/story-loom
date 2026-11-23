import "server-only";
import { Document, Packer, Paragraph, TextRun } from "docx";
import JSZip from "jszip";
import { toRecordView } from "@/domain/records";
import { isManuscriptType, isRecordType, RECORD_TYPES } from "@/domain/recordTypes";
import type { DbOrTx } from "../db";
import { listEstablishedFactsForSubject, type EstablishedFactView } from "./establishedFactService";
import { imageDataByIds, imagesByRecord } from "./imageService";
import { listAvailableWorldKindTemplates } from "./worldKindTemplateService";
import { NotFoundError } from "./errors";
import type { RecordImageView } from "./imageService";
import { bodyToEpubSectionHtml, escapeHtml } from "./manuscriptExportMarkdown";
import { exportDateStamp, exportSlug } from "./manuscriptExportModel";
import { LIVE_PROJECT } from "./trashFilters";
import { manuscriptIdsInBookOrder } from "@/ui/manuscriptTree";
import { PDF } from "@/ui/labels";
import {
  buildWikiIndexHtml,
  buildWikiLinkIndex,
  buildWikiPageHtml,
  isEmbeddableWikiImage,
  WIKI_SCRIPT,
  WIKI_STYLES,
  wikiImageZipPath,
  type WikiExportContext,
  type WikiImageRef,
} from "./wikiExportHtml";

export interface WorldBibleFile {
  filename: string;
  bytes: Buffer;
  documentCount: number;
  contentType: string;
}

async function selectedReferences(db: DbOrTx, projectId: string, recordIds: readonly string[]) {
  const project = await db.project.findFirst({ where: { id: projectId, ...LIVE_PROJECT }, select: { title: true } });
  if (!project) throw new NotFoundError(`Project ${projectId} not found`);
  const { resolveAvailableReference } = await import("./seriesBibleService");
  const uniqueIds = [...new Set(recordIds)];
  const resolved = await Promise.all(uniqueIds.map((id) => resolveAvailableReference(db, projectId, id)));
  const records = resolved
    .flatMap((entry) => (entry ? [entry.record] : []))
    .filter((record) => !isManuscriptType(record.type))
    .sort((a, b) => RECORD_TYPES.indexOf(a.type) - RECORD_TYPES.indexOf(b.type) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  if (!records.length) throw new NotFoundError("No reference documents were selected.");
  return { projectTitle: project.title, records };
}

export interface WikiSpoilerCeiling {
  /** Drop non-approved records from the export (among the ids the author selected). */
  approvedOnly?: boolean;
  /** Manuscript chapter or scene id: established facts need evidence at or before this point in book order. */
  spoilerBeforeRecordId?: string | null;
}

function filterFactsBySpoiler(
  facts: readonly EstablishedFactView[],
  bookRank: Map<string, number>,
  ceilingRank: number,
): EstablishedFactView[] {
  return facts.filter((fact) => {
    const manuscriptEvidence = fact.evidence.filter((e) => {
      const label = e.sourceTypeLabel;
      return label === "Manuscript chapter" || label === "Manuscript scene";
    });
    if (!manuscriptEvidence.length) return false;
    return manuscriptEvidence.some((e) => (bookRank.get(e.sourceRecordId) ?? Number.MAX_SAFE_INTEGER) <= ceilingRank);
  });
}

async function bookRankForProject(db: DbOrTx, projectId: string): Promise<Map<string, number>> {
  const rows = await db.record.findMany({
    where: { projectId, trashedAt: null, type: { in: ["manuscript_chapter", "manuscript_scene"] } },
    select: { id: true, title: true, type: true, parentRecordId: true, position: true, createdAt: true, draftId: true },
  });
  const nav = rows.flatMap((row) => {
    if (!isRecordType(row.type)) return [];
    return [
      {
        id: row.id,
        title: row.title,
        type: row.type,
        parentRecordId: row.parentRecordId,
        position: row.position,
        createdAt: row.createdAt.toISOString(),
        draftId: row.draftId,
      },
    ];
  });
  const order = manuscriptIdsInBookOrder(nav);
  return new Map(order.map((id, index) => [id, index]));
}

export async function buildReferencesWikiZip(
  db: DbOrTx,
  projectId: string,
  recordIds: readonly string[],
  ceiling: WikiSpoilerCeiling = {},
  now = new Date(),
): Promise<WorldBibleFile> {
  let { projectTitle, records } = await selectedReferences(db, projectId, recordIds);
  const skipped = ceiling.approvedOnly ? records.filter((r) => r.authorityStatus !== "approved") : [];
  if (ceiling.approvedOnly) records = records.filter((r) => r.authorityStatus === "approved");
  if (!records.length) throw new NotFoundError("No reference documents remain after the spoiler ceiling.");

  const homeIds = [...new Set(records.map((r) => r.projectId))];
  const [kindTemplates, bookRank, ...imageMaps] = await Promise.all([
    listAvailableWorldKindTemplates(db, projectId),
    bookRankForProject(db, projectId),
    ...homeIds.map((homeId) =>
      imagesByRecord(
        db,
        homeId,
        records.filter((r) => r.projectId === homeId).map((r) => r.id),
      ),
    ),
  ]);
  const imagesMeta = new Map<string, RecordImageView[]>();
  for (const map of imageMaps) {
    for (const [id, value] of map) imagesMeta.set(id, value);
  }

  const ceilingRank =
    ceiling.spoilerBeforeRecordId && bookRank.has(ceiling.spoilerBeforeRecordId)
      ? bookRank.get(ceiling.spoilerBeforeRecordId)!
      : null;

  const factsByRecord = new Map<string, EstablishedFactView[]>();
  await Promise.all(
    records.map(async (record) => {
      const all = await listEstablishedFactsForSubject(db, projectId, record.id);
      const filtered =
        ceilingRank === null ? all : filterFactsBySpoiler(all, bookRank, ceilingRank);
      factsByRecord.set(record.id, filtered);
    }),
  );

  const embeddableIds = [...imagesMeta.values()]
    .flat()
    .filter((img) => isEmbeddableWikiImage(img.mimeType))
    .map((img) => img.id);
  const imageBytes = new Map<string, Uint8Array>();
  for (const homeId of homeIds) {
    const homeEmbeds = embeddableIds.filter((id) =>
      [...imagesMeta.values()].flat().some((img) => img.id === id && records.some((r) => r.projectId === homeId && r.id === img.recordId)),
    );
    const chunk = await imageDataByIds(db, homeId, homeEmbeds);
    for (const [id, data] of chunk) imageBytes.set(id, data);
  }

  const wikiImagesByRecord = new Map<string, Map<string, WikiImageRef>>();
  for (const [recordId, images] of imagesMeta) {
    const byName = new Map<string, WikiImageRef>();
    for (const img of images) {
      if (!isEmbeddableWikiImage(img.mimeType)) continue;
      const zipPath = wikiImageZipPath(recordId, img.name, img.mimeType);
      byName.set(img.name, { zipPath, mimeType: img.mimeType });
    }
    if (byName.size) wikiImagesByRecord.set(recordId, byName);
  }

  const { linkTerms, pageById } = buildWikiLinkIndex(records);
  const generated = `Exported ${now.toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" })}`;
  const spoilerParts: string[] = [];
  if (ceiling.approvedOnly) {
    spoilerParts.push(
      skipped.length
        ? `Only approved references are included; ${skipped.length} selected document${skipped.length === 1 ? "" : "s"} with another canon status were omitted.`
        : "Only approved references are included.",
    );
  }
  if (ceilingRank !== null && ceiling.spoilerBeforeRecordId) {
    const anchor = await db.record.findFirst({
      where: { id: ceiling.spoilerBeforeRecordId, projectId },
      select: { title: true },
    });
    spoilerParts.push(
      `Established facts in infoboxes are limited to those with manuscript evidence at or before “${anchor?.title ?? ceiling.spoilerBeforeRecordId}” in book order. Facts without manuscript evidence, body text, relationships, and map pins are not spoiler-filtered.`,
    );
  } else if (ceiling.spoilerBeforeRecordId) {
    spoilerParts.push(PDF.wikiSpoilerLimitUnknownChapter);
  }
  const spoilerNote = spoilerParts.length ? spoilerParts.join(" ") : null;

  const ctx: WikiExportContext = {
    projectTitle,
    generated,
    linkTerms,
    pageById,
    imagesByRecord: wikiImagesByRecord,
    spoilerNote,
  };

  const zip = new JSZip();
  zip.file("assets/wiki.css", WIKI_STYLES);
  zip.file("assets/wiki.js", WIKI_SCRIPT);
  zip.file("index.html", buildWikiIndexHtml(records, ctx));

  for (const record of records) {
    const html = buildWikiPageHtml(
      { record, facts: factsByRecord.get(record.id) ?? [], kindTemplates },
      ctx,
    );
    zip.file(`pages/${pageById.get(record.id)!}.html`, html);
  }

  for (const [recordId, images] of imagesMeta) {
    for (const img of images) {
      if (!isEmbeddableWikiImage(img.mimeType)) continue;
      const bytes = imageBytes.get(img.id);
      if (!bytes) continue;
      const ref = wikiImagesByRecord.get(recordId)?.get(img.name);
      if (!ref) continue;
      zip.file(ref.zipPath, Buffer.from(bytes));
    }
  }

  if (spoilerNote) {
    zip.file(
      "SPOILER-CEILING.txt",
      `${spoilerNote}\n\nThis static wiki does not run Story Loom continuity rules. Treat it as a read-only snapshot.`,
    );
  }

  const bytes = Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  return {
    filename: `${exportSlug(projectTitle)}-wiki-${exportDateStamp(now)}.zip`,
    bytes,
    documentCount: records.length,
    contentType: "application/zip",
  };
}

export async function buildReferencesMarkdownBundle(
  db: DbOrTx,
  projectId: string,
  recordIds: readonly string[],
  now = new Date(),
): Promise<WorldBibleFile> {
  const { projectTitle, records } = await selectedReferences(db, projectId, recordIds);
  const zip = new JSZip();
  const index = records.map((record) => `- [${record.title}](${exportSlug(record.title)}-${record.id}.md)`).join("\n");
  zip.file("README.md", `# ${projectTitle}\n\n${index}\n`);
  for (const record of records) {
    zip.file(`${exportSlug(record.title)}-${record.id}.md`, `# ${record.title}\n\n${record.body}\n`);
  }
  const bytes = Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
  return {
    filename: `${exportSlug(projectTitle)}-world-bible-${exportDateStamp(now)}.zip`,
    bytes,
    documentCount: records.length,
    contentType: "application/zip",
  };
}

export async function buildReferencesDocx(
  db: DbOrTx,
  projectId: string,
  recordIds: readonly string[],
  now = new Date(),
): Promise<WorldBibleFile> {
  const { projectTitle, records } = await selectedReferences(db, projectId, recordIds);
  const children = records.flatMap((record) => [
    new Paragraph({ children: [new TextRun({ text: record.title, bold: true, size: 32 })] }),
    new Paragraph({ children: [new TextRun(record.body || "")] }),
    new Paragraph({ children: [new TextRun("")] }),
  ]);
  const bytes = Buffer.from(await Packer.toBuffer(new Document({ title: `${projectTitle} world bible`, sections: [{ children }] })));
  return {
    filename: `${exportSlug(projectTitle)}-world-bible-${exportDateStamp(now)}.docx`,
    bytes,
    documentCount: records.length,
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
}

export async function buildReferencesEpub(
  db: DbOrTx,
  projectId: string,
  recordIds: readonly string[],
  now = new Date(),
): Promise<WorldBibleFile> {
  const { projectTitle, records } = await selectedReferences(db, projectId, recordIds);
  const zip = new JSZip();
  const uid = `story-loom-world-${exportSlug(projectTitle)}-${now.getTime()}`;
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
  );
  const manifest = records
    .map((record, index) => `<item id="doc-${index + 1}" href="doc-${index + 1}.xhtml" media-type="application/xhtml+xml"/>`)
    .join("");
  const spine = records.map((_, index) => `<itemref idref="doc-${index + 1}"/>`).join("");
  const nav = records
    .map((record, index) => `<li><a href="doc-${index + 1}.xhtml">${escapeHtml(record.title)}</a></li>`)
    .join("");
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">${escapeHtml(uid)}</dc:identifier>
    <dc:title>${escapeHtml(projectTitle)}</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${manifest}
  </manifest>
  <spine>${spine}</spine>
</package>`,
  );
  zip.file(
    "OEBPS/nav.xhtml",
    `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body><nav epub:type="toc"><ol>${nav}</ol></nav></body>
</html>`,
  );
  records.forEach((record, index) => {
    zip.file(
      `OEBPS/doc-${index + 1}.xhtml`,
      `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${escapeHtml(record.title)}</title></head><body>
<h1>${escapeHtml(record.title)}</h1>
${bodyToEpubSectionHtml(record.body)}
</body></html>`,
    );
  });
  const bytes = Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  return {
    filename: `${exportSlug(projectTitle)}-world-bible-${exportDateStamp(now)}.epub`,
    bytes,
    documentCount: records.length,
    contentType: "application/epub+zip",
  };
}
