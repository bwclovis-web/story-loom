import "server-only";
import {
  AlignmentType,
  Bookmark,
  Footer,
  Header,
  HeadingLevel,
  PageNumber,
  Paragraph,
  TextRun,
  convertInchesToTwip,
  type FileChild,
  type ISectionOptions,
} from "docx";
import { isStandardManuscriptProfile, shortTitleForHeader } from "@/writing/exportPresets";
import { spacingMetrics, TRIM_SIZES } from "@/writing/compileLayout";
import {
  backMatterSections,
  chapterHeadingAlign,
  defaultTitleSubtitle,
  frontMatterSections,
  manuscriptExportWordCount,
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

function isManuscriptLook(ctx: ManuscriptExportContext): boolean {
  return isStandardManuscriptProfile(ctx.compile);
}

/** Half-points: 24 = 12pt. */
function bodyRunSize(ctx: ManuscriptExportContext): number {
  return spacingMetrics(ctx.compile.spacingPreset).bodySize * 2;
}

function bodyFont(ctx: ManuscriptExportContext): string | undefined {
  if (ctx.compile.fontPreset === "mono") return "Courier New";
  if (ctx.compile.fontPreset === "sans") return "Arial";
  return "Times New Roman";
}

/** Twips: 240 = single, 480 = double. */
function lineSpacingTwips(ctx: ManuscriptExportContext): number | undefined {
  if (ctx.compile.spacingPreset === "manuscript") return 480;
  if (ctx.compile.spacingPreset === "loose") return 360;
  if (ctx.compile.spacingPreset === "tight") return 240;
  return 276;
}

function appendBodyMarkdown(children: FileChild[], markdown: string, ctx: ManuscriptExportContext) {
  const trimmed = markdown.trim();
  if (!trimmed) return;
  children.push(...bodyToDocxChildren(trimmed, docxBodyOptions(ctx)));
}

function docxBodyOptions(ctx: ManuscriptExportContext) {
  return {
    font: bodyFont(ctx),
    size: bodyRunSize(ctx),
    line: lineSpacingTwips(ctx),
    indentTwips: isManuscriptLook(ctx) ? convertInchesToTwip(0.5) : undefined,
  };
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
    const bookmarkId = `sl_record_${recordId.replace(/[^A-Za-z0-9]/g, "_")}`;
    const size = isManuscriptLook(ctx) ? 24 : 32;
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: lineSpacingTwips(ctx) ? { line: lineSpacingTwips(ctx) } : undefined,
        children: [
          new Bookmark({
            id: bookmarkId,
            children: [
              new TextRun({
                text: title,
                bold: true,
                size,
                font: bodyFont(ctx),
              }),
            ],
          }),
        ],
        alignment: headingAlignment(ctx),
      }),
    );
  }
  appendBodyMarkdown(children, recordExportPrefix(recordId, ctx), ctx);
  children.push(...bodyToDocxChildren(body, docxBodyOptions(ctx)));
  appendBodyMarkdown(children, recordExportSuffix(recordId, ctx), ctx);
}

