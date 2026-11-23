import { newId } from "@/domain/ids";
import { errorIssue } from "@/domain/issues";
import { isLinkableReferenceType, isRecordType, RECORD_TYPE_LABELS, type RecordType } from "@/domain/recordTypes";
import { isAuthorityStatus, type AuthorityStatus } from "@/domain/statuses";
import type { SeriesHomeRef } from "@/world/seriesHome";
import type { Db, DbOrTx, Tx } from "../db";
import { writeAudit } from "./auditService";
import { listManuscriptDrafts } from "./draftService";
import { MutationRejectedError, NotFoundError } from "./errors";
import { resolveAvailableReference } from "./seriesBibleService";

/*
 * Ordered reading pins: references kept open beside prose. Scoped by project and
 * draft (scopeDraftId "" = legacy project with no ManuscriptDraft rows). Pin and
 * unpin never create or remove RecordLink. A pin alone does not authorize sending
 * that reference to the assistant.
 */

const UI_ACTOR = "author";

/** Empty string = project-level pins when the project has no manuscript drafts. */
export const PROJECT_PIN_SCOPE = "";

export interface ReadingPinView {
  pinId: string;
  recordId: string;
  title: string;
  type: RecordType;
  authorityStatus: AuthorityStatus;
  position: number;
  currentRevision: number;
  pinnedAt: Date;
  /** Set when the pinned reference lives in another book of this series. */
  seriesHome?: SeriesHomeRef | null;
}

function rejected(message: string, recordId?: string): MutationRejectedError {
  return new MutationRejectedError([errorIssue("INVALID_REFERENCE", message, recordId ? { recordId } : {})]);
}

/** Resolve pin scope: active draft id when drafts exist, else project-level "". */
export async function resolvePinScope(
  db: DbOrTx,
  projectId: string,
  preferredDraftId?: string | null,
): Promise<string> {
  const drafts = await listManuscriptDrafts(db, projectId);
  if (drafts.length === 0) return PROJECT_PIN_SCOPE;
  if (preferredDraftId && drafts.some((d) => d.id === preferredDraftId)) return preferredDraftId;
  const author = drafts.find((d) => d.kind === "author_manuscript");
  const zero = drafts.find((d) => d.kind === "zero_draft");
  return author?.id ?? zero?.id ?? drafts[0]!.id;
}

