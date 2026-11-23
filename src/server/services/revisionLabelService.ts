import "server-only";
import { errorIssue } from "@/domain/issues";
import type { JsonObject } from "@/domain/json";
import { snapshotHash, snapshotOf } from "@/domain/records";
import type { AuthorityStatus } from "@/domain/statuses";
import type { Db } from "../db";
import { writeAudit } from "./auditService";
import { MutationRejectedError, NotFoundError, StaleRevisionError } from "./errors";
import { getRecord, updateRecord } from "./recordService";
import { LIVE_RECORD } from "./trashFilters";

const MAX_LABEL = 120;

function requireLabel(label: string | null | undefined, { allowEmpty }: { allowEmpty: boolean }): string | null {
  const trimmed = label?.trim() || null;
  if (!trimmed) {
    if (allowEmpty) return null;
    throw new MutationRejectedError([errorIssue("INVALID_CHANGE", "Snapshot name is required.")]);
  }
  if (trimmed.length > MAX_LABEL) {
    throw new MutationRejectedError([
      errorIssue("INVALID_CHANGE", `Snapshot names can be at most ${MAX_LABEL} characters.`),
    ]);
  }
  return trimmed;
}

/**
 * Sets or clears a snapshot name on an existing revision. Never rewrites
 * title, body, or fields. Audited as record.revision_label.
 */
export async function labelRevision(
  db: Db,
  projectId: string,
  input: { recordId: string; revisionNumber: number; label: string | null },
): Promise<{ label: string | null }> {
  const record = await db.record.findFirst({
    where: { id: input.recordId, projectId, ...LIVE_RECORD },
    select: { id: true, title: true },
  });
  if (!record) throw new NotFoundError(`Record ${input.recordId} not found`);
  const revision = await db.revision.findUnique({
    where: {
      recordId_revisionNumber: { recordId: input.recordId, revisionNumber: input.revisionNumber },
    },
    select: { id: true, revisionNumber: true },
  });
  if (!revision) {
    throw new MutationRejectedError([
      errorIssue("STALE_REVISION", `Revision ${input.revisionNumber} was not found on this record.`),
    ]);
  }
  const trimmed = requireLabel(input.label, { allowEmpty: true });
  await db.$transaction(async (tx) => {
    await tx.revision.update({
      where: { id: revision.id },
      data: { label: trimmed },
    });
    await writeAudit(tx, {
      projectId,
      action: "record.revision_label",
      actor: "author",
      summary: trimmed
        ? `Named revision ${revision.revisionNumber} of "${record.title}" as “${trimmed}”`
        : `Cleared snapshot name on revision ${revision.revisionNumber} of "${record.title}"`,
      details: { recordId: record.id, revisionNumber: revision.revisionNumber, label: trimmed },
    });
  });
  return { label: trimmed };
}

/**
 * Names the current tip as a snapshot. When title/body/fields differ from the
 * tip, saves a new revision first (same gates as updateRecord), then labels it.
 * When the tip already matches, only the label is written. Never clears a label.
 */
export async function takeNamedSnapshot(
  db: Db,
  projectId: string,
  input: {
    recordId: string;
    expectedRevision: number;
    title: string;
    body: string;
    fields: JsonObject;
    authorityStatus?: AuthorityStatus;
    unlockProtected?: boolean;
    label: string;
  },
): Promise<{ revision: number; label: string; createdRevision: boolean }> {
  const label = requireLabel(input.label, { allowEmpty: false })!;
  const record = await getRecord(db, projectId, input.recordId);
  if (record.currentRevision !== input.expectedRevision) {
    throw new StaleRevisionError(
      errorIssue("STALE_REVISION", `Expected revision ${input.expectedRevision}, found ${record.currentRevision}.`, {
        recordId: record.id,
      }),
    );
  }

  const before = snapshotOf(record);
  const after = {
    ...before,
    title: input.title,
    body: input.body,
    fields: input.fields,
    authorityStatus: input.authorityStatus ?? before.authorityStatus,
  };

  let revision = record.currentRevision;
  let createdRevision = false;
  if (snapshotHash(before) !== snapshotHash(after)) {
    const batch = await updateRecord(db, projectId, {
      recordId: input.recordId,
      expectedRevision: input.expectedRevision,
      title: input.title,
      body: input.body,
      fields: input.fields,
      authorityStatus: input.authorityStatus,
      unlockProtected: input.unlockProtected,
    });
    revision = batch.outcomes[0].newRevision;
    createdRevision = true;
  }

  await labelRevision(db, projectId, {
    recordId: input.recordId,
    revisionNumber: revision,
    label,
  });
  return { revision, label, createdRevision };
}
