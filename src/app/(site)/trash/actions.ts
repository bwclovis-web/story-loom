"use server";

import path from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ConfirmResult } from "@/components/ConfirmAction";
import { errorIssue } from "@/domain/issues";
import { getDb } from "@/server/db";
import { databaseFilePath } from "@/server/dbLocation";
import { MutationRejectedError, NotFoundError } from "@/server/services/errors";
import { restoreRecordsFromTrash } from "@/server/services/recordService";
import { deleteFromTrash, restoreProject, restoreWorkspace, type DeleteTarget } from "@/server/services/trashService";

const ACTOR = "author";

function failure(error: unknown): ConfirmResult {
  if (error instanceof MutationRejectedError) return { ok: false, issues: error.issues };
  if (error instanceof NotFoundError) return { ok: false, message: error.message };
  throw error;
}

async function run(fn: () => Promise<unknown>): Promise<ConfirmResult> {
  try {
    await fn();
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function restoreRecordsAction(projectId: string, batchId: string): Promise<ConfirmResult> {
  return run(() => restoreRecordsFromTrash(getDb(), projectId, batchId));
}

export async function restoreProjectAction(projectId: string): Promise<ConfirmResult> {
  return run(() => restoreProject(getDb(), { projectId, actor: ACTOR }));
}

export async function restoreWorkspaceAction(workspaceId: string): Promise<ConfirmResult> {
  return run(() => restoreWorkspace(getDb(), { workspaceId, actor: ACTOR }));
}

/** Backs up the whole database, deletes, then reports the counts and backup folder on the Trash page. */
async function deletePermanently(target: DeleteTarget): Promise<ConfirmResult> {
  const outcome = await deleteFromTrash(getDb(), target, { databaseFile: databaseFilePath(), actor: ACTOR });
  if (!outcome.ok) return { ok: false, issues: outcome.issues.length ? outcome.issues : [errorIssue("DELETE_BLOCKED", "Nothing was deleted.")] };
  revalidatePath("/", "layout");
  const { workspaces, projects, records } = outcome.deleted;
  const query = new URLSearchParams({
    workspaces: String(workspaces),
    projects: String(projects),
    records: String(records),
    backup: path.basename(outcome.backupDir),
  });
  redirect(`/trash?${query}`);
}

export async function deleteRecordsAction(projectId: string, batchId: string): Promise<ConfirmResult> {
  return deletePermanently({ kind: "records", projectId, batchId });
}

export async function deleteProjectAction(projectId: string): Promise<ConfirmResult> {
  return deletePermanently({ kind: "project", projectId });
}

export async function deleteWorkspaceAction(workspaceId: string): Promise<ConfirmResult> {
  return deletePermanently({ kind: "workspace", workspaceId });
}

export async function emptyTrashAction(): Promise<ConfirmResult> {
  return deletePermanently({ kind: "all" });
}
