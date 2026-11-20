"use server";

import { revalidatePath } from "next/cache";
import { errorIssue, type Issue } from "@/domain/issues";
import { getDb } from "@/server/db";
import { MutationRejectedError } from "@/server/services/errors";
import {
  clearChapterWritingGoal,
  clearProjectWritingGoal,
  upsertChapterWritingGoal,
  upsertProjectWritingGoal,
} from "@/server/services/writingGoalService";

export interface GoalFormResult {
  ok: boolean;
  message?: string;
  issues?: Issue[];
}

function failure(error: unknown): GoalFormResult {
  if (error instanceof MutationRejectedError) return { ok: false, issues: error.issues };
  return { ok: false, issues: [errorIssue("INVALID_CHANGE", (error as Error).message)] };
}

export async function saveProjectGoalAction(
  projectId: string,
  _prev: GoalFormResult,
  formData: FormData,
): Promise<GoalFormResult> {
  const targetWords = Number(String(formData.get("targetWords") ?? ""));
  const deadlineAt = String(formData.get("deadlineAt") ?? "");
  try {
    await upsertProjectWritingGoal(getDb(), projectId, {
      targetWords,
      deadlineAt: deadlineAt.trim() || null,
    });
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true, message: "Book target saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function clearProjectGoalAction(projectId: string): Promise<GoalFormResult> {
  try {
    await clearProjectWritingGoal(getDb(), projectId);
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true, message: "Book target cleared." };
  } catch (error) {
    return failure(error);
  }
}

export async function saveChapterGoalAction(
  projectId: string,
  _prev: GoalFormResult,
  formData: FormData,
): Promise<GoalFormResult> {
  const recordId = String(formData.get("recordId") ?? "");
  const targetWords = Number(String(formData.get("targetWords") ?? ""));
  try {
    await upsertChapterWritingGoal(getDb(), projectId, recordId, targetWords);
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true, message: "Chapter target saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function clearChapterGoalAction(projectId: string, recordId: string): Promise<GoalFormResult> {
  try {
    await clearChapterWritingGoal(getDb(), projectId, recordId);
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true, message: "Chapter target cleared." };
  } catch (error) {
    return failure(error);
  }
}