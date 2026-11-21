import "server-only";
import {
  DEFAULT_COMPILE_PROFILE,
  getCompileProfile,
  type CompileProfileView,
  type ChapterHeadingStyle,
} from "./compileProfileService";
import { buildManuscriptExportModel, type ManuscriptExportModel } from "./manuscriptExportModel";
import { listExportMarginCommentsForRecords, listSynopsesForRecords } from "./manuscriptAnnotationService";
import type { DbOrTx } from "../db";

export interface ManuscriptExportBuildOptions {
  sceneTitles: boolean;
  draftId?: string | null;
  hasDrafts?: boolean;
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
  const recordIds = recordIdsFromModel(model);
  const [synopses, comments] = await Promise.all([
    compile.includeSynopses ? listSynopsesForRecords(db, projectId, recordIds) : Promise.resolve(new Map<string, string>()),
    compile.includeMarginComments
      ? listExportMarginCommentsForRecords(db, projectId, recordIds)
      : Promise.resolve(new Map<string, ExportMarginComment[]>()),
  ]);
  return { model, compile, synopses, comments };
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

export function matterSections(compile: CompileProfileView): { key: string; body: string }[] {
  const sections: { key: string; body: string }[] = [];
  if (compile.dedicationBody.trim()) sections.push({ key: "dedication", body: compile.dedicationBody });
  if (compile.copyrightPageBody.trim()) sections.push({ key: "copyright", body: compile.copyrightPageBody });
  if (compile.acknowledgementsBody.trim()) sections.push({ key: "acknowledgements", body: compile.acknowledgementsBody });
  return sections;
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