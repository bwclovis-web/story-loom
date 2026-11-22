import "server-only";
import {
  DEFAULT_COMPILE_PROFILE,
  getCompileProfile,
  type CompileProfileView,
  type ChapterHeadingStyle,
} from "./compileProfileService";
import { buildManuscriptExportModel, type ManuscriptExportModel } from "./manuscriptExportModel";
import { listExportMarginCommentsForRecords, listSynopsesForRecords } from "./manuscriptAnnotationService";
import { isManuscriptType } from "@/domain/recordTypes";
import { filterCompileTree } from "@/writing/compileLayout";
import { countWords } from "@/writing/wordCount";
import type { DbOrTx } from "../db";
import { loadManuscriptExportImages, type ExportInlineImage } from "./manuscriptExportImages";

export interface ManuscriptExportBetaReaderOptions {
  lineNumbers?: boolean;
  watermark?: string;
  glossaryAppendix?: boolean;
}

export interface ManuscriptExportBuildOptions {
  sceneTitles: boolean;
  draftId?: string | null;
  hasDrafts?: boolean;
  betaReader?: ManuscriptExportBetaReaderOptions;
}

export interface GlossaryAppendixEntry {
  title: string;
  body: string;
}

export interface ExportMarginComment {
  body: string;
  passageExcerpt: string;
}

export interface ManuscriptExportContext {
  model: ManuscriptExportModel;
  compile: CompileProfileView;
  synopses: Map<string, string>;
  comments: Map<string, ExportMarginComment[]>;
  buildOptions: ManuscriptExportBuildOptions;
  glossaryAppendix?: GlossaryAppendixEntry[];
  imagesByRecord: Map<string, Map<string, ExportInlineImage>>;
}

