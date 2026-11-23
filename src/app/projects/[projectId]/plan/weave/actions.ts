"use server";

import { revalidatePath } from "next/cache";
import { errorIssue, type Issue } from "@/domain/issues";
import { getDb } from "@/server/db";
import { MutationRejectedError, NotFoundError } from "@/server/services/errors";
import {
  addWeaveBeat,
  addWeaveBeatWorldRef,
  addWeaveSetupPayoff,
  addWeaveThread,
  applyWeaveTemplate,
  createWeaveGrid,
  createWeaveTemplate,
  deleteWeaveGrid,
  deleteWeaveTemplate,
  deleteWeaveThread,
  isWeaveDecision,
  isWeaveLayoutMode,
  isWeaveViewKind,
  moveWeaveBeat,
  placeWeaveBeat,
  relocateWeaveBeat,
  removeWeaveBeat,
  removeWeaveBeatWorldRef,
  removeWeaveSetupPayoff,
  removeWeaveTemplateBeat,
  renameWeaveGrid,
  renameWeaveThread,
  reorderWeaveThreads,
  saveWeaveGridAsTemplate,
  setWeaveLayoutMode,
  updateWeaveBeat,
  updateWeaveTemplate,
  upsertWeaveTemplateBeat,
  type WeaveLayoutMode,
  type WeaveViewKind,
} from "@/server/services/weaveService";
import {
  createSceneFromWeaveBeat,
  importWeavePresetAsTemplate,
  instantiateWeavePresetGrid,
} from "@/server/services/weavePresetService";
import {
  addIdeaToWeaveStage,
  addWeavePlanningRow,
  adoptWeaveStructures,
  applyWeavePlanChapterMappings,
  createCustomWeaveStructure,
  forkIdeaOnWeaveStage,
  isWeaveSurface,
  placeIdeaOnPlanningRow,
  previewRemoveWeaveStructure,
  removeWeaveStructure,
  renameWeavePlanningRow,
  reorderWeavePlanningRows,
  setWeaveIdeaManuscriptPlacements,
  setWeavePreferredSurface,
  unlinkIdeaFromWeaveStage,
  updateWeaveIdeaText,
  updateWeaveStageNotes,
  type WeavePlanChapterOp,
} from "@/server/services/weaveStructureService";
import {
  applyWeaveBuild,
  getWeaveBuildRun,
  saveWeaveBuildDecisions,
  type WeaveBuildDecisions,
} from "@/server/services/weaveBuildFromDraftService";
import { listRewriteSources } from "@/server/services/draftService";

function failure(error: unknown): { ok: false; issues: Issue[] } {
  if (error instanceof MutationRejectedError) return { ok: false, issues: error.issues };
  if (error instanceof NotFoundError) return { ok: false, issues: [errorIssue("RECORD_NOT_FOUND", error.message)] };
  return { ok: false, issues: [errorIssue("INVALID_CHANGE", (error as Error).message)] };
}