export async function listReadingPins(
  db: DbOrTx,
  projectId: string,
  scopeDraftId: string,
): Promise<ReadingPinView[]> {
  const rows = await db.readingPin.findMany({
    where: { projectId, scopeDraftId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    include: {
      record: {
        select: { id: true, title: true, type: true, authorityStatus: true, currentRevision: true, trashedAt: true },
      },
    },
  });
  const out: ReadingPinView[] = [];
  for (const r of rows) {
    if (r.record.trashedAt) continue;
    const available = await resolveAvailableReference(db, projectId, r.recordId);
    if (!available) continue;
    if (!isRecordType(available.record.type) || !isAuthorityStatus(available.record.authorityStatus)) continue;
    out.push({
      pinId: r.id,
      recordId: available.record.id,
      title: available.record.title,
      type: available.record.type,
      authorityStatus: available.record.authorityStatus,
      position: r.position,
      currentRevision: available.record.currentRevision,
      pinnedAt: r.createdAt,
      seriesHome: available.home,
    });
  }
  return out;
}

export async function addReadingPin(
  db: Db,
  projectId: string,
  scopeDraftId: string,
  recordId: string,
): Promise<ReadingPinView> {
  return db.$transaction(async (tx) => {
    const project = await tx.project.findFirst({ where: { id: projectId, trashedAt: null }, select: { id: true } });
    if (!project) throw new NotFoundError(`Project ${projectId} not found`);
    if (scopeDraftId !== PROJECT_PIN_SCOPE) {
      const draft = await tx.manuscriptDraft.findFirst({ where: { id: scopeDraftId, projectId } });
      if (!draft) throw rejected(`Draft ${scopeDraftId} does not exist in this project.`);
    }
    const available = await resolveAvailableReference(tx, projectId, recordId);
    if (!available) throw rejected(`Record ${recordId} does not exist in this project.`, recordId);
    const record = available.record;
    if (!isLinkableReferenceType(record.type)) {
      const label = isRecordType(record.type) ? RECORD_TYPE_LABELS[record.type] : record.type;
      throw rejected(`A ${label} cannot be pinned as reading context.`, recordId);
    }
    const existing = await tx.readingPin.findUnique({
      where: { projectId_scopeDraftId_recordId: { projectId, scopeDraftId, recordId: record.id } },
    });
    if (existing) throw rejected("That reference is already pinned here.", recordId);

    const maxPos = await tx.readingPin.aggregate({
      where: { projectId, scopeDraftId },
      _max: { position: true },
    });
    const id = newId("pin");
    const position = (maxPos._max.position ?? -1) + 1;
    await tx.readingPin.create({
      data: { id, projectId, scopeDraftId, recordId: record.id, position },
    });
    await writeAudit(tx, {
      projectId,
      action: "reading_pin.add",
      actor: UI_ACTOR,
      summary: `Pinned "${record.title}" for reading`,
      details: {
        pinId: id,
        recordId: record.id,
        scopeDraftId,
        position,
        seriesHome: available.home
          ? {
              projectId: available.home.projectId,
              title: available.home.title,
              bookName: available.home.bookName,
            }
          : null,
      },
    });
    return {
      pinId: id,
      recordId: record.id,
      title: record.title,
      type: record.type,
      authorityStatus: isAuthorityStatus(record.authorityStatus) ? record.authorityStatus : "draft",
      position,
      currentRevision: record.currentRevision,
      pinnedAt: new Date(),
      seriesHome: available.home,
    };
  });
}

export async function removeReadingPin(
  db: Db,
  projectId: string,
  scopeDraftId: string,
  recordId: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const pin = await tx.readingPin.findFirst({
      where: { projectId, scopeDraftId, recordId },
      include: { record: { select: { title: true } } },
    });
    if (!pin) throw rejected("That reference is not pinned here.", recordId);
    await tx.readingPin.delete({ where: { id: pin.id } });
    await renumberInTx(tx, projectId, scopeDraftId);
    await writeAudit(tx, {
      projectId,
      action: "reading_pin.remove",
      actor: UI_ACTOR,
      summary: `Unpinned "${pin.record.title}"`,
      details: { pinId: pin.id, recordId, scopeDraftId },
    });
  });
}

/** Reorder pins to the given record id order (must be the full set for the scope). */
export async function reorderReadingPins(
  db: Db,
  projectId: string,
  scopeDraftId: string,
  recordIds: readonly string[],
): Promise<ReadingPinView[]> {
  return db.$transaction(async (tx) => {
    const current = await tx.readingPin.findMany({
      where: { projectId, scopeDraftId },
      select: { id: true, recordId: true },
    });
    if (current.length !== recordIds.length) {
      throw rejected("Pin order must include every pinned reference for this draft.");
    }
    const byRecord = new Map(current.map((p) => [p.recordId, p]));
    for (const id of recordIds) {
      if (!byRecord.has(id)) throw rejected(`Record ${id} is not pinned in this scope.`, id);
    }
    for (const [i, recordId] of recordIds.entries()) {
      await tx.readingPin.update({
        where: { id: byRecord.get(recordId)!.id },
        data: { position: i },
      });
    }
    await writeAudit(tx, {
      projectId,
      action: "reading_pin.reorder",
      actor: UI_ACTOR,
      summary: `Reordered ${recordIds.length} reading pin${recordIds.length === 1 ? "" : "s"}`,
      details: { scopeDraftId, recordIds: [...recordIds] },
    });
    return listReadingPins(tx, projectId, scopeDraftId);
  });
}

async function renumberInTx(tx: Tx, projectId: string, scopeDraftId: string) {
  const rows = await tx.readingPin.findMany({
    where: { projectId, scopeDraftId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  for (const [i, row] of rows.entries()) {
    await tx.readingPin.update({ where: { id: row.id }, data: { position: i } });
  }
}
