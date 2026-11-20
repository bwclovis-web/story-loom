import "server-only";
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun, type FileChild } from "docx";
import {
  bodyToDocxChildren,
  chapterBreak,
  sceneBreakParagraph,
} from "./manuscriptExportMarkdown";
import { buildManuscriptExportModel, exportDateStamp, exportSlug, type ManuscriptExportModel } from "./manuscriptExportModel";
import type { DbOrTx } from "../db";

export interface ManuscriptDocxFile {
  filename: string;
  bytes: Buffer;
  documentCount: number;
}

function modelToSections(model: ManuscriptExportModel) {
  const children: FileChild[] = [];
  const generated = `Saved versions as of ${model.generatedAt.toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" })}`;
  children.push(
    new Paragraph({
      children: [new TextRun({ text: model.projectTitle, bold: true, size: 36 })],
      alignment: AlignmentType.CENTER,
    }),
  );
  children.push(
    new Paragraph({ children: [new TextRun({ text: "Manuscript", italics: true })], alignment: AlignmentType.CENTER }),
  );
  children.push(new Paragraph({ children: [new TextRun({ text: generated, size: 18 })], alignment: AlignmentType.CENTER }));
  children.push(chapterBreak());

  let chapterCount = 0;
  for (const chapter of model.chapters) {
    chapterCount += 1;
    children.push(chapterBreak());
    children.push(
      new Paragraph({
        children: [new TextRun({ text: chapter.record.title, bold: true, size: 32 })],
        alignment: AlignmentType.CENTER,
      }),
    );
    children.push(...bodyToDocxChildren(chapter.record.body));
    let sceneHadText = chapter.record.body.trim().length > 0;
    for (const scene of chapter.scenes) {
      if (model.sceneTitles) {
        children.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_3,
            children: [new TextRun(scene.record.title)],
          }),
        );
      } else if (sceneHadText && scene.record.body.trim()) {
        children.push(sceneBreakParagraph());
      }
      const sceneChildren = bodyToDocxChildren(scene.record.body);
      children.push(...sceneChildren);
      sceneHadText = sceneHadText || sceneChildren.length > 0;
    }
  }

  if (model.unplacedScenes.length) {
    children.push(chapterBreak());
    children.push(
      new Paragraph({
        children: [new TextRun({ text: "Scenes not in a chapter", bold: true, size: 32 })],
        alignment: AlignmentType.CENTER,
      }),
    );
    let sceneHadText = false;
    for (const scene of model.unplacedScenes) {
      if (model.sceneTitles) {
        children.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(scene.record.title)] }));
      } else if (sceneHadText && scene.record.body.trim()) {
        children.push(sceneBreakParagraph());
      }
      const sceneChildren = bodyToDocxChildren(scene.record.body);
      children.push(...sceneChildren);
      sceneHadText = sceneHadText || sceneChildren.length > 0;
    }
  }

  return { children, chapterCount };
}

export async function buildManuscriptDocx(
  db: DbOrTx,
  projectId: string,
  options: { sceneTitles: boolean; draftId?: string | null; hasDrafts?: boolean },
  now = new Date(),
): Promise<ManuscriptDocxFile> {
  const model = await buildManuscriptExportModel(db, projectId, options, now);
  const { children, chapterCount } = modelToSections(model);
  const doc = new Document({
    title: model.projectTitle,
    description: "Manuscript exported from Story Loom",
    sections: [{ children }],
  });
  const bytes = Buffer.from(await Packer.toBuffer(doc));
  return {
    filename: `${exportSlug(model.projectTitle)}-manuscript-${exportDateStamp(now)}.docx`,
    bytes,
    documentCount: chapterCount,
  };
}