import { MANUSCRIPT_TYPES } from "@/domain/recordTypes";
import { countWords } from "@/writing/wordCount";
import type { DbOrTx } from "../db";

/** Saved word count of every manuscript chapter and scene in the project, keyed by record ID. */
export async function manuscriptWordCounts(db: DbOrTx, projectId: string): Promise<Map<string, number>> {
  const rows = await db.record.findMany({
    where: { projectId, type: { in: [...MANUSCRIPT_TYPES] }, trashedAt: null },
    select: { id: true, body: true },
  });
  return new Map(rows.map((c) => [c.id, countWords(c.body)]));
}

export function sumWordCounts(counts: ReadonlyMap<string, number>, excludeId?: string): number {
  let total = 0;
  for (const [id, n] of counts) if (id !== excludeId) total += n;
  return total;
}
