"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db";
import {
  clearContinuitySuppression,
  suppressContinuityIssue,
  type ContinuitySuppressReason,
} from "@/server/services/continuityService";

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
