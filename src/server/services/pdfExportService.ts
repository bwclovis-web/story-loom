import "server-only";
import type { JsonValue } from "@/domain/json";
import { toRecordView, type RecordView } from "@/domain/records";
import { isManuscriptType, RECORD_TYPE_LABELS, RECORD_TYPES } from "@/domain/recordTypes";
import { PDF_IMAGE_TYPES, imageNamesInText } from "@/images/imageFormat";
import {
  COLORS,
  contentLeft,
  contentWidth,
  createPdf,
  drawBlocks,
  drawFooters,
  drawHeading,
  drawImage,
  drawKeyValueTable,
  drawMeta,
  drawRule,
  drawSceneBreak,
  ensureSpace,
  pdfToBuffer,
  type PdfImage,
  type RenderContext,
} from "@/server/pdf/pdfRender";
import { parseMarkdown } from "@/writing/markdownParse";
import type { DbOrTx } from "../db";
import { NotFoundError } from "./errors";
import { imageDataByIds, imagesByRecord } from "./imageService";
import { buildManuscriptExportModel, exportDateStamp, exportSlug } from "./manuscriptExportModel";
import { LIVE_PROJECT } from "./trashFilters";

/*
 * PDFs of saved record versions. Nothing is stored: each request reads the
 * current records and returns the file. Reference PDFs never include
 * manuscript records, and the manuscript PDF never includes references.
 */

export interface PdfFile {
  filename: string;
  bytes: Buffer;
  pageCount: number;
  documentCount: number;
  imagesEmbedded: number;
}

const EMPTY_IMAGES: ReadonlyMap<string, PdfImage> = new Map();

async function projectTitle(db: DbOrTx, projectId: string): Promise<string> {
  const project = await db.project.findFirst({ where: { id: projectId, ...LIVE_PROJECT }, select: { title: true } });
  if (!project) throw new NotFoundError(`Project ${projectId} not found`);
  return project.title;
}

function fieldText(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "string") return value === "" ? "(empty)" : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value) && value.every((v) => typeof v === "string" || typeof v === "number")) return value.join(", ");
  return JSON.stringify(value);
}

function statusText(status: RecordView["authorityStatus"]): string {
  return status === "approved" ? "Canon status: approved" : `Canon status: ${status} (not canon)`;
}

function drawTitlePage(doc: PDFKit.PDFDocument, project: string, subtitle: string, generated: string, contents: { heading: string; items: string[] }[]) {
  const x = contentLeft(doc);
  const width = contentWidth(doc);
  doc.y = doc.page.margins.top + 120;
  doc.font("sansBold").fontSize(24).fillColor(COLORS.text).text(project, x, doc.y, { width, align: "center" });
  doc.y += 8;
  doc.font("sans").fontSize(14).fillColor(COLORS.muted).text(subtitle, x, doc.y, { width, align: "center" });
  doc.y += 6;
  doc.font("sans").fontSize(9.5).text(generated, x, doc.y, { width, align: "center" });
  doc.fillColor(COLORS.text);
  if (!contents.length) return;
  doc.y += 40;
  for (const group of contents) {
    ensureSpace(doc, 40);
    doc.font("sansBold").fontSize(10.5).fillColor(COLORS.text).text(group.heading, x + 40, doc.y, { width: width - 80 });
    doc.y += 2;
    for (const item of group.items) {
      doc.font("body").fontSize(10).text(item, x + 52, doc.y, { width: width - 92 });
    }
    doc.y += 8;
  }
}

/** Loads image details, and bytes for formats a PDF can embed, keyed by record then image name. */
async function loadImages(db: DbOrTx, projectId: string, recordIds: string[]) {
  const byRecord = await imagesByRecord(db, projectId, recordIds);
  const embeddable = [...byRecord.values()].flat().filter((img) => PDF_IMAGE_TYPES.includes(img.mimeType));
  const data = await imageDataByIds(
    db,
    projectId,
    embeddable.map((img) => img.id),
  );
  const result = new Map<string, Map<string, PdfImage>>();
  for (const [recordId, images] of byRecord) {
    result.set(
      recordId,
      new Map(
        images.map((img) => [
          img.name,
          { name: img.name, mimeType: img.mimeType, width: img.width, height: img.height, caption: img.caption, data: data.get(img.id) },
        ]),
      ),
    );
  }
  return result;
}

/**
 * Reference documents, each starting on a new page, in category order and
 * then by title. Manuscript chapters and scenes in `recordIds` are skipped,
 * as are IDs from other projects. Throws when nothing remains.
 */
