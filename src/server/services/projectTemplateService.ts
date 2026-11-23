import "server-only";
import {
  DEFAULT_PROJECT_TEMPLATE,
  isProjectTemplateId,
  weavePresetForTemplate,
  type ProjectTemplateId,
} from "@/domain/projectTemplates";
import type { Db } from "@/server/db";
import { writeAudit } from "@/server/services/auditService";
import { NotFoundError } from "@/server/services/errors";
import { createProject } from "@/server/services/projectService";
import { createRecord } from "@/server/services/recordService";
import { instantiateWeavePresetGrid } from "@/server/services/weavePresetService";

export type AppliedProjectTemplate = {
  projectId: string;
  templateId: ProjectTemplateId;
  siblingProjectId: string | null;
  chapterId: string;
  weaveGridId: string | null;
};

const CHAPTER_BODY: Record<ProjectTemplateId, string> = {
  novel:
    "Write the opening of your novel here. This chapter is protected draft text — Enable editing, then Save or Take snapshot when you want a named restore point.\n",
  series:
    "Book One opens here. A sibling manuscript shares this series name so you can keep a series bible across books.\n",
  fantasy:
    "The first scene of your fantasy. Pin World places and characters from the Companion while you draft.\n",
  science_fiction:
    "The first scene of your science-fiction story. World references stay separate from this protected manuscript text.\n",
  mystery:
    "Plant the first clue in this chapter. The starter Weave grid mirrors a classic mystery beat sheet — moving beats never reorders scenes.\n",
  romance:
    "Open on the first meeting or spark. The romance Weave grid is a planning map only; this chapter remains the manuscript.\n",
  screenplay:
    "ACT 1 — FADE IN:\n\nINT. LOCATION — DAY\n\nDescribe the opening image. Use scenes under this act for further beats; the body stays Markdown.\n",
};

/**
 * After createProject, scaffolds invented starter records for the chosen
 * template. Never touches other workspaces. Blank title/body content is
 * invented placeholder prose only.
 */
export async function applyProjectTemplate(
  db: Db,
  projectId: string,
  rawTemplate: string | null | undefined,
): Promise<AppliedProjectTemplate> {
  const templateId = rawTemplate && isProjectTemplateId(rawTemplate) ? rawTemplate : DEFAULT_PROJECT_TEMPLATE;
  const project = await db.project.findFirst({
    where: { id: projectId, trashedAt: null },
    select: { id: true, title: true, workspaceId: true, seriesName: true },
  });
  if (!project) throw new NotFoundError(`Project ${projectId} not found`);

  let siblingProjectId: string | null = null;
  if (templateId === "series") {
    const seriesName = project.title.trim() || "Untitled series";
    await db.project.update({
      where: { id: projectId },
      data: { seriesName, bookName: "Book One" },
    });
    const sibling = await createProject(db, {
      workspaceId: project.workspaceId,
      title: `${seriesName} — Book Two`,
    });
    await db.project.update({
      where: { id: sibling.id },
      data: { seriesName, bookName: "Book Two" },
    });
    siblingProjectId = sibling.id;
  }

  const chapterTitle =
    templateId === "screenplay" ? "Act 1" : templateId === "series" ? "Chapter 1 — Book One" : "Chapter 1";
  const chapterBatch = await createRecord(db, projectId, {
    type: "manuscript_chapter",
    title: chapterTitle,
    body: CHAPTER_BODY[templateId],
    authorityStatus: "draft",
  });
  const chapterId = chapterBatch.outcomes[0].recordId;

  if (templateId === "fantasy" || templateId === "science_fiction") {
    const placeTitle = templateId === "fantasy" ? "Ashen Gate" : "Orbital Dock 7";
    const placeBody =
      templateId === "fantasy"
        ? "Stone arch where the road meets the wild. Invented starter place — rename or expand freely."
        : "Transit hub above the blue line. Invented starter place — rename or expand freely.";
    const castTitle = templateId === "fantasy" ? "Ryn Vale" : "Commander Ilya Chen";
    const castBody =
      templateId === "fantasy"
        ? "Scout who keeps the Gate ledger. Invented starter dossier — draft, not canon until you approve."
        : "Dock chief who knows every shuttle bay. Invented starter dossier — draft, not canon until you approve.";
    await createRecord(db, projectId, {
      type: "worldbuilding",
      title: placeTitle,
      body: placeBody,
      fields: { kind: "place" },
      authorityStatus: "draft",
      worldScope: "book",
    });
    await createRecord(db, projectId, {
      type: "character_dossier",
      title: castTitle,
      body: castBody,
      fields: { name: castTitle },
      authorityStatus: "draft",
      worldScope: "book",
    });
  }

  if (templateId === "screenplay") {
    await createRecord(db, projectId, {
      type: "manuscript_scene",
      title: "Opening image",
      body: "Scene cards stay under the act. Replace this placeholder when you break the page.\n",
      authorityStatus: "draft",
      parentRecordId: chapterId,
    });
  }

  let weaveGridId: string | null = null;
  const presetId = weavePresetForTemplate(templateId);
  if (presetId) {
    const grid = await instantiateWeavePresetGrid(db, projectId, presetId, {
      title: undefined,
      viewKind: "original",
    });
    weaveGridId = grid.id;
  }

  await writeAudit(db, {
    projectId,
    action: "project.template_apply",
    actor: "author",
    summary: `Applied project template “${templateId}” to "${project.title}"`,
    details: {
      projectId,
      templateId,
      chapterId,
      siblingProjectId,
      weaveGridId,
    },
  });

  return { projectId, templateId, siblingProjectId, chapterId, weaveGridId };
}
