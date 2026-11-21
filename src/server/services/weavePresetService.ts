import { newId } from "@/domain/ids";
import { errorIssue } from "@/domain/issues";
import { isLinkableReferenceType, isRecordType } from "@/domain/recordTypes";
import { getWeaveBeatPreset, layoutWeavePreset, withThreadLine } from "@/world/weaveBeatPresets";
import type { Db } from "../db";
import { writeAudit } from "./auditService";
import { MutationRejectedError, NotFoundError } from "./errors";
import { linkReference } from "./linkService";
import { upsertSynopsis } from "./manuscriptAnnotationService";
import { createRecord } from "./recordService";
import {
  getWeaveGrid,
  getWeaveTemplate,
  isWeaveViewKind,
  type WeaveBeatView,
  type WeaveGridView,
  type WeaveTemplateView,
  type WeaveViewKind,
} from "./weaveService";

/*
 * Starter beat sheets and creating a scene from a beat. Kept out of
 * weaveService so client components can import Weave view kinds without
 * pulling the record writer or the database into the browser bundle.
 * Scene creation still goes through createRecord.
 */

const UI_ACTOR = "author";

function rejected(message: string): MutationRejectedError {
  return new MutationRejectedError([errorIssue("INVALID_CHANGE", message)]);
}

/** Copies a starter beat sheet into an editable template. The starter is not linked afterward. */
export async function importWeavePresetAsTemplate(db: Db, projectId: string, presetId: string): Promise<WeaveTemplateView> {
  const preset = getWeaveBeatPreset(presetId);
  if (!preset) throw rejected("Unknown beat sheet.");
  const placed = layoutWeavePreset(preset);
  return db.$transaction(async (tx) => {
    const project = await tx.project.findFirst({ where: { id: projectId, trashedAt: null }, select: { id: true } });
    if (!project) throw new NotFoundError(`Project ${projectId} not found`);
    const templateId = newId("wvt");
    await tx.weaveTemplate.create({
      data: { id: templateId, projectId, title: preset.title, description: preset.description },
    });
    for (const [position, beat] of placed.entries()) {
      await tx.weaveTemplateBeat.create({
        data: {
          id: newId("wvx"),
          templateId,
          title: beat.title,
          body: withThreadLine(beat.threadTitle, beat.prompt),
          x: beat.x,
          y: beat.y,
          zIndex: position,
          position,
        },
      });
    }
    await writeAudit(tx, {
      projectId,
      action: "weave_preset.template",
      actor: UI_ACTOR,
      summary: `Saved starter “${preset.title}” as a template`,
      details: { presetId: preset.id, templateId, beatCount: placed.length },
    });
    return getWeaveTemplate(tx, projectId, templateId);
  });
}

