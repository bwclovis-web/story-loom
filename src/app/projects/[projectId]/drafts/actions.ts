"use server";

import { revalidatePath } from "next/cache";
import { errorIssue, type Issue } from "@/domain/issues";
import { getDb } from "@/server/db";
import {
  attachRewriteSource,
  detachRewriteSource,
  getRewriteSourcePreview,
  setDefaultExportDraft,
  setDefaultReadingDraft,
  setDraftCompletion,
  startAuthorRewrite,
  type StartAuthorRewriteResult,
} from "@/server/services/draftService";
import { MutationRejectedError, NotFoundError } from "@/server/services/errors";

function failure(error: unknown): { ok: false; issues: Issue[] } {
  if (error instanceof MutationRejectedError) return { ok: false, issues: error.issues };
  if (error instanceof NotFoundError) return { ok: false, issues: [errorIssue("RECORD_NOT_FOUND", error.message)] };
  return { ok: false, issues: [errorIssue("INVALID_CHANGE", (error as Error).message)] };
}

export type StartRewriteActionResult =
  | { ok: true; result: StartAuthorRewriteResult }
  | { ok: false; issues: Issue[] };

export async function startAuthorRewriteAction(projectId: string): Promise<StartRewriteActionResult> {
  try {
    const result = await startAuthorRewrite(getDb(), projectId);
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true, result };
  } catch (error) {
    return failure(error);
  }
}

export type DraftActionResult = { ok: true } | { ok: false; issues: Issue[] };

export async function setDraftCompletionAction(
  projectId: string,
  draftId: string,
  completed: boolean,
): Promise<DraftActionResult> {
  try {
    await setDraftCompletion(getDb(), projectId, draftId, completed);
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function setDefaultReadingDraftAction(
  projectId: string,
  draftId: string | null,
): Promise<DraftActionResult> {
  try {
    await setDefaultReadingDraft(getDb(), projectId, draftId);
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function setDefaultExportDraftAction(
  projectId: string,
  draftId: string | null,
): Promise<DraftActionResult> {
  try {
    await setDefaultExportDraft(getDb(), projectId, draftId);
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function attachRewriteSourceAction(
  projectId: string,
  fromRecordId: string,
  toRecordId: string,
): Promise<DraftActionResult> {
  try {
    await attachRewriteSource(getDb(), projectId, fromRecordId, toRecordId);
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function detachRewriteSourceAction(
  projectId: string,
  fromRecordId: string,
  toRecordId: string,
): Promise<DraftActionResult> {
  try {
    await detachRewriteSource(getDb(), projectId, fromRecordId, toRecordId);
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export type SourcePreviewResult =
  | { ok: true; title: string; body: string; revisionNumber: number; currentRevision: number }
  | { ok: false; issues: Issue[] };

export async function previewRewriteSourceAction(
  projectId: string,
  toRecordId: string,
  toRevisionNumber: number,
): Promise<SourcePreviewResult> {
  try {
    const preview = await getRewriteSourcePreview(getDb(), projectId, toRecordId, toRevisionNumber);
    if (!preview) return { ok: false, issues: [errorIssue("RECORD_NOT_FOUND", "That source revision was not found.")] };
    return { ok: true, ...preview };
  } catch (error) {
    return failure(error);
  }
}
