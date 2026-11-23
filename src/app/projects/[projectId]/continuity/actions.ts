"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db";
import {
  clearContinuitySuppression,
  suppressContinuityIssue,
  type ContinuitySuppressReason,
} from "@/server/services/continuityService";
import { reviewManuscriptContradictions } from "@/server/services/worldContradictionService";

export async function suppressContinuityAction(
  projectId: string,
  issueKey: string,
  reason: ContinuitySuppressReason,
  note?: string,
): Promise<{ ok: boolean; message?: string }> {
  try {
    await suppressContinuityIssue(getDb(), projectId, { issueKey, reason, note });
    revalidatePath(`/projects/${projectId}/continuity`);
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not update the ledger." };
  }
}

export async function clearContinuitySuppressionAction(
  projectId: string,
  issueKey: string,
): Promise<{ ok: boolean; message?: string }> {
  try {
    await clearContinuitySuppression(getDb(), projectId, issueKey);
    revalidatePath(`/projects/${projectId}/continuity`);
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not restore the issue." };
  }
}

export async function reviewWorldContradictionsAction(
  projectId: string,
  recordId: string,
): Promise<{ ok: boolean; message?: string; count?: number }> {
  try {
    const result = await reviewManuscriptContradictions(getDb(), projectId, recordId, { persist: true });
    revalidatePath(`/projects/${projectId}/continuity`);
    revalidatePath(`/projects/${projectId}/records/${recordId}`);
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true, count: result.persisted.length };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not review world facts." };
  }
}
