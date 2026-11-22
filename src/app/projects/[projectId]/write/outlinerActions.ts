"use server";

import { revalidatePath } from "next/cache";
import { errorIssue, type Issue } from "@/domain/issues";
import type { JsonObject } from "@/domain/json";
import { getDb } from "@/server/db";
import { MutationRejectedError } from "@/server/services/errors";
import { getRecord, updateRecord } from "@/server/services/recordService";
import {
  isManuscriptSceneStatus,
  withManuscriptMeta,
  type ManuscriptSceneStatus,
} from "@/writing/manuscriptStructure";

export interface OutlinerFormResult {
  ok: boolean;
  message?: string;
  revision?: number;
  issues?: Issue[];
}

function failure(error: unknown): OutlinerFormResult {
  if (error instanceof MutationRejectedError) return { ok: false, issues: error.issues };
  return { ok: false, issues: [errorIssue("INVALID_CHANGE", (error as Error).message)] };
}

/** Saves POV and/or scene status on an unlocked record. Protected rows stay read-only here. */
export async function saveOutlinerMetaAction(
  projectId: string,
  recordId: string,
  input: { expectedRevision: number; pov?: string; sceneStatus?: string },
): Promise<OutlinerFormResult> {
  try {
    const db = getDb();
    const existing = await getRecord(db, projectId, recordId);
    if (existing.protected) {
      return {
        ok: false,
        issues: [
          errorIssue(
            "PROTECTED_RECORD",
            "This record is protected. Open it and enable editing before changing point of view or draft status.",
            { recordId },
          ),
        ],
      };
    }
    const patch: { pov?: string; sceneStatus?: ManuscriptSceneStatus | "" } = {};
    if (input.pov !== undefined) patch.pov = input.pov;
    if (input.sceneStatus !== undefined) {
      if (input.sceneStatus === "" || !input.sceneStatus) patch.sceneStatus = "";
      else if (isManuscriptSceneStatus(input.sceneStatus)) patch.sceneStatus = input.sceneStatus;
      else patch.sceneStatus = "";
    }
    const fields = withManuscriptMeta(existing.fields, patch) as JsonObject;
    const batch = await updateRecord(db, projectId, {
      recordId,
      expectedRevision: input.expectedRevision,
      fields,
    });
    const revision = batch.outcomes[0]?.newRevision;
    revalidatePath(`/projects/${projectId}/write`);
    revalidatePath(`/projects/${projectId}/records/${recordId}`);
    return { ok: true, message: "Saved.", revision };
  } catch (error) {
    return failure(error);
  }
}
