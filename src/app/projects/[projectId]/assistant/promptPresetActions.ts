"use server";

import { revalidatePath } from "next/cache";
import type { PromptPresetSurface } from "@/domain/promptPreset";
import { errorIssue, type Issue } from "@/domain/issues";
import { getDb } from "@/server/db";
import { MutationRejectedError, NotFoundError } from "@/server/services/errors";
import {
  createPromptPreset,
  deletePromptPreset,
  listPromptPresets,
  updatePromptPreset,
  type PromptPresetView,
} from "@/server/services/promptPresetService";

export interface PromptPresetActionResult {
  ok: boolean;
  message?: string;
  issues?: Issue[];
}

function failure(error: unknown): PromptPresetActionResult {
  if (error instanceof MutationRejectedError) return { ok: false, issues: error.issues };
  if (error instanceof NotFoundError) return { ok: false, issues: [errorIssue("RECORD_NOT_FOUND", error.message)] };
  return { ok: false, issues: [errorIssue("INVALID_CHANGE", (error as Error).message)] };
}

function revalidate(projectId: string) {
  revalidatePath(`/projects/${projectId}/assistant`);
  revalidatePath(`/projects/${projectId}/records`, "layout");
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function listPromptPresetsAction(projectId: string): Promise<PromptPresetView[]> {
  return listPromptPresets(getDb(), projectId);
}

export async function createPromptPresetAction(
  projectId: string,
  input: { title: string; surface: PromptPresetSurface; instructionText: string },
): Promise<PromptPresetActionResult & { presetId?: string }> {
  try {
    const created = await createPromptPreset(getDb(), projectId, input);
    revalidate(projectId);
    return { ok: true, message: "Preset saved.", presetId: created.id };
  } catch (error) {
    return failure(error);
  }
}

export async function updatePromptPresetAction(
  projectId: string,
  presetId: string,
  input: { title?: string; surface?: PromptPresetSurface; instructionText?: string },
): Promise<PromptPresetActionResult> {
  try {
    await updatePromptPreset(getDb(), projectId, presetId, input);
    revalidate(projectId);
    return { ok: true, message: "Preset updated." };
  } catch (error) {
    return failure(error);
  }
}

export async function deletePromptPresetAction(projectId: string, presetId: string): Promise<PromptPresetActionResult> {
  try {
    await deletePromptPreset(getDb(), projectId, presetId);
    revalidate(projectId);
    return { ok: true, message: "Preset deleted." };
  } catch (error) {
    return failure(error);
  }
}