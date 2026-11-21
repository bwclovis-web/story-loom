import type { RecordType } from "@/domain/recordTypes";
import { loadCrossRefIndex } from "@/server/services/crossRefService";
import type { DbOrTx } from "@/server/db";
import { countWords } from "@/writing/wordCount";
import { dialogueRatio, povCounts, runStyleCheck, styleCheckNameTerms, type DialogueRatio, type PovCount, type StyleIssue } from "@/writing/styleCheck";
import { listManuscriptInBookOrder } from "./searchService";

export interface ManuscriptStyleRecord {
  id: string;
  type: RecordType;
  title: string;
  parentTitle: string | null;
  issues: StyleIssue[];
}

export interface ManuscriptPacingBar {
  id: string;
  title: string;
  words: number;
}

export interface ManuscriptStyleCheckResult {
  records: ManuscriptStyleRecord[];
  totalIssues: number;
  pacing: ManuscriptPacingBar[];
  dialogue: DialogueRatio;
  pov: PovCount[];
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
  const pacing: ManuscriptPacingBar[] = [];
  let totalIssues = 0;
  let dialogueWords = 0;
  let narrationWords = 0;
  const povTotals = new Map<string, number>();
  for (const row of rows) {
    if (row.type !== "manuscript_chapter" && row.type !== "manuscript_scene") continue;
    pacing.push({ id: row.id, title: row.title, words: countWords(row.body) });
    const ratio = dialogueRatio(row.body);
    dialogueWords += ratio.dialogueWords;
    narrationWords += ratio.narrationWords;
    for (const name of povCounts(row.body, characterNames)) {
      povTotals.set(name.name, (povTotals.get(name.name) ?? 0) + name.count);
    }
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
  const pov = [...povTotals.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 8);
  return { records, totalIssues, pacing, dialogue: { dialogueWords, narrationWords }, pov };
}