/** Opens a new plot grid from a starter: threads, beats, and the sheet's setup→payoff links. */
export async function instantiateWeavePresetGrid(
  db: Db,
  projectId: string,
  presetId: string,
  input: { title?: string; viewKind: WeaveViewKind },
): Promise<WeaveGridView> {
  const preset = getWeaveBeatPreset(presetId);
  if (!preset) throw rejected("Unknown beat sheet.");
  if (!isWeaveViewKind(input.viewKind)) throw rejected("Unknown Weave view kind.");
  const placed = layoutWeavePreset(preset);
  const title = input.title?.trim() || preset.title;
  return db.$transaction(async (tx) => {
    const project = await tx.project.findFirst({
      where: { id: projectId, trashedAt: null },
      select: { id: true, workspaceId: true },
    });
    if (!project) throw new NotFoundError(`Project ${projectId} not found`);
    const gridId = newId("wvg");
    await tx.weaveGrid.create({
      data: {
        id: gridId,
        projectId,
        title,
        viewKind: input.viewKind,
        layoutMode: "plot_grid",
      },
    });
    const threadIds = new Map<string, string>();
    for (const [position, thread] of preset.threads.entries()) {
      const threadId = newId("wth");
      threadIds.set(thread.key, threadId);
      await tx.weaveThread.create({
        data: { id: threadId, gridId, projectId, title: thread.title, position },
      });
    }
    const beatIds: string[] = [];
    for (const [index, beat] of placed.entries()) {
      const beatId = newId("wvb");
      beatIds.push(beatId);
      await tx.weaveBeat.create({
        data: {
          id: beatId,
          gridId,
          projectId,
          title: beat.title,
          body: beat.prompt,
          threadId: threadIds.get(beat.threadKey) ?? null,
          cellOrder: beat.cellOrder,
          x: beat.x,
          y: beat.y,
          zIndex: index,
        },
      });
    }
    for (const link of preset.links) {
      const fromBeatId = beatIds[link.from];
      const toBeatId = beatIds[link.to];
      if (!fromBeatId || !toBeatId || fromBeatId === toBeatId) continue;
      await tx.weaveSetupPayoff.create({
        data: {
          id: newId("wvs"),
          workspaceId: project.workspaceId,
          fromBeatId,
          toBeatId,
          note: link.note,
        },
      });
    }
    await writeAudit(tx, {
      projectId,
      action: "weave_preset.grid",
      actor: UI_ACTOR,
      summary: `Started a grid from “${preset.title}”`,
      details: { presetId: preset.id, gridId, viewKind: input.viewKind, beatCount: placed.length },
    });
    return getWeaveGrid(tx, projectId, gridId);
  });
}

/**
 * Author action: create a scene in a chosen chapter from a beat.
 * The scene body stays empty. The beat notes become the synopsis.
 * Cited World records become reference links. The beat then points at the scene.
 */
export async function createSceneFromWeaveBeat(
  db: Db,
  projectId: string,
  beatId: string,
  input: { chapterId: string },
): Promise<WeaveBeatView> {
  const beat = await db.weaveBeat.findFirst({
    where: { id: beatId, projectId },
    include: {
      worldRefs: { include: { record: { select: { id: true, type: true, trashedAt: true } } } },
    },
  });
  if (!beat) throw new NotFoundError(`Weave beat ${beatId} not found`);
  if (beat.manuscriptRecordId) throw rejected("This beat is already linked to a chapter or scene.");
  const chapter = await db.record.findFirst({
    where: { id: input.chapterId, projectId, trashedAt: null },
    select: { id: true, type: true, draftId: true },
  });
  if (!chapter || chapter.type !== "manuscript_chapter") {
    throw rejected("Choose a chapter in this project.");
  }
  const sceneId = newId("rec");
  const title = beat.title.trim() || "Scene";
  await createRecord(db, projectId, {
    recordId: sceneId,
    type: "manuscript_scene",
    title,
    body: "",
    authorityStatus: "draft",
    parentRecordId: chapter.id,
    draftId: chapter.draftId,
  });
  await db.weaveBeat.update({ where: { id: beat.id }, data: { manuscriptRecordId: sceneId } });
  if (beat.body.trim()) await upsertSynopsis(db, projectId, sceneId, beat.body);
  for (const ref of beat.worldRefs) {
    if (ref.record.trashedAt) continue;
    if (!isRecordType(ref.record.type) || !isLinkableReferenceType(ref.record.type)) continue;
    try {
      await linkReference(db, projectId, sceneId, ref.recordId);
    } catch (error) {
      if (error instanceof MutationRejectedError && error.issues.some((issue) => issue.message.includes("already linked"))) {
        continue;
      }
      throw error;
    }
  }
  await writeAudit(db, {
    projectId,
    action: "weave_beat.create_scene",
    actor: UI_ACTOR,
    summary: `Created scene “${title}” from a Weave beat`,
    details: { beatId: beat.id, sceneId, chapterId: chapter.id },
  });
  const grid = await getWeaveGrid(db, projectId, beat.gridId);
  const view = grid.beats.find((row) => row.id === beat.id);
  if (!view) throw new NotFoundError(`Weave beat ${beatId} not found`);
  return view;
}
