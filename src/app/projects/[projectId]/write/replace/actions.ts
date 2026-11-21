"use server";

import { revalidatePath } from "next/cache";
import { errorIssue, type Issue } from "@/domain/issues";
import { getDb } from "@/server/db";
import { readWriteDraftCookie, resolveWriteDraftId } from "@/server/draftSelection";
import { listManuscriptDrafts } from "@/server/services/draftService";
import { applyManuscriptReplace } from "@/server/services/manuscriptReplaceService";
import { MutationRejectedError } from "@/server/services/errors";

export interface ReplaceFormResult {
  ok: boolean;
  message?: string;
  issues?: Issue[];
}

function failure(error: unknown): ReplaceFormResult {
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

export async function applyManuscriptReplaceAction(
  projectId: string,
  _prev: ReplaceFormResult,
  formData: FormData,
): Promise<ReplaceFormResult> {
  const find = String(formData.get("find") ?? "");
  const replace = String(formData.get("replace") ?? "");
  const matchCase = formData.get("matchCase") === "on";
  const wholeWord = formData.get("wholeWord") === "on";
  const regex = formData.get("regex") === "on";
  const unlockProtected = formData.get("unlockProtected") === "on";
  const selectedMatchIds = formData.getAll("matchId").map(String);
  const recordRevisions: Record<string, number> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("rev_")) recordRevisions[key.slice(4)] = Number(String(value));
  }
  const { hasDrafts, draftId } = await draftScope(projectId);
  try {
    const batch = await applyManuscriptReplace(getDb(), {
      projectId,
      find,
      replace,
      matchCase,
      wholeWord,
      regex,
      selectedMatchIds,
      recordRevisions,
      unlockProtected,
      hasDrafts,
      draftId,
    });
    revalidatePath(`/projects/${projectId}`, "layout");
    const n = batch.outcomes.length;
    return {
      ok: true,
      message: `Saved ${n} record${n === 1 ? "" : "s"} with your replacements in one step.`,
    };
  } catch (error) {
    return failure(error);
  }
}