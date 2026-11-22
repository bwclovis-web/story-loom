import "server-only";
import { errorIssue } from "@/domain/issues";
import type { Db } from "../db";
import { writeAudit } from "./auditService";
import { MutationRejectedError, NotFoundError } from "./errors";
import { LIVE_RECORD } from "./trashFilters";

const MAX_LABEL = 120;

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
  const trimmed = input.label?.trim() || null;
  if (trimmed && trimmed.length > MAX_LABEL) {
    throw new MutationRejectedError([
      errorIssue("INVALID_CHANGE", `Snapshot names can be at most ${MAX_LABEL} characters.`),
    ]);
  }
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