function shortReferenceBody(body: string, max = 800): string {
  const stripped = body.replace(/^#+\s[^\n]*\n+/, "").trim();
  if (stripped.length <= max) return stripped;
  return `${stripped.slice(0, max).trimEnd()}…`;
}

function recordIdsFromModel(model: ManuscriptExportModel): string[] {
  const ids: string[] = [];
  for (const chapter of model.chapters) {
    ids.push(chapter.record.id);
    for (const scene of chapter.scenes) ids.push(scene.record.id);
  }
  for (const scene of model.unplacedScenes) ids.push(scene.record.id);
  return ids;
}

/** Manuscript tree, compile profile, and optional synopses/comments for export. */
export async function buildManuscriptExportContext(
  db: DbOrTx,
  projectId: string,
  options: ManuscriptExportBuildOptions,
  now = new Date(),
): Promise<ManuscriptExportContext> {
  const [model, compile] = await Promise.all([
    buildManuscriptExportModel(db, projectId, options, now),
    getCompileProfile(db, projectId),
  ]);
  const excluded = new Set(compile.excludedRecordIds);
  const filtered = filterCompileTree(
    model.chapters.map((chapter) => ({
      ...chapter,
      id: chapter.record.id,
      scenes: chapter.scenes.map((scene) => ({ ...scene, id: scene.record.id })),
    })),
    model.unplacedScenes.map((scene) => ({ ...scene, id: scene.record.id })),
    excluded,
  );
  const visible = { ...model, chapters: filtered.chapters, unplacedScenes: filtered.unplaced };
  const recordIds = recordIdsFromModel(visible);
  const [synopses, comments, glossaryRows, imagesByRecord] = await Promise.all([
    compile.includeSynopses ? listSynopsesForRecords(db, projectId, recordIds) : Promise.resolve(new Map<string, string>()),
    compile.includeMarginComments
      ? listExportMarginCommentsForRecords(db, projectId, recordIds)
      : Promise.resolve(new Map<string, ExportMarginComment[]>()),
    options.betaReader?.glossaryAppendix
      ? db.record.findMany({
          where: { projectId, trashedAt: null, authorityStatus: "approved" },
          select: { type: true, title: true, body: true },
          orderBy: [{ title: "asc" }, { id: "asc" }],
        })
      : Promise.resolve([]),
    loadManuscriptExportImages(db, projectId, recordIds),
  ]);
  const glossaryAppendix = options.betaReader?.glossaryAppendix
    ? glossaryRows
        .filter((row) => !isManuscriptType(row.type))
        .map((row) => ({ title: row.title, body: shortReferenceBody(row.body) }))
        .filter((row) => row.body.trim().length > 0)
    : undefined;
  return { model: visible, compile, synopses, comments, buildOptions: options, glossaryAppendix, imagesByRecord };
}

export function chapterHeadingAlign(style: ChapterHeadingStyle): "center" | "left" {
  return style === "left" ? "left" : "center";
}

export function defaultTitleSubtitle(generatedAt: Date): string {
  return `Saved versions as of ${generatedAt.toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" })}`;
}

export function usesCustomTitlePage(compile: CompileProfileView): boolean {
  return compile.titlePageBody.trim().length > 0;
}

/** Front matter only (before chapters). */
export function frontMatterSections(compile: CompileProfileView): { key: string; body: string }[] {
  const sections: { key: string; body: string }[] = [];
  if (compile.dedicationBody.trim()) sections.push({ key: "dedication", body: compile.dedicationBody });
  if (compile.copyrightPageBody.trim()) sections.push({ key: "copyright", body: compile.copyrightPageBody });
  if (compile.acknowledgementsBody.trim()) sections.push({ key: "acknowledgements", body: compile.acknowledgementsBody });
  return sections;
}

/** Back matter only (after chapters). */
export function backMatterSections(compile: CompileProfileView): { key: string; body: string }[] {
  if (!compile.backMatterBody.trim()) return [];
  return [{ key: "back-matter", body: compile.backMatterBody }];
}

/** All matter pages in PDF/DOCX/EPUB reading order (front then back). Prefer front/back helpers for builders. */
export function matterSections(compile: CompileProfileView): { key: string; body: string }[] {
  return [...frontMatterSections(compile), ...backMatterSections(compile)];
}

/** Word count of every body included in this export (visible prose). */
export function manuscriptExportWordCount(ctx: ManuscriptExportContext): number {
  let total = 0;
  for (const chapter of ctx.model.chapters) {
    total += countWords(chapter.record.body);
    for (const scene of chapter.scenes) total += countWords(scene.record.body);
  }
  for (const scene of ctx.model.unplacedScenes) total += countWords(scene.record.body);
  return total;
}

export function sceneBreakText(compile: Pick<CompileProfileView, "sceneBreakGlyph">): string {
  return compile.sceneBreakGlyph.trim() || DEFAULT_COMPILE_PROFILE.sceneBreakGlyph;
}

export function synopsisMarkdown(body: string): string {
  const text = body.trim();
  if (!text) return "";
  return `*Synopsis:* ${text}`;
}

export function commentsMarkdown(comments: ExportMarginComment[]): string {
  if (!comments.length) return "";
  const lines = ["**Margin comments**", ""];
  for (const c of comments) {
    const excerpt = c.passageExcerpt.trim();
    if (excerpt) lines.push(`> ${excerpt}`, "");
    if (c.body.trim()) lines.push(c.body.trim(), "");
  }
  return lines.join("\n").trim();
}

export function recordExportPrefix(recordId: string, ctx: ManuscriptExportContext): string {
  if (!ctx.compile.includeSynopses) return "";
  const syn = ctx.synopses.get(recordId);
  return syn?.trim() ? synopsisMarkdown(syn) : "";
}

export function recordExportSuffix(recordId: string, ctx: ManuscriptExportContext): string {
  if (!ctx.compile.includeMarginComments) return "";
  const list = ctx.comments.get(recordId);
  return list?.length ? commentsMarkdown(list) : "";
}