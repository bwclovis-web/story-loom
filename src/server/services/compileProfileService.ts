import { newId } from "@/domain/ids";
import { errorIssue } from "@/domain/issues";
import {
  marginPoints,
  parseExcludedIds,
  parseFontPreset,
  parseSpacingPreset,
  parseTrimSize,
  type FontPreset,
  type SpacingPreset,
  type TrimSize,
} from "@/writing/compileLayout";
import type { Db, DbOrTx } from "../db";
import { writeAudit } from "./auditService";
import { MutationRejectedError, NotFoundError } from "./errors";

export const CHAPTER_HEADING_STYLE = {
  centered: "centered",
  left: "left",
} as const;

export type ChapterHeadingStyle = (typeof CHAPTER_HEADING_STYLE)[keyof typeof CHAPTER_HEADING_STYLE];

export interface CompileProfileView {
  id: string | null;
  projectId: string;
  titlePageBody: string;
  copyrightPageBody: string;
  dedicationBody: string;
  acknowledgementsBody: string;
  sceneBreakGlyph: string;
  chapterHeadingStyle: ChapterHeadingStyle;
  includeSynopses: boolean;
  includeMarginComments: boolean;
  trimSize: TrimSize;
  marginInches: number;
  runningHeader: string;
  runningFooter: string;
  fontPreset: FontPreset;
  spacingPreset: SpacingPreset;
  firstParagraphNoIndent: boolean;
  dropCap: boolean;
  includeToc: boolean;
  backMatterBody: string;
  excludedRecordIds: string[];
  updatedAt: Date | null;
}

export const DEFAULT_COMPILE_PROFILE: Omit<CompileProfileView, "projectId"> = {
  id: null,
  titlePageBody: "",
  copyrightPageBody: "",
  dedicationBody: "",
  acknowledgementsBody: "",
  sceneBreakGlyph: "***",
  chapterHeadingStyle: CHAPTER_HEADING_STYLE.centered,
  includeSynopses: false,
  includeMarginComments: false,
  trimSize: "6x9",
  marginInches: 0.75,
  runningHeader: "",
  runningFooter: "",
  fontPreset: "serif",
  spacingPreset: "novel",
  firstParagraphNoIndent: true,
  dropCap: false,
  includeToc: true,
  backMatterBody: "",
  excludedRecordIds: [],
  updatedAt: null,
};

const UI_ACTOR = "author";
const MAX_MATTER = 120_000;
const MAX_GLYPH = 80;

function rejected(message: string): MutationRejectedError {
  return new MutationRejectedError([errorIssue("INVALID_CHANGE", message)]);
}

function parseMatter(field: string, label: string): string {
  if (field.length > MAX_MATTER) throw rejected(`${label} is too long.`);
  return field;
}

function parseGlyph(glyph: string): string {
  const trimmed = glyph.trim();
  if (!trimmed) return DEFAULT_COMPILE_PROFILE.sceneBreakGlyph;
  if (trimmed.length > MAX_GLYPH) throw rejected("Scene break glyph is too long.");
  return trimmed;
}

function parseHeadingStyle(style: string): ChapterHeadingStyle {
  return style === CHAPTER_HEADING_STYLE.left ? CHAPTER_HEADING_STYLE.left : CHAPTER_HEADING_STYLE.centered;
}

function toView(row: {
  id: string;
  projectId: string;
  titlePageBody: string;
  copyrightPageBody: string;
  dedicationBody: string;
  acknowledgementsBody: string;
  sceneBreakGlyph: string;
  chapterHeadingStyle: string;
  includeSynopses: boolean;
  includeMarginComments: boolean;
  trimSize: string;
  marginInches: number;
  runningHeader: string;
  runningFooter: string;
  fontPreset: string;
  spacingPreset: string;
  firstParagraphNoIndent: boolean;
  dropCap: boolean;
  includeToc: boolean;
  backMatterBody: string;
  excludedRecordIds: string;
  updatedAt: Date;
}): CompileProfileView {
  const margin = Number.isFinite(row.marginInches) ? row.marginInches : DEFAULT_COMPILE_PROFILE.marginInches;
  return {
    id: row.id,
    projectId: row.projectId,
    titlePageBody: row.titlePageBody,
    copyrightPageBody: row.copyrightPageBody,
    dedicationBody: row.dedicationBody,
    acknowledgementsBody: row.acknowledgementsBody,
    sceneBreakGlyph: row.sceneBreakGlyph || DEFAULT_COMPILE_PROFILE.sceneBreakGlyph,
    chapterHeadingStyle: parseHeadingStyle(row.chapterHeadingStyle),
    includeSynopses: row.includeSynopses,
    includeMarginComments: row.includeMarginComments,
    trimSize: parseTrimSize(row.trimSize),
    marginInches: marginPoints(margin) / 72,
    runningHeader: row.runningHeader.slice(0, 120),
    runningFooter: row.runningFooter.slice(0, 120),
    fontPreset: parseFontPreset(row.fontPreset),
    spacingPreset: parseSpacingPreset(row.spacingPreset),
    firstParagraphNoIndent: row.firstParagraphNoIndent,
    dropCap: row.dropCap,
    includeToc: row.includeToc,
    backMatterBody: row.backMatterBody,
    excludedRecordIds: parseExcludedIds(row.excludedRecordIds),
    updatedAt: row.updatedAt,
  };
}

