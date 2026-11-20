import { isManuscriptType } from "@/domain/recordTypes";
import type { DbOrTx } from "@/server/db";
import { NotFoundError } from "@/server/services/errors";
import { getRecord } from "@/server/services/recordService";

export type ManuscriptSnapshot = {
  id: string;
  title: string;
  body: string;
  revision: number;
  kind: "chapter" | "scene";
  parentTitle: string | null;
  isProtected: boolean;
};

export async function getManuscriptSnapshot(
  db: DbOrTx,
  projectId: string,
  recordId: string,
): Promise<ManuscriptSnapshot> {
  const record = await getRecord(db, projectId, recordId);
  if (!isManuscriptType(record.type) || record.type === "scene_note") {
    throw new NotFoundError("Record is not a chapter or scene.");
  }
  let parentTitle: string | null = null;
  if (record.parentRecordId) {
    const parent = await db.record.findFirst({
      where: { id: record.parentRecordId, projectId, trashedAt: null },
      select: { title: true },
    });
    parentTitle = parent?.title ?? null;
  }
  return {
    id: record.id,
    title: record.title,
    body: record.body,
    revision: record.currentRevision,
    kind: record.type === "manuscript_scene" ? "scene" : "chapter",
    parentTitle,
    isProtected: record.protected,
  };
}