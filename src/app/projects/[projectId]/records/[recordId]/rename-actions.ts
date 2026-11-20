"use server";

import { revalidatePath } from "next/cache";
import { errorIssue, type Issue } from "@/domain/issues";
import { getDb } from "@/server/db";
import { readWriteDraftCookie, resolveWriteDraftId } from "@/server/draftSelection";
import { listManuscriptDrafts } from "@/server/services/draftService";
import { MutationRejectedError } from "@/server/services/errors";
import { applyRecordRename, previewRecordRename, type RecordRenamePreview } from "@/server/services/recordRenameService";

export interface RenameResult {
  ok: boolean;
  message?: string;
  preview?: RecordRenamePreview;
  issues?: Issue[];
}

function failure(error: unknown): RenameResult {
  if (error instanceof MutationRejectedError) return { ok: false, issues: error.issues };
  return { ok: false, issues: [errorIssue("INVALID_CHANGE", (error as Error).message)] };
}

async function draftScope(projectId: string) {
  const db = getDb();
  const drafts = await listManuscriptDrafts(db, projectId);
  const hasDrafts = drafts.length > 0;
  const draftId = resolveWriteDraftId(drafts, await readWriteDraftCookie());
  return { hasDrafts, draftId };
}

function parseAliases(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function previewRecordRenameAction(
  projectId: string,
  recordId: string,
  _prev: RenameResult,
  formData: FormData,
): Promise<RenameResult> {
  const newTitle = String(formData.get("newTitle") ?? "").trim();
  const newName = String(formData.get("newName") ?? "").trim();
  const newAliases = parseAliases(String(formData.get("newAliases") ?? ""));
  const { hasDrafts, draftId } = await draftScope(projectId);
  try {
    const preview = await previewRecordRename(getDb(), {
      projectId,
      recordId,
      newTitle,
      newName,
      newAliases,
      hasDrafts,
      draftId,
    });
    return { ok: true, preview };
  } catch (error) {
    return failure(error);
  }
}

export async function applyRecordRenameAction(
  projectId: string,
  recordId: string,
  _prev: RenameResult,
  formData: FormData,
): Promise<RenameResult> {
  const newTitle = String(formData.get("newTitle") ?? "").trim();
  const newName = String(formData.get("newName") ?? "").trim();
  const newAliases = parseAliases(String(formData.get("newAliases") ?? ""));
  const recordRevision = Number(String(formData.get("recordRevision") ?? "0"));
  const selectedMatchIds = formData.getAll("matchId").map(String);
  const unlockProtected = formData.get("unlockProtected") === "on";
  const recordRevisions: Record<string, number> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("rev_")) recordRevisions[key.slice(4)] = Number(String(value));
  }
  const { hasDrafts, draftId } = await draftScope(projectId);
  try {
    const batch = await applyRecordRename(getDb(), {
      projectId,
      recordId,
      newTitle,
      newName,
      newAliases,
      selectedMatchIds,
      recordRevision,
      recordRevisions,
      unlockProtected,
      hasDrafts,
      draftId,
    });
    revalidatePath(`/projects/${projectId}`, "layout");
    const n = batch.outcomes.length;
    return {
      ok: true,
      message: `Renamed across ${n} record${n === 1 ? "" : "s"} in one step.`,
    };
  } catch (error) {
    return failure(error);
  }
}