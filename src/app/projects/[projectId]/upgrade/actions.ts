"use server";

import { revalidatePath } from "next/cache";
import { errorIssue, type Issue } from "@/domain/issues";
import { getDb } from "@/server/db";
import {
  applyAssignments,
  previewAssignments,
  type ApplyAssignmentsResult,
  type AssignmentPlan,
  type AssignmentPreview,
  type AssignmentProposal,
} from "@/server/services/assignmentService";
import { MutationRejectedError } from "@/server/services/errors";

function failure(error: unknown): { ok: false; issues: Issue[] } {
  if (error instanceof MutationRejectedError) return { ok: false, issues: error.issues };
  return { ok: false, issues: [errorIssue("INVALID_CHANGE", (error as Error).message)] };
}

export async function previewAssignmentsAction(
  projectId: string,
  proposal: AssignmentProposal,
): Promise<{ ok: true; preview: AssignmentPreview } | { ok: false; issues: Issue[] }> {
  try {
    const preview = await previewAssignments(getDb(), projectId, proposal);
    return { ok: true, preview };
  } catch (error) {
    return failure(error);
  }
}

export async function applyAssignmentsAction(
  projectId: string,
  input: { plan: AssignmentPlan; previewToken: string },
): Promise<ApplyAssignmentsResult | { status: "failed"; issues: Issue[] }> {
  try {
    const result = await applyAssignments(getDb(), projectId, input);
    if (result.status === "applied") {
      revalidatePath(`/projects/${projectId}`, "layout");
    }
    return result;
  } catch (error) {
    const failed = failure(error);
    return { status: "failed", issues: failed.issues };
  }
}
