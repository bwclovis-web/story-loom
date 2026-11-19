import { errorIssue } from "@/domain/issues";
import { isWorldType } from "@/ui/world";
import {
  isReferenceTemplateKey,
  referenceTemplate,
  reviewTemplateMapping,
  type TemplateMapping,
} from "@/world/referenceTemplates";
import type { Db } from "../db";
import { MutationRejectedError } from "./errors";
import { getRecord, updateRecord } from "./recordService";

/*
 * Applies a reviewed World outline. The saved body is only extended with
 * missing headings. Title, structured fields, canon status, and protection
 * are not changed here. Protected records still need an explicit unlock.
 */

function rejected(message: string, recordId?: string): MutationRejectedError {
  return new MutationRejectedError([errorIssue("INVALID_REFERENCE", message, recordId ? { recordId } : {})]);
}

export async function applyReviewedTemplate(
  db: Db,
  projectId: string,
  input: { recordId: string; templateKey: string; expectedRevision: number; unlockProtected?: boolean },
): Promise<{ applied: boolean; revision: number; mapping: TemplateMapping }> {
  if (!isReferenceTemplateKey(input.templateKey)) throw rejected("That outline is not one of the original templates.");
  const record = await getRecord(db, projectId, input.recordId);
  if (!isWorldType(record.type)) {
    throw rejected("Original outlines are for World references. This record keeps its own text.", record.id);
  }
  const mapping = reviewTemplateMapping(referenceTemplate(input.templateKey), record.body, Object.keys(record.fields));
  if (!mapping.changesBody) return { applied: false, revision: record.currentRevision, mapping };
  const batch = await updateRecord(db, projectId, {
    recordId: record.id,
    expectedRevision: input.expectedRevision,
    body: mapping.proposedBody,
    unlockProtected: input.unlockProtected,
  });
  return { applied: true, revision: batch.outcomes[0]!.newRevision, mapping };
}
