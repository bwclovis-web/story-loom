import "server-only";
import {
  buildManuscriptExportContext,
  frontMatterSections,
  manuscriptExportWordCount,
  type ManuscriptExportBuildOptions,
  type ManuscriptExportContext,
} from "./manuscriptExportCompile";
import { findProject } from "./projectService";
import { listCodexEntries } from "./recordService";
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
  readerSafe: boolean;
}

const BRACKET_LINK = /\[\[([^\]]+)\]\]/g;
const IMAGE_REF = /(?:^|\s)!?\[[^\]]*\]\(image:([^)\s]+)\)|!\[[^\]]*\]\(([^)\s]+)\)/gi;

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
    readerSafe: true,
  };
}

function normalizeLinkLabel(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
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
  const project = await findProject(db, projectId);
  const codex = await listCodexEntries(db, projectId);
  const knownLabels = new Set<string>();
  for (const entry of codex) {
    knownLabels.add(normalizeLinkLabel(entry.title));
    for (const alias of entry.aliases) knownLabels.add(normalizeLinkLabel(alias));
  }

  if (!project?.title.trim()) {
    issues.push({
      code: "MISSING_PROJECT_TITLE",
      severity: "error",
      title: "Manuscript title is empty",
      detail: "Rename the project before packaging EPUB, PDF, or DOCX — package metadata uses the title.",
    });
  } else {
    issues.push({
      code: "PACKAGE_METADATA",
      severity: "info",
      title: "Package metadata",
      detail: `Title “${project.title}”. EPUB currently lists Story Loom as creator; add author lines on the title or copyright page for handoff packages.`,
    });
  }

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
      scanBody(projectId, scene.record.id, scene.record.title, scene.record.body, knownLabels, issues);
    }
    scanBody(projectId, chapter.record.id, chapter.record.title, chapter.record.body, knownLabels, issues);
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
    scanBody(projectId, scene.record.id, scene.record.title, scene.record.body, knownLabels, issues);
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

  const readerSafe = !compile.includeSynopses && !compile.includeMarginComments;
  if (compile.includeSynopses) {
    issues.push({
      code: "INCLUDES_SYNOPSES",
      severity: "warn",
      title: "Synopses are included",
      detail:
        "Synopsis cards will appear before chapter and scene bodies. Turn them off for submission, ebook, or reader-facing packages.",
    });
  }
  if (compile.includeMarginComments) {
    issues.push({
      code: "INCLUDES_COMMENTS",
      severity: "warn",
      title: "Margin comments are included",
      detail:
        "Unresolved margin comments will appear after bodies. They are private planning notes — turn them off for reader packages.",
    });
  }
  if (!readerSafe) {
    issues.push({
      code: "NOT_READER_SAFE",
      severity: "info",
      title: "Not a reader-safe package",
      detail:
        "Author backups keep notes and history. Reader exports should leave synopses and margin comments off so private planning stays out of the file.",
    });
  }

  if (compile.dropCap && compile.fontPreset === "mono") {
    issues.push({
      code: "LAYOUT_DROP_CAP_MONO",
      severity: "warn",
      title: "Drop cap with mono font",
      detail: "Drop caps are uncommon on mono submission manuscripts. Turn drop cap off for Shunn-style handoff.",
    });
  }
  if (compile.dropCap && compile.spacingPreset === "manuscript") {
    issues.push({
      code: "LAYOUT_DROP_CAP_MANUSCRIPT",
      severity: "warn",
      title: "Drop cap with manuscript spacing",
      detail: "Double-spaced submission layouts usually omit drop caps.",
    });
  }
  if (compile.marginInches < 0.5) {
    issues.push({
      code: "LAYOUT_TIGHT_MARGINS",
      severity: "warn",
      title: "Margins under 0.5 in",
      detail: "Very tight margins may clip on paperback PDF printers. Check the spread preview.",
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
          "Scene notes are never copied into manuscript PDF/DOCX/EPUB. They stay in the project (and author backups) only.",
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
    readerSafe,
  };
}

function scanBody(
  projectId: string,
  recordId: string,
  title: string,
  body: string,
  knownLabels: Set<string>,
  issues: CompileIssue[],
) {
  const unresolved: string[] = [];
  for (const match of body.matchAll(BRACKET_LINK)) {
    const label = normalizeLinkLabel(match[1] ?? "");
    if (!label) continue;
    if (!knownLabels.has(label)) unresolved.push(match[0]);
  }
  if (unresolved.length) {
    issues.push({
      code: "UNRESOLVED_LINKS",
      severity: "warn",
      title: `Unresolved [[links]] in “${title}”`,
      detail: `${unresolved.slice(0, 3).join(", ")}${unresolved.length > 3 ? "…" : ""} — no matching World or manuscript title/alias in this project.`,
      href: recordHref(projectId, recordId),
    });
  }

  const imageHits: string[] = [];
  for (const match of body.matchAll(IMAGE_REF)) {
    const name = (match[1] || match[2] || "").trim();
    if (name.startsWith("image:") || name.includes("/")) {
      imageHits.push(name);
    }
  }
  if (imageHits.length) {
    issues.push({
      code: "IMAGE_REFS",
      severity: "info",
      title: `Image references in “${title}”`,
      detail: `${imageHits.slice(0, 3).join(", ")}${imageHits.length > 3 ? "…" : ""} — manuscript PDF/DOCX/EPUB may not embed every Markdown image the same way. Prefer World images on references for bible/portal packages.`,
      href: recordHref(projectId, recordId),
    });
  }
}
