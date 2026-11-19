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
  applyWeaveBuild,
  getWeaveBuildRun,
  saveWeaveBuildDecisions,
  type WeaveBuildDecisions,
} from "@/server/services/weaveBuildFromDraftService";

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
