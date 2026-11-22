import "server-only";
import { Document, Packer } from "docx";
import { buildManuscriptExportContext, type ManuscriptExportBuildOptions } from "./manuscriptExportCompile";
import { contextToDocxSections } from "./manuscriptExportDocx";
import { exportDateStamp, exportSlug } from "./manuscriptExportModel";
import type { DbOrTx } from "../db";

export interface ManuscriptDocxFile {
  filename: string;
  bytes: Buffer;
  documentCount: number;
}

export async function buildManuscriptDocx(
  db: DbOrTx,
  projectId: string,
  options: ManuscriptExportBuildOptions,
  now = new Date(),
): Promise<ManuscriptDocxFile> {
  const ctx = await buildManuscriptExportContext(db, projectId, options, now);
  const { sections, chapterCount } = contextToDocxSections(ctx);
  const model = ctx.model;
  const doc = new Document({
    title: model.projectTitle,
    description: "Manuscript exported from Story Loom",
    sections,
  });
  const bytes = Buffer.from(await Packer.toBuffer(doc));
  const beta = options.betaReader;
  return {
    filename: beta
      ? `${exportSlug(model.projectTitle)}-beta-reader-${exportDateStamp(now)}.docx`
      : `${exportSlug(model.projectTitle)}-manuscript-${exportDateStamp(now)}.docx`,
    bytes,
    documentCount: chapterCount,
  };
}
