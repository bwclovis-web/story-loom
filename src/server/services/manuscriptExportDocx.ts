import "server-only";
import { AlignmentType, Bookmark, HeadingLevel, Paragraph, TextRun, type FileChild } from "docx";
import {
  chapterHeadingAlign,
  defaultTitleSubtitle,
  matterSections,
  recordExportPrefix,
  recordExportSuffix,
  sceneBreakText,
  type ManuscriptExportContext,
  usesCustomTitlePage,
} from "./manuscriptExportCompile";
import { bodyToDocxChildren, chapterBreak, sceneBreakParagraph } from "./manuscriptExportMarkdown";

function headingAlignment(ctx: ManuscriptExportContext): (typeof AlignmentType)[keyof typeof AlignmentType] {
  return chapterHeadingAlign(ctx.compile.chapterHeadingStyle) === "left"
    ? AlignmentType.LEFT
    : AlignmentType.CENTER;
}

function appendBodyMarkdown(children: FileChild[], markdown: string) {
  const trimmed = markdown.trim();
  if (trimmed) children.push(...bodyToDocxChildren(trimmed));
}

function drawRecord(
  children: FileChild[],
  ctx: ManuscriptExportContext,
  recordId: string,
  title: string,
  body: string,
  asChapter: boolean,
) {
  if (asChapter) {
    children.push(chapterBreak());
    // Stable bookmark for editor DOCX round-trip matching (Word allows [A-Za-z0-9_]).
    const bookmarkId = `sl_record_${recordId.replace(/[^A-Za-z0-9]/g, "_")}`;
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [
          new Bookmark({
            id: bookmarkId,
            children: [new TextRun({ text: title, bold: true, size: 32 })],
          }),
        ],
        alignment: headingAlignment(ctx),
      }),
    );
  }
  appendBodyMarkdown(children, recordExportPrefix(recordId, ctx));
  children.push(...bodyToDocxChildren(body));
  appendBodyMarkdown(children, recordExportSuffix(recordId, ctx));
}

export function contextToDocxSections(ctx: ManuscriptExportContext) {
  const { model } = ctx;
  const children: FileChild[] = [];
  const generated = defaultTitleSubtitle(model.generatedAt);

  if (usesCustomTitlePage(ctx.compile)) {
    children.push(...bodyToDocxChildren(ctx.compile.titlePageBody));
  } else {
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
  }
  children.push(chapterBreak());

  for (const section of matterSections(ctx.compile)) {
    children.push(chapterBreak());
    appendBodyMarkdown(children, section.body);
  }

  const glyph = sceneBreakText(ctx.compile);
  let chapterCount = 0;
  for (const chapter of model.chapters) {
    chapterCount += 1;
    drawRecord(children, ctx, chapter.record.id, chapter.record.title, chapter.record.body, true);
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
        children.push(sceneBreakParagraph(glyph));
      }
      appendBodyMarkdown(children, recordExportPrefix(scene.record.id, ctx));
      const sceneChildren = bodyToDocxChildren(scene.record.body);
      children.push(...sceneChildren);
      sceneHadText = sceneHadText || sceneChildren.length > 0;
      appendBodyMarkdown(children, recordExportSuffix(scene.record.id, ctx));
    }
  }

  if (model.unplacedScenes.length) {
    drawRecord(children, ctx, "unplaced", "Scenes not in a chapter", "", true);
    let sceneHadText = false;
    for (const scene of model.unplacedScenes) {
      if (model.sceneTitles) {
        children.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(scene.record.title)] }));
      } else if (sceneHadText && scene.record.body.trim()) {
        children.push(sceneBreakParagraph(glyph));
      }
      appendBodyMarkdown(children, recordExportPrefix(scene.record.id, ctx));
      const sceneChildren = bodyToDocxChildren(scene.record.body);
      children.push(...sceneChildren);
      sceneHadText = sceneHadText || sceneChildren.length > 0;
      appendBodyMarkdown(children, recordExportSuffix(scene.record.id, ctx));
    }
  }

  return { children, chapterCount };
}