"use server";

import { revalidatePath } from "next/cache";
import { isRecordType, type RecordType } from "@/domain/recordTypes";
import { parseJsonObject, type JsonObject } from "@/domain/json";
import { getDb } from "@/server/db";
import { MutationRejectedError, StaleRevisionError } from "@/server/services/errors";
import {
  requireSeriesSharedFromSibling,
  seriesRecordOwningProjectId,
  updateSeriesSharedFromSiblingParsed,
} from "@/server/services/seriesBibleService";
import { errorIssue, type Issue } from "@/domain/issues";
import { sanitizeWorldbuildingFields } from "@/world/worldKinds";
import type { FormResult } from "../../actions";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

function parseFields(text: string, type?: RecordType): JsonObject {
  const fields = text.trim() ? parseJsonObject(text) : {};
  return type === "worldbuilding" ? sanitizeWorldbuildingFields(fields) : fields;
}

function failure(error: unknown): FormResult {
  if (error instanceof MutationRejectedError) return { ok: false, issues: error.issues };
  if (error instanceof StaleRevisionError) return { ok: false, issues: error.issues };
  return { ok: false, issues: [errorIssue("INVALID_CHANGE", (error as Error).message)] };
}

/** Save a series-shared reference from a sibling book; writes go to the home project. */
export async function saveSeriesSharedRecordAction(
  viewingProjectId: string,
  recordId: string,
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  try {
    const db = getDb();
    const shared = await requireSeriesSharedFromSibling(db, viewingProjectId, recordId);
    const type = shared.record.type;
    if (!isRecordType(type)) return { ok: false, message: "Invalid record type" };
    const batch = await updateSeriesSharedFromSiblingParsed(db, viewingProjectId, {
      recordId,
      expectedRevision: Number(str(formData, "expectedRevision")),
      title: str(formData, "title"),
      body: str(formData, "body"),
      fields: parseFields(str(formData, "fields"), type),
      authorityStatus: str(formData, "authorityStatus"),
      unlockProtected: formData.get("unlockProtected") === "on",
    });
    const owningProjectId = seriesRecordOwningProjectId(shared);
    const revision = batch.outcomes[0].newRevision;
    revalidatePath(`/projects/${viewingProjectId}`, "layout");
    revalidatePath(`/projects/${owningProjectId}`, "layout");
    return { ok: true, message: `Saved as revision ${revision} in the home book.`, revision };
  } catch (error) {
    return failure(error);
  }
}