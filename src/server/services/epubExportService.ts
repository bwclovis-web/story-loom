import "server-only";
import JSZip from "jszip";
import { bodyToEpubSectionHtml, escapeHtml, sceneBreakHtml } from "./manuscriptExportMarkdown";
import { buildManuscriptExportModel, exportDateStamp, exportSlug } from "./manuscriptExportModel";
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

export async function buildManuscriptEpub(
  db: DbOrTx,
  projectId: string,
  options: { sceneTitles: boolean; draftId?: string | null; hasDrafts?: boolean },
  now = new Date(),
): Promise<ManuscriptEpubFile> {
  const model = await buildManuscriptExportModel(db, projectId, options, now);
  const zip = new JSZip();
  const uid = `story-loom-${exportSlug(model.projectTitle)}-${now.getTime()}`;
  const generated = model.generatedAt.toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" });

  const spine: string[] = ["title"];
  const manifest: { id: string; href: string; mime: string }[] = [
    { id: "ncx", href: "toc.ncx", mime: "application/x-dtbncx+xml" },
    { id: "nav", href: "nav.xhtml", mime: "application/xhtml+xml" },
    { id: "title", href: "title.xhtml", mime: "application/xhtml+xml" },
  ];
  const navItems: { label: string; href: string }[] = [{ label: model.projectTitle, href: "title.xhtml" }];
  const ncxNavPoints: { id: string; label: string; href: string }[] = [{ id: "np-title", label: model.projectTitle, href: "title.xhtml" }];

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

  const titleBody = `<h1>${escapeHtml(model.projectTitle)}</h1><p><em>Manuscript</em></p><p>${escapeHtml(generated)}</p>`;
  zip.file("OEBPS/title.xhtml", xhtmlPage(model.projectTitle, titleBody));

  let chapterIndex = 0;
  for (const chapter of model.chapters) {
    chapterIndex += 1;
    const id = `ch-${chapterIndex}`;
    const href = `${id}.xhtml`;
    let body = `<h1>${escapeHtml(chapter.record.title)}</h1>\n${bodyToEpubSectionHtml(chapter.record.body)}`;
    let sceneHadText = chapter.record.body.trim().length > 0;
    for (const scene of chapter.scenes) {
      if (model.sceneTitles) {
        body += `\n<h3>${escapeHtml(scene.record.title)}</h3>`;
      } else if (sceneHadText && scene.record.body.trim()) {
        body += `\n${sceneBreakHtml()}`;
      }
      body += `\n${bodyToEpubSectionHtml(scene.record.body)}`;
      sceneHadText = sceneHadText || scene.record.body.trim().length > 0;
    }
    zip.file(`OEBPS/${href}`, xhtmlPage(chapter.record.title, body));
    spine.push(id);
    manifest.push({ id, href, mime: "application/xhtml+xml" });
    navItems.push({ label: chapter.record.title, href });
    ncxNavPoints.push({ id: `np-${id}`, label: chapter.record.title, href });
  }

  if (model.unplacedScenes.length) {
    const id = "unplaced";
    const href = `${id}.xhtml`;
    let body = `<h1>Scenes not in a chapter</h1>`;
    let sceneHadText = false;
    for (const scene of model.unplacedScenes) {
      if (model.sceneTitles) body += `\n<h3>${escapeAttr(scene.record.title)}</h3>`;
      else if (sceneHadText && scene.record.body.trim()) body += `\n${sceneBreakHtml()}`;
      body += `\n${bodyToEpubSectionHtml(scene.record.body)}`;
      sceneHadText = sceneHadText || scene.record.body.trim().length > 0;
    }
    zip.file(`OEBPS/${href}`, xhtmlPage("Scenes not in a chapter", body));
    spine.push(id);
    manifest.push({ id, href, mime: "application/xhtml+xml" });
    navItems.push({ label: "Scenes not in a chapter", href });
    ncxNavPoints.push({ id: "np-unplaced", label: "Scenes not in a chapter", href });
  }

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