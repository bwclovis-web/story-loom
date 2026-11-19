"use server";

import { revalidatePath } from "next/cache";
import type { Issue } from "@/domain/issues";
import { errorIssue } from "@/domain/issues";
import { getDb } from "@/server/db";
import { MutationRejectedError } from "@/server/services/errors";
import { loadReferenceInspector, type LoadedInspector } from "@/server/services/referenceInspectorService";
import { applyReviewedTemplate } from "@/server/services/referenceTemplateService";
import { WORLD } from "@/ui/labels";

function failure(error: unknown): { ok: false; issues: Issue[] } {
  if (error instanceof MutationRejectedError) return { ok: false, issues: error.issues };
  return { ok: false, issues: [errorIssue("INVALID_CHANGE", (error as Error).message)] };
}

export async function inspectReferenceAction(projectId: string, recordId: string): Promise<LoadedInspector> {
  return loadReferenceInspector(getDb(), projectId, recordId);
}

export async function applyOutlineAction(
  projectId: string,
  recordId: string,
  input: { templateKey: string; expectedRevision: number; unlockProtected: boolean },
): Promise<{ ok: true; applied: boolean; revision: number; message: string } | { ok: false; issues: Issue[] }> {
  try {
    const result = await applyReviewedTemplate(getDb(), projectId, {
      recordId,
      templateKey: input.templateKey,
      expectedRevision: input.expectedRevision,
      unlockProtected: input.unlockProtected,
    });
    revalidatePath(`/projects/${projectId}`, "layout");
    return {
      ok: true,
      applied: result.applied,
      revision: result.revision,
      message: result.applied ? WORLD.outlineApplied(result.revision) : WORLD.outlineNoChange,
    };
  } catch (error) {
    return failure(error);
  }
}