function titlePageChildren(ctx: ManuscriptExportContext): FileChild[] {
  const { model } = ctx;
  const generated = defaultTitleSubtitle(model.generatedAt);
  const words = manuscriptExportWordCount(ctx);
  const wordLine = `About ${words.toLocaleString("en-US")} words`;
  const size = bodyRunSize(ctx);
  const font = bodyFont(ctx);

  if (usesCustomTitlePage(ctx.compile)) {
    const custom = bodyToDocxChildren(ctx.compile.titlePageBody, docxBodyOptions(ctx));
    if (isManuscriptLook(ctx)) {
      custom.push(
        new Paragraph({
          spacing: { before: 240, line: lineSpacingTwips(ctx) },
          children: [new TextRun({ text: wordLine, size, font })],
        }),
      );
    }
    return custom;
  }

  const children: FileChild[] = [
    new Paragraph({
      spacing: { line: lineSpacingTwips(ctx) },
      children: [new TextRun({ text: model.projectTitle, bold: true, size: isManuscriptLook(ctx) ? 24 : 36, font })],
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({
      spacing: { line: lineSpacingTwips(ctx) },
      children: [new TextRun({ text: "Manuscript", italics: true, size, font })],
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({
      spacing: { line: lineSpacingTwips(ctx) },
      children: [new TextRun({ text: generated, size: Math.max(18, size - 4), font })],
      alignment: AlignmentType.CENTER,
    }),
  ];
  if (isManuscriptLook(ctx) || ctx.compile.spacingPreset === "manuscript") {
    children.push(
      new Paragraph({
        spacing: { before: 240, line: lineSpacingTwips(ctx) },
        children: [new TextRun({ text: wordLine, size, font })],
        alignment: AlignmentType.CENTER,
      }),
    );
  }
  return children;
}

export function contextToDocxSections(ctx: ManuscriptExportContext): {
  sections: ISectionOptions[];
  chapterCount: number;
} {
  const { model, compile } = ctx;
  const children: FileChild[] = [];

  children.push(...titlePageChildren(ctx));

  for (const section of frontMatterSections(compile)) {
    children.push(chapterBreak());
    appendBodyMarkdown(children, section.body, ctx);
  }

  const glyph = sceneBreakText(compile);
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
            spacing: lineSpacingTwips(ctx) ? { line: lineSpacingTwips(ctx) } : undefined,
            children: [new TextRun({ text: scene.record.title, size: bodyRunSize(ctx), font: bodyFont(ctx) })],
          }),
        );
      } else if (sceneHadText && scene.record.body.trim()) {
        children.push(sceneBreakParagraph(glyph, docxBodyOptions(ctx)));
      }
      appendBodyMarkdown(children, recordExportPrefix(scene.record.id, ctx), ctx);
      const sceneChildren = bodyToDocxChildren(scene.record.body, docxBodyOptions(ctx));
      children.push(...sceneChildren);
      sceneHadText = sceneHadText || sceneChildren.length > 0;
      appendBodyMarkdown(children, recordExportSuffix(scene.record.id, ctx), ctx);
    }
  }

  if (model.unplacedScenes.length) {
    drawRecord(children, ctx, "unplaced", "Scenes not in a chapter", "", true);
    let sceneHadText = false;
    for (const scene of model.unplacedScenes) {
      if (model.sceneTitles) {
        children.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_3,
            children: [new TextRun({ text: scene.record.title, size: bodyRunSize(ctx), font: bodyFont(ctx) })],
          }),
        );
      } else if (sceneHadText && scene.record.body.trim()) {
        children.push(sceneBreakParagraph(glyph, docxBodyOptions(ctx)));
      }
      appendBodyMarkdown(children, recordExportPrefix(scene.record.id, ctx), ctx);
      const sceneChildren = bodyToDocxChildren(scene.record.body, docxBodyOptions(ctx));
      children.push(...sceneChildren);
      sceneHadText = sceneHadText || sceneChildren.length > 0;
      appendBodyMarkdown(children, recordExportSuffix(scene.record.id, ctx), ctx);
    }
  }

  for (const section of backMatterSections(compile)) {
    children.push(chapterBreak());
    appendBodyMarkdown(children, section.body, ctx);
  }

  const marginIn = compile.marginInches;
  const margin = {
    top: convertInchesToTwip(marginIn),
    bottom: convertInchesToTwip(marginIn),
    left: convertInchesToTwip(marginIn),
    right: convertInchesToTwip(marginIn),
  };
  const trim = TRIM_SIZES[compile.trimSize];
  // PDF points → inches → twips (20 twips per point).
  const pageSize = {
    width: Math.round(trim.width * 20),
    height: Math.round(trim.height * 20),
  };

  const headerText =
    compile.runningHeader.trim() ||
    (isManuscriptLook(ctx) ? shortTitleForHeader(model.projectTitle) : "");
  const footerText = compile.runningFooter.trim();

  const headers =
    headerText || isManuscriptLook(ctx)
      ? {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: headerText || shortTitleForHeader(model.projectTitle),
                    size: 20,
                    font: bodyFont(ctx),
                  }),
                  new TextRun({ text: " / ", size: 20, font: bodyFont(ctx) }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 20, font: bodyFont(ctx) }),
                ],
              }),
            ],
          }),
        }
      : undefined;

  const footers = footerText
    ? {
        default: new Footer({
          children: [
            new Paragraph({
              children: [new TextRun({ text: footerText, size: 18, font: bodyFont(ctx) })],
            }),
          ],
        }),
      }
    : undefined;

  return {
    sections: [
      {
        properties: {
          page: {
            margin,
            size: pageSize,
          },
        },
        headers,
        footers,
        children,
      },
    ],
    chapterCount,
  };
}
