import type { RecordType } from "@/domain/recordTypes";
import { loadCrossRefIndex } from "@/server/services/crossRefService";
import type { DbOrTx } from "@/server/db";
import { runStyleCheck, styleCheckNameTerms, type StyleIssue } from "@/writing/styleCheck";
import { listManuscriptInBookOrder } from "./searchService";

export interface ManuscriptStyleRecord {
  id: string;
  type: RecordType;
  title: string;
  parentTitle: string | null;
  issues: StyleIssue[];
}

export interface ManuscriptStyleCheckResult {
  records: ManuscriptStyleRecord[];
  totalIssues: number;
}

/** Saved manuscript chapters and scenes only, in book order. No writes. */
export async function runManuscriptStyleCheck(
  db: DbOrTx,
  input: { projectId: string; draftId?: string | null; hasDrafts?: boolean },
): Promise<ManuscriptStyleCheckResult> {
  const index = await loadCrossRefIndex(db, input.projectId);
  const characterNames = styleCheckNameTerms(index);
  const rows = await listManuscriptInBookOrder(db, input);
  const records: ManuscriptStyleRecord[] = [];
  let totalIssues = 0;
  for (const row of rows) {
    if (row.type !== "manuscript_chapter" && row.type !== "manuscript_scene") continue;
    const issues = runStyleCheck(row.body, { characterNames });
    if (!issues.length) continue;
    totalIssues += issues.length;
    records.push({
      id: row.id,
      type: row.type,
      title: row.title,
      parentTitle: row.parentTitle,
      issues,
    });
  }
  return { records, totalIssues };
}