import { MANUSCRIPT_TYPES } from "@/domain/recordTypes";
import { countWords } from "@/writing/wordCount";
import type { DbOrTx } from "../db";
import { manuscriptDraftWhere, resolveDraftScope, type DraftScope } from "./draftService";

/** Saved word count of manuscript chapters and scenes, optionally scoped to a draft. */
export async function manuscriptWordCounts(
  db: DbOrTx,
  projectId: string,
  scope?: DraftScope,
): Promise<Map<string, number>> {
  const draftScope = scope ?? { mode: "legacy" as const };
  const rows = await db.record.findMany({
    where: {
      projectId,
      type: { in: [...MANUSCRIPT_TYPES] },
      trashedAt: null,
      ...manuscriptDraftWhere(draftScope),
    },
    select: { id: true, body: true },
  });
  return new Map(rows.map((c) => [c.id, countWords(c.body)]));
}

export { resolveDraftScope };

export function sumWordCounts(counts: ReadonlyMap<string, number>, excludeId?: string): number {
  let total = 0;
  for (const [id, n] of counts) if (id !== excludeId) total += n;
  return total;
}