export async function buildReferencesPdf(db: DbOrTx, projectId: string, recordIds: readonly string[], now = new Date()): Promise<PdfFile> {
  const project = await projectTitle(db, projectId);
  const rows = await db.record.findMany({ where: { projectId, id: { in: [...new Set(recordIds)] }, trashedAt: null } });
  const records = rows
    .map(toRecordView)
    .filter((r) => !isManuscriptType(r.type))
    .sort((a, b) => RECORD_TYPES.indexOf(a.type) - RECORD_TYPES.indexOf(b.type) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  if (!records.length) throw new NotFoundError("No reference documents were selected.");

  const images = await loadImages(
    db,
    projectId,
    records.map((r) => r.id),
  );
  const single = records.length === 1 ? records[0] : null;
  const title = single ? `${single.title} (${project})` : `${project}: references`;
  const doc = createPdf({ title, subject: "Reference documents exported from Story Loom" });
  const generated = `Saved versions as of ${now.toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" })}`;
  const ctx: RenderContext = { images: EMPTY_IMAGES, embedded: 0 };

  if (!single) {
    const contents = RECORD_TYPES.flatMap((type) => {
      const items = records.filter((r) => r.type === type).map((r) => r.title);
      return items.length ? [{ heading: RECORD_TYPE_LABELS[type], items }] : [];
    });
    drawTitlePage(doc, project, `References (${records.length} documents)`, generated, contents);
  }

  records.forEach((record, index) => {
    if (!single || index > 0) doc.addPage();
    const x = contentLeft(doc);
    const width = contentWidth(doc);
    doc.outline.addItem(record.title);
    doc.font("sansBold").fontSize(20).fillColor(COLORS.text).text(record.title, x, doc.y, { width });
    doc.y += 4;
    const facts = [
      RECORD_TYPE_LABELS[record.type],
      statusText(record.authorityStatus),
      `Revision ${record.currentRevision}`,
      record.protected ? "Protected" : "Not protected",
    ];
    drawMeta(doc, facts.join("  ·  "), x, width, 2);
    if (single) drawMeta(doc, `${project}. ${generated}.`, x, width, 2);
    drawRule(doc, x, width);

    ctx.images = images.get(record.id) ?? EMPTY_IMAGES;
    const parsed = parseMarkdown(record.body);
    if (parsed.blocks.length) drawBlocks(doc, parsed.blocks, ctx, x, width);
    else drawMeta(doc, "This document has no text.", x, width, 8);

    const fields = Object.entries(record.fields);
    if (fields.length) {
      drawHeading(doc, "Structured fields", 3, x, width);
      drawKeyValueTable(
        doc,
        fields.map(([key, value]) => [key, fieldText(value)]),
        x,
        width,
      );
    }

    const inText = new Set(imageNamesInText(record.body));
    const others = [...ctx.images.values()].filter((img) => !inText.has(img.name));
    if (others.length) {
      drawHeading(doc, "Images", 3, x, width);
      for (const img of others) drawImage(doc, ctx, img.name, "", x, width);
    }
  });

  drawFooters(doc, title);
  const pageCount = doc.bufferedPageRange().count;
  const bytes = await pdfToBuffer(doc);
  const name = single ? `${exportSlug(project)}-${exportSlug(single.title)}` : `${exportSlug(project)}-references`;
  return { filename: `${name}-${exportDateStamp(now)}.pdf`, bytes, pageCount, documentCount: records.length, imagesEmbedded: ctx.embedded };
}

/**
 * Every chapter in Write-page order, each starting on a new page, followed by
 * its scenes. Scene titles are optional; without them scenes are separated by
 * a centred break. Scenes whose chapter is missing come last.
 */
export async function buildManuscriptPdf(
  db: DbOrTx,
  projectId: string,
  options: { sceneTitles: boolean; draftId?: string | null; hasDrafts?: boolean },
  now = new Date(),
): Promise<PdfFile> {
  const model = await buildManuscriptExportModel(db, projectId, options, now);
  const project = model.projectTitle;

  const doc = createPdf({ title: project, subject: "Manuscript exported from Story Loom" });
  const generated = `Saved versions as of ${now.toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" })}`;
  drawTitlePage(doc, project, "Manuscript", generated, []);
  const ctx: RenderContext = { images: EMPTY_IMAGES, embedded: 0 };

  const drawText = (body: string) => {
    const parsed = parseMarkdown(body);
    if (parsed.blocks.length) drawBlocks(doc, parsed.blocks, ctx, contentLeft(doc), contentWidth(doc));
    return parsed.blocks.length > 0;
  };

  const drawScenes = (scenes: { record: { title: string; body: string } }[], afterText: boolean) => {
    let previousText = afterText;
    for (const scene of scenes) {
      if (options.sceneTitles) drawHeading(doc, scene.record.title, 3, contentLeft(doc), contentWidth(doc));
      else if (previousText && scene.record.body.trim()) drawSceneBreak(doc);
      previousText = drawText(scene.record.body) || previousText;
    }
  };

  const chapterHeading = (title: string) => {
    doc.addPage();
    doc.outline.addItem(title);
    doc.y = doc.page.margins.top + 60;
    doc.font("sansBold").fontSize(18).fillColor(COLORS.text).text(title, contentLeft(doc), doc.y, { width: contentWidth(doc), align: "center" });
    doc.y += 28;
  };

  let chapters = 0;
  for (const chapter of model.chapters) {
    chapters += 1;
    chapterHeading(chapter.record.title);
    drawScenes(chapter.scenes, drawText(chapter.record.body));
  }
  if (model.unplacedScenes.length) {
    chapterHeading("Scenes not in a chapter");
    drawScenes(model.unplacedScenes, false);
  }

  drawFooters(doc, project);
  const pageCount = doc.bufferedPageRange().count;
  const bytes = await pdfToBuffer(doc);
  return {
    filename: `${exportSlug(project)}-manuscript-${exportDateStamp(now)}.pdf`,
    bytes,
    pageCount,
    documentCount: chapters,
    imagesEmbedded: 0,
  };
}
