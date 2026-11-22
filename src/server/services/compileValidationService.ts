import "server-only";
import {
  buildManuscriptExportContext,
  frontMatterSections,
  manuscriptExportWordCount,
  type ManuscriptExportBuildOptions,
  type ManuscriptExportContext,
} from "./manuscriptExportCompile";
import type { DbOrTx } from "../db";

export type CompileIssueSeverity = "error" | "warn" | "info";

export interface CompileIssue {
  code: string;
  severity: CompileIssueSeverity;
  title: string;
  detail: string;
  href?: string;
}

export interface CompileValidationReport {
  issues: CompileIssue[];
  chapterCount: number;
  sceneCount: number;
  unplacedSceneCount: number;
  wordCount: number;
  frontMatterCount: number;
  hasBackMatter: boolean;
  excludedCount: number;
  includeSynopses: boolean;
  includeMarginComments: boolean;
}

const BRACKET_LINK = /\[\[[^\]]+\]\]/g;

function recordHref(projectId: string, recordId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(recordId)}`;
}

function emptyReport(issues: CompileIssue[]): CompileValidationReport {
  return {
    issues,
    chapterCount: 0,
    sceneCount: 0,
    unplacedSceneCount: 0,
    wordCount: 0,
    frontMatterCount: 0,
    hasBackMatter: false,
    excludedCount: 0,
    includeSynopses: false,
    includeMarginComments: false,
  };
}

/**
 * Pre-export checks against the same tree the download will use. Read-only.
 */
export async function validateManuscriptCompile(
  db: DbOrTx,
  projectId: string,
  options: ManuscriptExportBuildOptions,
): Promise<CompileValidationReport> {
  let ctx: ManuscriptExportContext;
  try {
    ctx = await buildManuscriptExportContext(db, projectId, options);
  } catch {
    return emptyReport([
      {
        code: "NO_MANUSCRIPT",
        severity: "error",
        title: "No manuscript to export",
        detail: "Add at least one chapter (or an unplaced scene) before downloading.",
      },
    ]);
  }

  const { model, compile } = ctx;
  const issues: CompileIssue[] = [];
  let sceneCount = 0;

  for (const chapter of model.chapters) {
    sceneCount += chapter.scenes.length;
    const chapterEmpty = !chapter.record.body.trim() && chapter.scenes.every((s) => !s.record.body.trim());
    if (chapterEmpty) {
      issues.push({
        code: "EMPTY_CHAPTER",
        severity: "warn",
        title: `Empty chapter: ${chapter.record.title}`,
        detail: "This chapter and its scenes have no saved text.",
        href: recordHref(projectId, chapter.record.id),
      });
    }
    for (const scene of chapter.scenes) {
      if (!scene.record.body.trim()) {
        issues.push({
          code: "EMPTY_SCENE",
          severity: "info",
          title: `Empty scene: ${scene.record.title}`,
          detail: `Inside “${chapter.record.title}”.`,
          href: recordHref(projectId, scene.record.id),
        });
      }
      scanUnresolved(projectId, scene.record.id, scene.record.title, scene.record.body, issues);
    }
    scanUnresolved(projectId, chapter.record.id, chapter.record.title, chapter.record.body, issues);
  }

  for (const scene of model.unplacedScenes) {
    sceneCount += 1;
    if (!scene.record.body.trim()) {
      issues.push({
        code: "EMPTY_SCENE",
        severity: "info",
        title: `Empty unplaced scene: ${scene.record.title}`,
        detail: "This scene is not inside a chapter.",
        href: recordHref(projectId, scene.record.id),
      });
    }
    scanUnresolved(projectId, scene.record.id, scene.record.title, scene.record.body, issues);
  }

  if (model.unplacedScenes.length) {
    issues.push({
      code: "UNPLACED_SCENES",
      severity: "warn",
      title: `${model.unplacedScenes.length} unplaced scene${model.unplacedScenes.length === 1 ? "" : "s"}`,
      detail:
        "These scenes export after the chapters under “Scenes not in a chapter”. Move them in Book order if that is not intended.",
    });
  }

  if (compile.includeSynopses) {
    issues.push({
      code: "INCLUDES_SYNOPSES",
      severity: "info",
      title: "Synopses are included",
      detail: "Synopsis cards will appear before chapter and scene bodies. Turn them off for a clean formatter handoff.",
    });
  }
  if (compile.includeMarginComments) {
    issues.push({
      code: "INCLUDES_COMMENTS",
      severity: "info",
      title: "Margin comments are included",
      detail: "Unresolved margin comments will appear after bodies. Turn them off for submission or formatter files.",
    });
  }

  const front = frontMatterSections(compile);
  if (!front.length && !compile.titlePageBody.trim()) {
    issues.push({
      code: "MISSING_FRONT_MATTER",
      severity: "info",
      title: "No custom front matter",
      detail:
        "The download will use the default title page. Add dedication, copyright, or a custom title page if your editor expects them.",
    });
  }

  const chapterIds = model.chapters.map((c) => c.record.id);
  const sceneIds = model.chapters.flatMap((c) => c.scenes.map((s) => s.record.id));
  const noteParents = [...chapterIds, ...sceneIds];
  if (noteParents.length) {
    const draftNotes = await db.record.findMany({
      where: {
        projectId,
        trashedAt: null,
        type: "scene_note",
        parentRecordId: { in: noteParents },
        authorityStatus: { in: ["draft", "unresolved"] },
      },
      select: { id: true },
      take: 20,
    });
    if (draftNotes.length) {
      issues.push({
        code: "DRAFT_NOTES",
        severity: "info",
        title: `${draftNotes.length} draft or unresolved scene note${draftNotes.length === 1 ? "" : "s"}`,
        detail:
          "Scene notes are not in the manuscript download, but they sit beside included chapters. Review them before handoff if needed.",
      });
    }
  }

  return {
    issues,
    chapterCount: model.chapters.length,
    sceneCount,
    unplacedSceneCount: model.unplacedScenes.length,
    wordCount: manuscriptExportWordCount(ctx),
    frontMatterCount: front.length + (compile.titlePageBody.trim() ? 1 : 1),
    hasBackMatter: compile.backMatterBody.trim().length > 0,
    excludedCount: compile.excludedRecordIds.length,
    includeSynopses: compile.includeSynopses,
    includeMarginComments: compile.includeMarginComments,
  };
}

function scanUnresolved(projectId: string, recordId: string, title: string, body: string, issues: CompileIssue[]) {
  const brackets = body.match(BRACKET_LINK);
  if (!brackets?.length) return;
  issues.push({
    code: "UNRESOLVED_LINKS",
    severity: "warn",
    title: `Possible [[links]] in “${title}”`,
    detail: `${brackets.slice(0, 3).join(", ")}${brackets.length > 3 ? "…" : ""} — check these before handing the file to an editor.`,
    href: recordHref(projectId, recordId),
  });
}