function revalidateWeave(projectId: string, gridId?: string) {
  revalidatePath(`/projects/${projectId}/plan`);
  revalidatePath(`/projects/${projectId}/plan/weave`);
  revalidatePath(`/projects/${projectId}/plan/weave/templates`);
  if (gridId) revalidatePath(`/projects/${projectId}/plan/weave/${gridId}`);
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function createWeaveGridAction(
  projectId: string,
  input: { title: string; viewKind: string },
): Promise<{ ok: true; gridId: string } | { ok: false; issues: Issue[] }> {
  try {
    if (!isWeaveViewKind(input.viewKind)) {
      return { ok: false, issues: [errorIssue("INVALID_REFERENCE", "Unknown Weave view.")] };
    }
    const grid = await createWeaveGrid(getDb(), projectId, {
      title: input.title,
      viewKind: input.viewKind as WeaveViewKind,
    });
    revalidateWeave(projectId, grid.id);
    return { ok: true, gridId: grid.id };
  } catch (error) {
    return failure(error);
  }
}

export async function renameWeaveGridAction(projectId: string, gridId: string, title: string) {
  try {
    await renameWeaveGrid(getDb(), projectId, gridId, title);
    revalidateWeave(projectId, gridId);
    return { ok: true as const };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteWeaveGridAction(projectId: string, gridId: string) {
  try {
    await deleteWeaveGrid(getDb(), projectId, gridId);
    revalidateWeave(projectId);
    return { ok: true as const };
  } catch (error) {
    return failure(error);
  }
}

export async function addWeaveBeatAction(
  projectId: string,
  gridId: string,
  input: {
    title: string;
    body?: string;
    decision?: string;
    manuscriptRecordId?: string | null;
    threadId?: string | null;
    cellOrder?: number;
    x: number;
    y: number;
  },
) {
  try {
    if (input.decision && !isWeaveDecision(input.decision)) {
      return { ok: false as const, issues: [errorIssue("INVALID_REFERENCE", "Unknown Weave decision.")] };
    }
    const beat = await addWeaveBeat(getDb(), projectId, gridId, input);
    revalidateWeave(projectId, gridId);
    return { ok: true as const, beat };
  } catch (error) {
    return failure(error);
  }
}

export async function setWeaveLayoutModeAction(projectId: string, gridId: string, layoutMode: string) {
  try {
    if (!isWeaveLayoutMode(layoutMode)) {
      return { ok: false as const, issues: [errorIssue("INVALID_REFERENCE", "Unknown Weave layout.")] };
    }
    await setWeaveLayoutMode(getDb(), projectId, gridId, layoutMode as WeaveLayoutMode);
    revalidateWeave(projectId, gridId);
    return { ok: true as const };
  } catch (error) {
    return failure(error);
  }
}

export async function addWeaveThreadAction(projectId: string, gridId: string, title: string) {
  try {
    const thread = await addWeaveThread(getDb(), projectId, gridId, { title });
    revalidateWeave(projectId, gridId);
    return { ok: true as const, thread };
  } catch (error) {
    return failure(error);
  }
}

export async function renameWeaveThreadAction(projectId: string, gridId: string, threadId: string, title: string) {
  try {
    const thread = await renameWeaveThread(getDb(), projectId, gridId, threadId, title);
    revalidateWeave(projectId, gridId);
    return { ok: true as const, thread };
  } catch (error) {
    return failure(error);
  }
}

export async function reorderWeaveThreadsAction(projectId: string, gridId: string, orderedThreadIds: string[]) {
  try {
    await reorderWeaveThreads(getDb(), projectId, gridId, orderedThreadIds);
    revalidateWeave(projectId, gridId);
    return { ok: true as const };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteWeaveThreadAction(projectId: string, gridId: string, threadId: string) {
  try {
    await deleteWeaveThread(getDb(), projectId, gridId, threadId);
    revalidateWeave(projectId, gridId);
    return { ok: true as const };
  } catch (error) {
    return failure(error);
  }
}

export async function placeWeaveBeatAction(
  projectId: string,
  gridId: string,
  beatId: string,
  input: { threadId: string | null; manuscriptRecordId?: string | null; cellOrder?: number },
) {
  try {
    const beat = await placeWeaveBeat(getDb(), projectId, gridId, beatId, input);
    revalidateWeave(projectId, gridId);
    return { ok: true as const, beat };
  } catch (error) {
    return failure(error);
  }
}

export async function relocateWeaveBeatAction(
  projectId: string,
  gridId: string,
  beatId: string,
  input: { threadId: string | null; manuscriptRecordId: string | null; cellOrder: number },
) {
  try {
    const beats = await relocateWeaveBeat(getDb(), projectId, gridId, beatId, input);
    revalidateWeave(projectId, gridId);
    return { ok: true as const, beats };
  } catch (error) {
    return failure(error);
  }
}

export async function moveWeaveBeatAction(
  projectId: string,
  gridId: string,
  beatId: string,
  input: { x: number; y: number; width?: number; height?: number; zIndex?: number },
) {
  try {
    const beat = await moveWeaveBeat(getDb(), projectId, gridId, beatId, input);
    revalidateWeave(projectId, gridId);
    return { ok: true as const, beat };
  } catch (error) {
    return failure(error);
  }
}

export async function updateWeaveBeatAction(
  projectId: string,
  gridId: string,
  beatId: string,
  input: {
    title?: string;
    body?: string;
    decision?: string;
    manuscriptRecordId?: string | null;
    threadId?: string | null;
    cellOrder?: number;
  },
) {
  try {
    if (input.decision && input.decision !== "" && !isWeaveDecision(input.decision)) {
      return { ok: false as const, issues: [errorIssue("INVALID_REFERENCE", "Unknown Weave decision.")] };
    }
    const beat = await updateWeaveBeat(getDb(), projectId, gridId, beatId, input);
    revalidateWeave(projectId, gridId);
    return { ok: true as const, beat };
  } catch (error) {
    return failure(error);
  }
}

export async function removeWeaveBeatAction(projectId: string, gridId: string, beatId: string) {
  try {
    await removeWeaveBeat(getDb(), projectId, gridId, beatId);
    revalidateWeave(projectId, gridId);
    return { ok: true as const };
  } catch (error) {
    return failure(error);
  }
}

export async function addWeaveBeatWorldRefAction(projectId: string, gridId: string, beatId: string, recordId: string) {
  try {
    const beat = await addWeaveBeatWorldRef(getDb(), projectId, gridId, beatId, recordId);
    revalidateWeave(projectId, gridId);
    return { ok: true as const, beat };
  } catch (error) {
    return failure(error);
  }
}

export async function removeWeaveBeatWorldRefAction(projectId: string, gridId: string, beatId: string, refId: string) {
  try {
    const beat = await removeWeaveBeatWorldRef(getDb(), projectId, gridId, beatId, refId);
    revalidateWeave(projectId, gridId);
    return { ok: true as const, beat };
  } catch (error) {
    return failure(error);
  }
}

export async function addWeaveSetupPayoffAction(
  projectId: string,
  input: { fromBeatId: string; toBeatId: string; note?: string },
) {
  try {
    const link = await addWeaveSetupPayoff(getDb(), projectId, input);
    revalidateWeave(projectId);
    return { ok: true as const, link };
  } catch (error) {
    return failure(error);
  }
}

export async function removeWeaveSetupPayoffAction(projectId: string, relationId: string) {
  try {
    await removeWeaveSetupPayoff(getDb(), projectId, relationId);
    revalidateWeave(projectId);
    return { ok: true as const };
  } catch (error) {
    return failure(error);
  }
}

export async function createWeaveTemplateAction(projectId: string, input: { title: string; description?: string }) {
  try {
    const template = await createWeaveTemplate(getDb(), projectId, input);
    revalidateWeave(projectId);
    return { ok: true as const, templateId: template.id };
  } catch (error) {
    return failure(error);
  }
}

export async function updateWeaveTemplateAction(
  projectId: string,
  templateId: string,
  input: { title?: string; description?: string },
) {
  try {
    await updateWeaveTemplate(getDb(), projectId, templateId, input);
    revalidateWeave(projectId);
    return { ok: true as const };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteWeaveTemplateAction(projectId: string, templateId: string) {
  try {
    await deleteWeaveTemplate(getDb(), projectId, templateId);
    revalidateWeave(projectId);
    return { ok: true as const };
  } catch (error) {
    return failure(error);
  }
}

export async function upsertWeaveTemplateBeatAction(
  projectId: string,
  templateId: string,
  input: {
    beatId?: string;
    title: string;
    body?: string;
    decision?: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    position?: number;
  },
) {
  try {
    const template = await upsertWeaveTemplateBeat(getDb(), projectId, templateId, input);
    revalidateWeave(projectId);
    return { ok: true as const, template };
  } catch (error) {
    return failure(error);
  }
}

export async function removeWeaveTemplateBeatAction(projectId: string, templateId: string, beatId: string) {
  try {
    const template = await removeWeaveTemplateBeat(getDb(), projectId, templateId, beatId);
    revalidateWeave(projectId);
    return { ok: true as const, template };
  } catch (error) {
    return failure(error);
  }
}

export async function applyWeaveTemplateAction(
  projectId: string,
  templateId: string,
  input: { title?: string; viewKind: string },
) {
  try {
    if (!isWeaveViewKind(input.viewKind)) {
      return { ok: false as const, issues: [errorIssue("INVALID_REFERENCE", "Unknown Weave view.")] };
    }
    const grid = await applyWeaveTemplate(getDb(), projectId, templateId, {
      title: input.title,
      viewKind: input.viewKind as WeaveViewKind,
    });
    revalidateWeave(projectId, grid.id);
    return { ok: true as const, gridId: grid.id };
  } catch (error) {
    return failure(error);
  }
}

export async function saveWeaveGridAsTemplateAction(
  projectId: string,
  gridId: string,
  input: { title: string; description?: string },
) {
  try {
    const template = await saveWeaveGridAsTemplate(getDb(), projectId, gridId, input);
    revalidateWeave(projectId, gridId);
    return { ok: true as const, templateId: template.id };
  } catch (error) {
    return failure(error);
  }
}

export async function saveWeaveBuildDecisionsAction(
  projectId: string,
  runId: string,
  contentHash: string,
  decisions: WeaveBuildDecisions,
) {
  try {
    const run = await saveWeaveBuildDecisions(getDb(), projectId, runId, decisions, contentHash);
    return { ok: true as const, run };
  } catch (error) {
    return failure(error);
  }
}

export async function applyWeaveBuildAction(projectId: string, runId: string, contentHash: string) {
  try {
    const result = await applyWeaveBuild(getDb(), projectId, runId, contentHash);
    revalidateWeave(projectId, result.gridId);
    return { ok: true as const, result };
  } catch (error) {
    return failure(error);
  }
}

export async function getWeaveBuildRunAction(projectId: string, runId: string) {
  try {
    const run = await getWeaveBuildRun(getDb(), projectId, runId);
    return { ok: true as const, run };
  } catch (error) {
    return failure(error);
  }
}

export async function importWeavePresetTemplateAction(projectId: string, presetId: string) {
  try {
    const template = await importWeavePresetAsTemplate(getDb(), projectId, presetId);
    revalidateWeave(projectId);
    return { ok: true as const, templateId: template.id };
  } catch (error) {
    return failure(error);
  }
}

export async function instantiateWeavePresetAction(
  projectId: string,
  presetId: string,
  input: { viewKind: string; title?: string },
) {
  try {
    if (!isWeaveViewKind(input.viewKind)) {
      return { ok: false as const, issues: [errorIssue("INVALID_REFERENCE", "Unknown Weave view.")] };
    }
    const grid = await instantiateWeavePresetGrid(getDb(), projectId, presetId, {
      viewKind: input.viewKind,
      title: input.title,
    });
    revalidateWeave(projectId, grid.id);
    return { ok: true as const, gridId: grid.id };
  } catch (error) {
    return failure(error);
  }
}

export async function createSceneFromWeaveBeatAction(projectId: string, beatId: string, chapterId: string) {
  try {
    const beat = await createSceneFromWeaveBeat(getDb(), projectId, beatId, { chapterId });
    revalidateWeave(projectId, beat.gridId);
    revalidatePath(`/projects/${projectId}/write`);
    return { ok: true as const, beat };
  } catch (error) {
    return failure(error);
  }
}

export async function listManuscriptRewriteSourcesAction(projectId: string, manuscriptRecordId: string) {
  try {
    const sources = await listRewriteSources(getDb(), projectId, manuscriptRecordId);
    return { ok: true as const, sources };
  } catch (error) {
    return failure(error);
  }
}

export async function adoptWeaveStructuresAction(
  projectId: string,
  input: {
    presetIds: string[];
    gridId?: string;
    viewKind?: string;
    title?: string;
    confirmDuplicates?: boolean;
    clientRequestId?: string;
  },
) {
  try {
    if (input.viewKind != null && !isWeaveViewKind(input.viewKind)) {
      return { ok: false as const, issues: [errorIssue("INVALID_REFERENCE", "Unknown Weave view.")] };
    }
    const result = await adoptWeaveStructures(getDb(), projectId, {
      presetIds: input.presetIds,
      gridId: input.gridId,
      viewKind: input.viewKind as WeaveViewKind | undefined,
      title: input.title,
      confirmDuplicates: input.confirmDuplicates,
      clientRequestId: input.clientRequestId,
    });
    if (!result.ok) {
      return {
        ok: false as const,
        needsDuplicateConfirm: true as const,
        duplicates: result.duplicates,
        issues: result.duplicates.map((d) => errorIssue("INVALID_CHANGE", WEAVE_DUP(d.title))),
      };
    }
    revalidateWeave(projectId, result.gridId);
    return {
      ok: true as const,
      gridId: result.gridId,
      structureIds: result.structureIds,
      preferredSurface: result.preferredSurface,
    };
  } catch (error) {
    return failure(error);
  }
}

function WEAVE_DUP(title: string) {
  return `“${title}” is already on this plan. Confirm to adopt another independent copy.`;
}

export async function removeWeaveStructureAction(projectId: string, structureId: string) {
  try {
    const preview = await removeWeaveStructure(getDb(), projectId, structureId);
    revalidateWeave(projectId);
    return { ok: true as const, preview };
  } catch (error) {
    return failure(error);
  }
}

export async function previewRemoveWeaveStructureAction(projectId: string, structureId: string) {
  try {
    const preview = await previewRemoveWeaveStructure(getDb(), projectId, structureId);
    return { ok: true as const, preview };
  } catch (error) {
    return failure(error);
  }
}

export async function setWeavePreferredSurfaceAction(projectId: string, gridId: string, surface: string) {
  try {
    if (!isWeaveSurface(surface)) {
      return { ok: false as const, issues: [errorIssue("INVALID_REFERENCE", "Unknown plan view.")] };
    }
    const next = await setWeavePreferredSurface(getDb(), projectId, gridId, surface);
    revalidateWeave(projectId, gridId);
    return { ok: true as const, surface: next };
  } catch (error) {
    return failure(error);
  }
}

export async function updateWeaveIdeaTextAction(
  projectId: string,
  beatId: string,
  input: { title?: string; body?: string; expectedRevision: number },
) {
  try {
    const idea = await updateWeaveIdeaText(getDb(), projectId, beatId, input);
    revalidateWeave(projectId);
    return { ok: true as const, idea };
  } catch (error) {
    return failure(error);
  }
}

export async function updateWeaveStageNotesAction(
  projectId: string,
  stageId: string,
  input: { notes: string; expectedRevision: number },
) {
  try {
    const stage = await updateWeaveStageNotes(getDb(), projectId, stageId, input);
    revalidateWeave(projectId);
    return { ok: true as const, stage };
  } catch (error) {
    return failure(error);
  }
}

export async function addIdeaToWeaveStageAction(
  projectId: string,
  stageId: string,
  input: { title?: string; body?: string; existingBeatId?: string },
) {
  try {
    const idea = await addIdeaToWeaveStage(getDb(), projectId, stageId, input);
    revalidateWeave(projectId);
    return { ok: true as const, idea };
  } catch (error) {
    return failure(error);
  }
}

export async function unlinkIdeaFromWeaveStageAction(projectId: string, stageId: string, beatId: string) {
  try {
    await unlinkIdeaFromWeaveStage(getDb(), projectId, stageId, beatId);
    revalidateWeave(projectId);
    return { ok: true as const };
  } catch (error) {
    return failure(error);
  }
}

export async function forkIdeaOnWeaveStageAction(projectId: string, stageId: string, beatId: string) {
  try {
    const idea = await forkIdeaOnWeaveStage(getDb(), projectId, stageId, beatId);
    revalidateWeave(projectId);
    return { ok: true as const, idea };
  } catch (error) {
    return failure(error);
  }
}

export async function addWeavePlanningRowAction(
  projectId: string,
  gridId: string,
  input: { title?: string } = {},
) {
  try {
    const row = await addWeavePlanningRow(getDb(), projectId, gridId, input);
    revalidateWeave(projectId, gridId);
    return { ok: true as const, row };
  } catch (error) {
    return failure(error);
  }
}

export async function renameWeavePlanningRowAction(
  projectId: string,
  gridId: string,
  planningRowId: string,
  title: string,
) {
  try {
    const row = await renameWeavePlanningRow(getDb(), projectId, gridId, planningRowId, title);
    revalidateWeave(projectId, gridId);
    return { ok: true as const, row };
  } catch (error) {
    return failure(error);
  }
}

export async function reorderWeavePlanningRowsAction(
  projectId: string,
  gridId: string,
  orderedRowIds: string[],
) {
  try {
    const rows = await reorderWeavePlanningRows(getDb(), projectId, gridId, orderedRowIds);
    revalidateWeave(projectId, gridId);
    return { ok: true as const, rows };
  } catch (error) {
    return failure(error);
  }
}

export async function placeIdeaOnPlanningRowAction(
  projectId: string,
  gridId: string,
  beatId: string,
  input: { planningRowId: string | null; threadId?: string | null; cellOrder?: number },
) {
  try {
    await placeIdeaOnPlanningRow(getDb(), projectId, gridId, beatId, input);
    revalidateWeave(projectId, gridId);
    return { ok: true as const };
  } catch (error) {
    return failure(error);
  }
}

export async function setWeaveIdeaManuscriptPlacementsAction(
  projectId: string,
  beatId: string,
  recordIds: string[],
) {
  try {
    const result = await setWeaveIdeaManuscriptPlacements(getDb(), projectId, beatId, recordIds);
    revalidateWeave(projectId);
    return { ok: true as const, ...result };
  } catch (error) {
    return failure(error);
  }
}

export async function applyWeavePlanChapterMappingsAction(
  projectId: string,
  gridId: string,
  ops: WeavePlanChapterOp[],
) {
  try {
    const result = await applyWeavePlanChapterMappings(getDb(), projectId, gridId, ops);
    revalidateWeave(projectId, gridId);
    revalidatePath(`/projects/${projectId}/write`);
    return { ok: true as const, ...result };
  } catch (error) {
    return failure(error);
  }
}

export async function createCustomWeaveStructureAction(
  projectId: string,
  gridId: string,
  input: {
    title: string;
    attribution?: string;
    description?: string;
    stages: Array<{ title: string; guidance?: string; groupTitle?: string }>;
  },
) {
  try {
    const structure = await createCustomWeaveStructure(getDb(), projectId, gridId, input);
    revalidateWeave(projectId, gridId);
    return { ok: true as const, structure };
  } catch (error) {
    return failure(error);
  }
}
