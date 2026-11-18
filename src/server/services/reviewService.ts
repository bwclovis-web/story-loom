import type { Db, DbOrTx } from "../db";
import { writeAudit } from "./auditService";
import { NotFoundError } from "./errors";

export async function listReviewItems(
  db: DbOrTx,
  projectId: string,
  status: "open" | "resolved" | "all" = "open",
  options?: { draftId?: string | null; hasDrafts?: boolean },
) {
  const manuscriptTypes = ["manuscript_chapter", "manuscript_scene"];
  const recordFilter =
    options?.hasDrafts === true
      ? options.draftId
        ? { trashedAt: null, OR: [{ draftId: options.draftId }, { type: { notIn: manuscriptTypes } }] }
        : { trashedAt: null, type: { notIn: manuscriptTypes } }
      : { trashedAt: null };
  const rows = await db.reviewItem.findMany({
    where: { projectId, record: recordFilter, ...(status === "all" ? {} : { status }) },
    orderBy: { createdAt: "desc" },
    include: { record: { select: { id: true, title: true, type: true, draftId: true } } },
  });
  return rows;
}

export async function listOpenReviewItemsForRecord(db: DbOrTx, projectId: string, recordId: string) {
  return db.reviewItem.findMany({
    where: { projectId, recordId, status: "open" },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    select: { id: true, origin: true, note: true, packageId: true, createdAt: true },
  });
}

export async function countOpenReviewItems(db: DbOrTx, projectId: string): Promise<number> {
  return db.reviewItem.count({ where: { projectId, status: "open", record: { trashedAt: null } } });
}

export async function resolveReviewItem(db: Db, projectId: string, reviewItemId: string, actor = "author") {
  await db.$transaction(async (tx) => {
    const item = await tx.reviewItem.findFirst({ where: { id: reviewItemId, projectId } });
    if (!item) throw new NotFoundError(`Review item ${reviewItemId} not found`);
    if (item.status === "resolved") return;
    await tx.reviewItem.update({ where: { id: item.id }, data: { status: "resolved", resolvedAt: new Date() } });
    await writeAudit(tx, {
      projectId,
      action: "review.resolve",
      actor,
      summary: `Resolved review item for ${item.recordId}`,
      details: { reviewItemId: item.id, recordId: item.recordId, packageId: item.packageId },
    });
  });
}
