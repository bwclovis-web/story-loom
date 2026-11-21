import "server-only";
import { Document, Packer, Paragraph, TextRun } from "docx";
import JSZip from "jszip";
import { toRecordView } from "@/domain/records";
import { isManuscriptType, RECORD_TYPES } from "@/domain/recordTypes";
import type { DbOrTx } from "../db";
import { NotFoundError } from "./errors";
import { bodyToEpubSectionHtml, escapeHtml } from "./manuscriptExportMarkdown";
import { exportDateStamp, exportSlug } from "./manuscriptExportModel";
import { LIVE_PROJECT } from "./trashFilters";

export interface WorldBibleFile {
  filename: string;
  bytes: Buffer;
  documentCount: number;
  contentType: string;
}

async function selectedReferences(db: DbOrTx, projectId: string, recordIds: readonly string[]) {
  const project = await db.project.findFirst({ where: { id: projectId, ...LIVE_PROJECT }, select: { title: true } });
  if (!project) throw new NotFoundError(`Project ${projectId} not found`);
  const rows = await db.record.findMany({
    where: { projectId, id: { in: [...new Set(recordIds)] }, trashedAt: null },
  });
  const records = rows
    .map(toRecordView)
    .filter((record) => !isManuscriptType(record.type))
    .sort((a, b) => RECORD_TYPES.indexOf(a.type) - RECORD_TYPES.indexOf(b.type) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  if (!records.length) throw new NotFoundError("No reference documents were selected.");
  return { projectTitle: project.title, records };
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
