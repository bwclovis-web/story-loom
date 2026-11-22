import "server-only";
import JSZip from "jszip";
import {
  backMatterSections,
  buildManuscriptExportContext,
  chapterHeadingAlign,
  defaultTitleSubtitle,
  frontMatterSections,
  manuscriptExportWordCount,
  recordExportPrefix,
  recordExportSuffix,
  sceneBreakText,
  type ManuscriptExportBuildOptions,
  usesCustomTitlePage,
} from "./manuscriptExportCompile";
import { bodyToEpubSectionHtml, escapeHtml, sceneBreakHtml, type EpubImageSink } from "./manuscriptExportMarkdown";
import { docxImageType, type ExportInlineImage } from "./manuscriptExportImages";
import { exportDateStamp, exportSlug } from "./manuscriptExportModel";
import type { DbOrTx } from "../db";

export interface ManuscriptEpubFile {
  filename: string;
  bytes: Buffer;
  documentCount: number;
}

function xhtmlPage(title: string, bodyHtml: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">
  <head>
    <meta charset="utf-8"/>
    <title>${escapeAttr(title)}</title>
  </head>
  <body>
${bodyHtml}
  </body>
</html>`;
}

function escapeAttr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

const MATTER_LABELS: Record<string, string> = {
  dedication: "Dedication",
  copyright: "Copyright",
  acknowledgements: "Acknowledgements",
  "back-matter": "Back matter",
};

function appendMarkdown(
  parts: string[],
  markdown: string,
  images?: ReadonlyMap<string, ExportInlineImage>,
  sink?: EpubImageSink,
) {
  const trimmed = markdown.trim();
  if (trimmed) parts.push(bodyToEpubSectionHtml(trimmed, images, sink));
}

class EpubImageRegistry implements EpubImageSink {
  private readonly used = new Map<string, { id: string; href: string; mime: string; data: Uint8Array }>();

  register(image: ExportInlineImage): string {
    const existing = this.used.get(image.name);
    if (existing) return existing.href;
    const ext = docxImageType(image.mimeType) ?? "png";
    const id = `img-${this.used.size + 1}`;
    const href = `images/${id}.${ext}`;
    const mime = image.mimeType === "image/jpeg" ? "image/jpeg" : "image/png";
    this.used.set(image.name, { id, href, mime, data: image.data ?? new Uint8Array() });
    return href;
  }

  entries() {
    return [...this.used.values()];
  }
}

export async function buildManuscriptEpub(
  db: DbOrTx,
  projectId: string,
  options: ManuscriptExportBuildOptions,
  now = new Date(),
): Promise<ManuscriptEpubFile> {
  const exportCtx = await buildManuscriptExportContext(db, projectId, options, now);
  const model = exportCtx.model;
  const zip = new JSZip();
  const uid = `story-loom-${exportSlug(model.projectTitle)}-${now.getTime()}`;
  const generated = defaultTitleSubtitle(model.generatedAt);
  const chapterAlign = chapterHeadingAlign(exportCtx.compile.chapterHeadingStyle);
  const glyph = sceneBreakText(exportCtx.compile);
  const imageRegistry = new EpubImageRegistry();

  const spine: string[] = ["title"];
  const manifest: { id: string; href: string; mime: string }[] = [
    { id: "ncx", href: "toc.ncx", mime: "application/x-dtbncx+xml" },
    { id: "nav", href: "nav.xhtml", mime: "application/xhtml+xml" },
    { id: "title", href: "title.xhtml", mime: "application/xhtml+xml" },
  ];
  const navItems: { label: string; href: string }[] = [{ label: model.projectTitle, href: "title.xhtml" }];
  const ncxNavPoints: { id: string; label: string; href: string }[] = [
    { id: "np-title", label: model.projectTitle, href: "title.xhtml" },
  ];

  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
  );

  const wordLine = `<p>About ${manuscriptExportWordCount(exportCtx).toLocaleString("en-US")} words</p>`;
  const titleBody = usesCustomTitlePage(exportCtx.compile)
    ? `${bodyToEpubSectionHtml(exportCtx.compile.titlePageBody, undefined, imageRegistry)}${wordLine}`
    : `<h1>${escapeHtml(model.projectTitle)}</h1><p><em>Manuscript</em></p><p>${escapeHtml(generated)}</p>${wordLine}`;
  zip.file("OEBPS/title.xhtml", xhtmlPage(model.projectTitle, titleBody));

  const addMatter = (section: { key: string; body: string }) => {
    const id = `matter-${section.key}`;
    const href = `${id}.xhtml`;
    const label = MATTER_LABELS[section.key] ?? section.key;
    zip.file(`OEBPS/${href}`, xhtmlPage(label, bodyToEpubSectionHtml(section.body, undefined, imageRegistry)));
    spine.push(id);
    manifest.push({ id, href, mime: "application/xhtml+xml" });
    navItems.push({ label, href });
    ncxNavPoints.push({ id: `np-${id}`, label, href });
  };

  for (const section of frontMatterSections(exportCtx.compile)) addMatter(section);

  let chapterIndex = 0;
  for (const chapter of model.chapters) {
    chapterIndex += 1;
    const id = `ch-${chapterIndex}`;
    const href = `${id}.xhtml`;
    const parts: string[] = [
      `<h1 style="text-align:${chapterAlign}">${escapeHtml(chapter.record.title)}</h1>`,
    ];
    const chapterImages = exportCtx.imagesByRecord.get(chapter.record.id);
    appendMarkdown(parts, recordExportPrefix(chapter.record.id, exportCtx), chapterImages, imageRegistry);
    parts.push(bodyToEpubSectionHtml(chapter.record.body, chapterImages, imageRegistry));
    let sceneHadText = chapter.record.body.trim().length > 0;
    for (const scene of chapter.scenes) {
      if (model.sceneTitles) {
        parts.push(`<h3>${escapeHtml(scene.record.title)}</h3>`);
      } else if (sceneHadText && scene.record.body.trim()) {
        parts.push(sceneBreakHtml(glyph));
      }
      const sceneImages = exportCtx.imagesByRecord.get(scene.record.id);
      appendMarkdown(parts, recordExportPrefix(scene.record.id, exportCtx), sceneImages, imageRegistry);
      parts.push(bodyToEpubSectionHtml(scene.record.body, sceneImages, imageRegistry));
      sceneHadText = sceneHadText || scene.record.body.trim().length > 0;
      appendMarkdown(parts, recordExportSuffix(scene.record.id, exportCtx), sceneImages, imageRegistry);
    }
    appendMarkdown(parts, recordExportSuffix(chapter.record.id, exportCtx), chapterImages, imageRegistry);
    const body = parts.join("\n");
    zip.file(`OEBPS/${href}`, xhtmlPage(chapter.record.title, body));
    spine.push(id);
    manifest.push({ id, href, mime: "application/xhtml+xml" });
    navItems.push({ label: chapter.record.title, href });
    ncxNavPoints.push({ id: `np-${id}`, label: chapter.record.title, href });
  }

  if (model.unplacedScenes.length) {
    const id = "unplaced";
    const href = `${id}.xhtml`;
    const parts: string[] = [`<h1 style="text-align:${chapterAlign}">Scenes not in a chapter</h1>`];
    let sceneHadText = false;
    for (const scene of model.unplacedScenes) {
      if (model.sceneTitles) parts.push(`<h3>${escapeHtml(scene.record.title)}</h3>`);
      else if (sceneHadText && scene.record.body.trim()) parts.push(sceneBreakHtml(glyph));
      const sceneImages = exportCtx.imagesByRecord.get(scene.record.id);
      appendMarkdown(parts, recordExportPrefix(scene.record.id, exportCtx), sceneImages, imageRegistry);
      parts.push(bodyToEpubSectionHtml(scene.record.body, sceneImages, imageRegistry));
      sceneHadText = sceneHadText || scene.record.body.trim().length > 0;
      appendMarkdown(parts, recordExportSuffix(scene.record.id, exportCtx), sceneImages, imageRegistry);
    }
    zip.file(`OEBPS/${href}`, xhtmlPage("Scenes not in a chapter", parts.join("\n")));
    spine.push(id);
    manifest.push({ id, href, mime: "application/xhtml+xml" });
    navItems.push({ label: "Scenes not in a chapter", href });
    ncxNavPoints.push({ id: "np-unplaced", label: "Scenes not in a chapter", href });
  }

  for (const section of backMatterSections(exportCtx.compile)) addMatter(section);

  const navList = navItems.map((item) => `<li><a href="${item.href}">${escapeAttr(item.label)}</a></li>`).join("");
  zip.file(
    "OEBPS/nav.xhtml",
    xhtmlPage("Contents", `<nav epub:type="toc"><h1>Contents</h1><ol>${navList}</ol></nav>`).replace(
      "<html",
      '<html xmlns:epub="http://www.idpf.org/2007/ops"',
    ),
  );

  const ncxPoints = ncxNavPoints
    .map(
      (p, index) =>
        `<navPoint id="${p.id}" playOrder="${index + 1}"><navLabel><text>${escapeAttr(p.label)}</text></navLabel><content src="${p.href}"/></navPoint>`,
    )
    .join("");
  zip.file(
    "OEBPS/toc.ncx",
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${uid}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeAttr(model.projectTitle)}</text></docTitle>
  <navMap>${ncxPoints}</navMap>
</ncx>`,
  );

  for (const image of imageRegistry.entries()) {
    zip.file(`OEBPS/${image.href}`, Buffer.from(image.data));
    manifest.push({ id: image.id, href: image.href, mime: image.mime });
  }

  const manifestXml = manifest
    .map((item) => `<item id="${item.id}" href="${item.href}" media-type="${item.mime}"/>`)
    .join("");
  const spineXml = spine.map((idref) => `<itemref idref="${idref}"/>`).join("");
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${escapeAttr(model.projectTitle)}</dc:title>
    <dc:creator>Story Loom</dc:creator>
    <dc:language>en</dc:language>
    <dc:identifier id="book-id">${uid}</dc:identifier>
    <meta property="dcterms:modified">${model.generatedAt.toISOString().replace(/\.\d{3}Z$/, "Z")}</meta>
  </metadata>
  <manifest>
    ${manifestXml}
  </manifest>
  <spine toc="ncx">
    ${spineXml}
  </spine>
</package>`,
  );

  const bytes = Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  return {
    filename: `${exportSlug(model.projectTitle)}-manuscript-${exportDateStamp(now)}.epub`,
    bytes,
    documentCount: chapterIndex,
  };
}