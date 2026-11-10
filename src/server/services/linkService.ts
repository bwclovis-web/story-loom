import { newId } from "@/domain/ids";
import { errorIssue } from "@/domain/issues";
import { isLinkableReferenceType, isManuscriptType, isRecordType, RECORD_TYPE_LABELS, type RecordType } from "@/domain/recordTypes";
import { isAuthorityStatus, type AuthorityStatus } from "@/domain/statuses";
import { isUniqueConstraintError, type Db, type DbOrTx, type Tx } from "../db";
import { writeAudit } from "./auditService";
import { MutationRejectedError } from "./errors";

/*
 * Links from a manuscript chapter or scene to the reference records it draws
 * on. A link is not record content: it creates no revision and never changes
 * either record, so it is allowed on protected records. Every change is audited.
 */

const UI_ACTOR = "author";

export interface LinkedReference {
  linkId: string;
  recordId: string;
  title: string;
  type: RecordType;
  authorityStatus: AuthorityStatus;
  linkedAt: Date;
}

function rejected(message: string, recordId?: string): MutationRejectedError {
  return new MutationRejectedError([errorIssue("INVALID_REFERENCE", message, recordId ? { recordId } : {})]);
}

async function findPair(tx: DbOrTx, projectId: string, fromRecordId: string, toRecordId: string) {
  const rows = await tx.record.findMany({
    where: { projectId, id: { in: [fromRecordId, toRecordId] }, trashedAt: null },
    select: { id: true, title: true, type: true },
  });
  const from = rows.find((r) => r.id === fromRecordId);
  const to = rows.find((r) => r.id === toRecordId);
  if (!from) throw rejected(`Record ${fromRecordId} does not exist in this project.`, fromRecordId);
  if (!to) throw rejected(`Record ${toRecordId} does not exist in this project.`, toRecordId);
  return { from, to };
}

export async function listLinkedReferences(db: DbOrTx, projectId: string, fromRecordId: string): Promise<LinkedReference[]> {
  const rows = await db.recordLink.findMany({
    where: { projectId, fromRecordId, to: { trashedAt: null } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { to: { select: { id: true, title: true, type: true, authorityStatus: true } } },
  });
  return rows.flatMap((r) =>
    isRecordType(r.to.type) && isAuthorityStatus(r.to.authorityStatus)
      ? [
          {
            linkId: r.id,
            recordId: r.to.id,
            title: r.to.title,
            type: r.to.type,
            authorityStatus: r.to.authorityStatus,
            linkedAt: r.createdAt,
          },
        ]
      : [],
  );
}

export interface LinkingRecord {
  recordId: string;
  title: string;
  type: RecordType;
  parentRecordId: string | null;
  linkedAt: Date;
}

/** Chapters and scenes that link to a reference record, in manuscript-creation order. */
export async function listLinkingRecords(db: DbOrTx, projectId: string, toRecordId: string): Promise<LinkingRecord[]> {
  const rows = await db.recordLink.findMany({
    where: { projectId, toRecordId, from: { trashedAt: null } },
    orderBy: [{ from: { createdAt: "asc" } }, { id: "asc" }],
    include: { from: { select: { id: true, title: true, type: true, parentRecordId: true } } },
  });
  return rows.flatMap((r) =>
    isRecordType(r.from.type)
      ? [{ recordId: r.from.id, title: r.from.title, type: r.from.type, parentRecordId: r.from.parentRecordId, linkedAt: r.createdAt }]
      : [],
  );
}

/** Linked reference IDs for each of the given records, for the context export. */
export async function linkedIdsByRecord(db: DbOrTx, projectId: string, fromRecordIds: string[]): Promise<Map<string, string[]>> {
  const rows = await db.recordLink.findMany({
    where: { projectId, fromRecordId: { in: fromRecordIds }, to: { trashedAt: null } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { fromRecordId: true, toRecordId: true },
  });
  const map = new Map<string, string[]>();
  for (const r of rows) map.set(r.fromRecordId, [...(map.get(r.fromRecordId) ?? []), r.toRecordId]);
  return map;
}

export async function linkReference(db: Db, projectId: string, fromRecordId: string, toRecordId: string): Promise<void> {
  try {
    await db.$transaction((tx) => linkInTx(tx, projectId, fromRecordId, toRecordId));
  } catch (error) {
    if (isUniqueConstraintError(error)) throw rejected("That reference is already linked here.", toRecordId);
    throw error;
  }
}

async function linkInTx(tx: Tx, projectId: string, fromRecordId: string, toRecordId: string) {
  const { from, to } = await findPair(tx, projectId, fromRecordId, toRecordId);
  if (!isManuscriptType(from.type)) {
    throw rejected("Only manuscript chapters and scenes can have linked references.", fromRecordId);
  }
  if (!isRecordType(to.type) || !isLinkableReferenceType(to.type)) {
    const label = isRecordType(to.type) ? RECORD_TYPE_LABELS[to.type] : to.type;
    throw rejected(`A ${label} cannot be linked as a reference.`, toRecordId);
  }
  const existing = await tx.recordLink.findUnique({ where: { fromRecordId_toRecordId: { fromRecordId, toRecordId } } });
  if (existing) throw rejected("That reference is already linked here.", toRecordId);
  const id = newId("lnk");
  await tx.recordLink.create({ data: { id, projectId, fromRecordId, toRecordId } });
  await writeAudit(tx, {
    projectId,
    action: "record.link",
    actor: UI_ACTOR,
    summary: `Linked "${to.title}" to "${from.title}"`,
    details: { linkId: id, fromRecordId, toRecordId },
  });
}

export async function unlinkReference(db: Db, projectId: string, fromRecordId: string, toRecordId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const { from, to } = await findPair(tx, projectId, fromRecordId, toRecordId);
    const link = await tx.recordLink.findUnique({ where: { fromRecordId_toRecordId: { fromRecordId, toRecordId } } });
    if (!link || link.projectId !== projectId) throw rejected("That reference is not linked here.", toRecordId);
    await tx.recordLink.delete({ where: { id: link.id } });
    await writeAudit(tx, {
      projectId,
      action: "record.unlink",
      actor: UI_ACTOR,
      summary: `Unlinked "${to.title}" from "${from.title}"`,
      details: { linkId: link.id, fromRecordId, toRecordId },
    });
  });
}
