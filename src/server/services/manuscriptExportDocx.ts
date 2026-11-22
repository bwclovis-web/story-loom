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
import { exportTypography } from "@/writing/bookThemes";
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
import {
  bodyToDocxChildren,
  chapterBreak,
  sceneBreakParagraph,
  type DocxParagraphNumbering,
} from "./manuscriptExportMarkdown";

function layoutTypography(ctx: ManuscriptExportContext) {
  return exportTypography(ctx.compile);
}

function headingAlignment(ctx: ManuscriptExportContext): (typeof AlignmentType)[keyof typeof AlignmentType] {
  return chapterHeadingAlign(layoutTypography(ctx).chapterHeadingStyle) === "left"
    ? AlignmentType.LEFT
    : AlignmentType.CENTER;
}

function isManuscriptLook(ctx: ManuscriptExportContext): boolean {
  return isStandardManuscriptProfile(ctx.compile);
}

/** Half-points: 24 = 12pt. */
function bodyRunSize(ctx: ManuscriptExportContext): number {
  return spacingMetrics(layoutTypography(ctx).spacingPreset).bodySize * 2;
}

function bodyFont(ctx: ManuscriptExportContext): string | undefined {
  const preset = layoutTypography(ctx).fontPreset;
  if (preset === "mono") return "Courier New";
  if (preset === "sans") return "Arial";
  return "Times New Roman";
}

/** Twips: 240 = single, 480 = double. */
function lineSpacingTwips(ctx: ManuscriptExportContext): number | undefined {
  const preset = layoutTypography(ctx).spacingPreset;
  if (ctx.compile.spacingPreset === "manuscript" || preset === "manuscript") return 480;
  if (preset === "loose") return 360;
  if (preset === "tight") return 240;
  return 276;
}

function appendBodyMarkdown(
  children: FileChild[],
  markdown: string,
  ctx: ManuscriptExportContext,
  paragraphNumbers?: DocxParagraphNumbering,
  recordId?: string,
) {
  const trimmed = markdown.trim();
  if (!trimmed) return;
  const images = recordId ? ctx.imagesByRecord.get(recordId) : undefined;
  children.push(...bodyToDocxChildren(trimmed, docxBodyOptions(ctx), paragraphNumbers, images));
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
  paragraphNumbers?: DocxParagraphNumbering,
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
  appendBodyMarkdown(children, recordExportPrefix(recordId, ctx), ctx, paragraphNumbers, recordId);
  children.push(...bodyToDocxChildren(body, docxBodyOptions(ctx), paragraphNumbers, ctx.imagesByRecord.get(recordId)));
  appendBodyMarkdown(children, recordExportSuffix(recordId, ctx), ctx, paragraphNumbers, recordId);
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

const DEFAULT_BETA_WATERMARK = "Beta reader copy — do not redistribute";

function betaWatermark(ctx: ManuscriptExportContext): string | undefined {
  const beta = ctx.buildOptions.betaReader;
  if (!beta) return undefined;
  const custom = beta.watermark?.trim();
  return custom || DEFAULT_BETA_WATERMARK;
}

function appendGlossary(ctx: ManuscriptExportContext, children: FileChild[], paragraphNumbers?: DocxParagraphNumbering) {
  const entries = ctx.glossaryAppendix;
  if (!entries?.length) return;
  children.push(chapterBreak());
  const size = bodyRunSize(ctx);
  const font = bodyFont(ctx);
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: lineSpacingTwips(ctx) ? { line: lineSpacingTwips(ctx) } : undefined,
      children: [new TextRun({ text: "Glossary appendix", bold: true, size, font })],
      alignment: headingAlignment(ctx),
    }),
  );
  for (const entry of entries) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        spacing: lineSpacingTwips(ctx) ? { line: lineSpacingTwips(ctx) } : undefined,
        children: [new TextRun({ text: entry.title, bold: true, size: bodyRunSize(ctx), font: bodyFont(ctx) })],
      }),
    );
    appendBodyMarkdown(children, entry.body, ctx, paragraphNumbers);
  }
}

export function contextToDocxSections(ctx: ManuscriptExportContext): {
  sections: ISectionOptions[];
  chapterCount: number;
} {
  const { model, compile } = ctx;
  const children: FileChild[] = [];
  const paragraphNumbers: DocxParagraphNumbering | undefined = ctx.buildOptions.betaReader?.lineNumbers
    ? { next: 0 }
    : undefined;

  children.push(...titlePageChildren(ctx));

  for (const section of frontMatterSections(compile)) {
    children.push(chapterBreak());
    appendBodyMarkdown(children, section.body, ctx, paragraphNumbers);
  }

  const glyph = sceneBreakText(compile);
  let chapterCount = 0;
  for (const chapter of model.chapters) {
    chapterCount += 1;
    drawRecord(children, ctx, chapter.record.id, chapter.record.title, chapter.record.body, true, paragraphNumbers);
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
      appendBodyMarkdown(children, recordExportPrefix(scene.record.id, ctx), ctx, paragraphNumbers);
      const sceneChildren = bodyToDocxChildren(
        scene.record.body,
        docxBodyOptions(ctx),
        paragraphNumbers,
        ctx.imagesByRecord.get(scene.record.id),
      );
      children.push(...sceneChildren);
      sceneHadText = sceneHadText || sceneChildren.length > 0;
      appendBodyMarkdown(children, recordExportSuffix(scene.record.id, ctx), ctx, paragraphNumbers);
    }
  }

  if (model.unplacedScenes.length) {
    drawRecord(children, ctx, "unplaced", "Scenes not in a chapter", "", true, paragraphNumbers);
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
      appendBodyMarkdown(children, recordExportPrefix(scene.record.id, ctx), ctx, paragraphNumbers);
      const sceneChildren = bodyToDocxChildren(
        scene.record.body,
        docxBodyOptions(ctx),
        paragraphNumbers,
        ctx.imagesByRecord.get(scene.record.id),
      );
      children.push(...sceneChildren);
      sceneHadText = sceneHadText || sceneChildren.length > 0;
      appendBodyMarkdown(children, recordExportSuffix(scene.record.id, ctx), ctx, paragraphNumbers);
    }
  }

  for (const section of backMatterSections(compile)) {
    children.push(chapterBreak());
    appendBodyMarkdown(children, section.body, ctx, paragraphNumbers);
  }

  appendGlossary(ctx, children, paragraphNumbers);

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

  const watermark = betaWatermark(ctx);
  const headerText =
    watermark ||
    compile.runningHeader.trim() ||
    (isManuscriptLook(ctx) ? shortTitleForHeader(model.projectTitle) : "");
  const footerText = compile.runningFooter.trim();

  const headers =
    headerText || isManuscriptLook(ctx) || watermark
      ? {
          default: new Header({
            children: [
              new Paragraph({
                alignment: watermark ? AlignmentType.CENTER : AlignmentType.RIGHT,
                children: watermark
                  ? [
                      new TextRun({
                        text: watermark,
                        size: 18,
                        font: bodyFont(ctx),
                        italics: true,
                      }),
                      new TextRun({ text: "  ", size: 18 }),
                      new TextRun({ children: [PageNumber.CURRENT], size: 18, font: bodyFont(ctx) }),
                    ]
                  : [
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
