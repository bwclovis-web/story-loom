"use server";

import { revalidatePath } from "next/cache";
import { errorIssue, type Issue } from "@/domain/issues";
import { getDb } from "@/server/db";
import { MutationRejectedError, NotFoundError } from "@/server/services/errors";
import {
  addRecordRelation,
  isRecordRelationKind,
  removeRecordRelation,
  type RecordRelationKind,
} from "@/server/services/recordRelationService";

function failure(error: unknown): { ok: false; issues: Issue[] } {
  if (error instanceof MutationRejectedError) return { ok: false, issues: error.issues };
  if (error instanceof NotFoundError) return { ok: false, issues: [errorIssue("RECORD_NOT_FOUND", error.message)] };
  return { ok: false, issues: [errorIssue("INVALID_CHANGE", (error as Error).message)] };
}

function revalidateRecords(projectId: string, recordIds: string[]) {
  for (const id of recordIds) revalidatePath(`/projects/${projectId}/records/${id}`);
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function addRecordRelationAction(
  projectId: string,
  input: { fromRecordId: string; toRecordId: string; kind: string; customLabel?: string; scope?: string | null },
) {
  try {
    if (!isRecordRelationKind(input.kind)) {
      return { ok: false as const, issues: [errorIssue("INVALID_REFERENCE", "Unknown relationship kind.")] };
    }
    const relation = await addRecordRelation(getDb(), projectId, {
      fromRecordId: input.fromRecordId,
      toRecordId: input.toRecordId,
      kind: input.kind as RecordRelationKind,
      customLabel: input.customLabel,
      scope: input.scope,
    });
    revalidateRecords(projectId, [input.fromRecordId, input.toRecordId]);
    return { ok: true as const, relation };
  } catch (error) {
    return failure(error);
  }
}

export async function removeRecordRelationAction(projectId: string, relationId: string, recordIds: string[]) {
  try {
    await removeRecordRelation(getDb(), projectId, relationId);
    revalidateRecords(projectId, recordIds);
    return { ok: true as const };
  } catch (error) {
    return failure(error);
  }
}