export function mergeCompileProfile(projectId: string, row: CompileProfileView | null): CompileProfileView {
  if (!row) return { ...DEFAULT_COMPILE_PROFILE, projectId };
  return row;
}

export async function getCompileProfile(db: DbOrTx, projectId: string): Promise<CompileProfileView> {
  const row = await db.compileProfile.findUnique({ where: { projectId } });
  return mergeCompileProfile(projectId, row ? toView(row) : null);
}

export interface CompileProfileInput {
  titlePageBody: string;
  copyrightPageBody: string;
  dedicationBody: string;
  acknowledgementsBody: string;
  sceneBreakGlyph: string;
  chapterHeadingStyle: string;
  includeSynopses: boolean;
  includeMarginComments: boolean;
  trimSize?: string;
  marginInches?: number;
  runningHeader?: string;
  runningFooter?: string;
  fontPreset?: string;
  spacingPreset?: string;
  firstParagraphNoIndent?: boolean;
  dropCap?: boolean;
  includeToc?: boolean;
  backMatterBody?: string;
  excludedRecordIds?: readonly string[];
}

export async function upsertCompileProfile(db: Db, projectId: string, input: CompileProfileInput): Promise<CompileProfileView> {
  const data = {
    titlePageBody: parseMatter(input.titlePageBody, "Title page"),
    copyrightPageBody: parseMatter(input.copyrightPageBody, "Copyright page"),
    dedicationBody: parseMatter(input.dedicationBody, "Dedication"),
    acknowledgementsBody: parseMatter(input.acknowledgementsBody, "Acknowledgements"),
    sceneBreakGlyph: parseGlyph(input.sceneBreakGlyph),
    chapterHeadingStyle: parseHeadingStyle(input.chapterHeadingStyle),
    includeSynopses: !!input.includeSynopses,
    includeMarginComments: !!input.includeMarginComments,
    trimSize: parseTrimSize(input.trimSize ?? DEFAULT_COMPILE_PROFILE.trimSize),
    marginInches: marginPoints(input.marginInches ?? DEFAULT_COMPILE_PROFILE.marginInches) / 72,
    runningHeader: (input.runningHeader ?? "").trim().slice(0, 120),
    runningFooter: (input.runningFooter ?? "").trim().slice(0, 120),
    fontPreset: parseFontPreset(input.fontPreset ?? DEFAULT_COMPILE_PROFILE.fontPreset),
    spacingPreset: parseSpacingPreset(input.spacingPreset ?? DEFAULT_COMPILE_PROFILE.spacingPreset),
    firstParagraphNoIndent: input.firstParagraphNoIndent !== false,
    dropCap: input.dropCap === true,
    includeToc: input.includeToc !== false,
    backMatterBody: parseMatter(input.backMatterBody ?? "", "Back matter"),
    excludedRecordIds: JSON.stringify([...(input.excludedRecordIds ?? [])].filter((id) => id.length > 0 && id.length <= 80).slice(0, 500)),
  };

  return db.$transaction(async (tx) => {
    const project = await tx.project.findFirst({ where: { id: projectId, trashedAt: null }, select: { id: true, title: true } });
    if (!project) throw new NotFoundError(`Project ${projectId} not found`);

    const existing = await tx.compileProfile.findUnique({ where: { projectId } });
    const row = existing
      ? await tx.compileProfile.update({ where: { id: existing.id }, data })
      : await tx.compileProfile.create({
          data: { id: newId("cprof"), projectId, ...data },
        });

    await writeAudit(tx, {
      projectId,
      actor: UI_ACTOR,
      action: "compile_profile.save",
      summary: `Saved compile profile for “${project.title}”.`,
      details: {
        includeSynopses: data.includeSynopses,
        includeMarginComments: data.includeMarginComments,
        chapterHeadingStyle: data.chapterHeadingStyle,
      },
    });

    return toView(row);
  });
}