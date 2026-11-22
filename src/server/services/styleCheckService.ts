import type { RecordType } from "@/domain/recordTypes";
import { parseJsonObject } from "@/domain/json";
import { loadCrossRefIndex } from "@/server/services/crossRefService";
import type { DbOrTx } from "@/server/db";
import { readManuscriptMeta } from "@/writing/manuscriptStructure";
import { crossRefReport } from "@/writing/crossRefs";
import { countWords } from "@/writing/wordCount";
import { dialogueRatio, povCounts, runStyleCheck, styleCheckNameTerms, type DialogueRatio, type PovCount, type StyleIssue } from "@/writing/styleCheck";
import { getWeaveGrid, listWeaveGrids, type WeaveBeatView } from "./weaveService";
import { listChapterWritingGoals } from "./writingGoalService";
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
  /** Chapter writing goal target, when set on this chapter. */
  wordTarget?: number;
}

export interface ManuscriptPovSequenceItem {
  recordId: string;
  title: string;
  type: RecordType;
  pov: string;
}

export interface CharacterMatrixChapter {
  id: string;
  title: string;
}

export interface CharacterMatrixRow {
  recordId: string;
  name: string;
  /** Mention counts per chapter column (chapter body plus its scenes). */
  counts: number[];
}

export interface CharacterMatrix {
  chapters: CharacterMatrixChapter[];
  rows: CharacterMatrixRow[];
}

export interface WeaveSpanInsight {
  id: string;
  gridId: string;
  gridTitle: string;
  fromTitle: string;
  toTitle: string;
  fromProjectId: string;
  toProjectId: string;
  fromProjectTitle: string;
  toProjectTitle: string;
  note: string;
  spanBeats: number | null;
  spanChapters: number | null;
}

export interface ManuscriptStyleCheckResult {
  records: ManuscriptStyleRecord[];
  totalIssues: number;
  pacing: ManuscriptPacingBar[];
  dialogue: DialogueRatio;
  pov: PovCount[];
  povSequence: ManuscriptPovSequenceItem[];
  characterMatrix: CharacterMatrix;
  weaveSpans: WeaveSpanInsight[];
}

function safeFields(text: string): Record<string, unknown> {
  try {
    return parseJsonObject(text);
  } catch {
    return {};
  }
}

function beatOrderIndex(beats: readonly WeaveBeatView[]): Map<string, number> {
  const order = new Map<string, number>();
  beats.forEach((b, i) => order.set(b.id, i));
  return order;
}

function chapterIdForBeat(
  beat: WeaveBeatView | undefined,
  recordTypeById: ReadonlyMap<string, RecordType>,
  parentById: ReadonlyMap<string, string | null>,
): string | null {
  const id = beat?.manuscriptRecordId;
  if (!id) return null;
  const type = recordTypeById.get(id);
  if (type === "manuscript_chapter") return id;
  if (type === "manuscript_scene") return parentById.get(id) ?? null;
  return null;
}

async function buildWeaveSpans(
  db: DbOrTx,
  projectId: string,
  chapterOrder: ReadonlyMap<string, number>,
  recordTypeById: ReadonlyMap<string, RecordType>,
  parentById: ReadonlyMap<string, string | null>,
): Promise<WeaveSpanInsight[]> {
  const summaries = await listWeaveGrids(db, projectId);
  if (!summaries.length) return [];
  const grids = await Promise.all(summaries.map((g) => getWeaveGrid(db, projectId, g.id)));
  const spans: WeaveSpanInsight[] = [];
  for (const grid of grids) {
    const beatIndex = beatOrderIndex(grid.beats);
    const beatById = new Map(grid.beats.map((b) => [b.id, b]));
    for (const link of grid.setupPayoffs) {
      const fromBeat = beatById.get(link.fromBeatId);
      const toBeat = beatById.get(link.toBeatId);
      const fromIdx = beatIndex.get(link.fromBeatId);
      const toIdx = beatIndex.get(link.toBeatId);
      const spanBeats = fromIdx !== undefined && toIdx !== undefined ? Math.max(0, toIdx - fromIdx) : null;
      const fromChapter = chapterIdForBeat(fromBeat, recordTypeById, parentById);
      const toChapter = chapterIdForBeat(toBeat, recordTypeById, parentById);
      const fromChIdx = fromChapter ? chapterOrder.get(fromChapter) : undefined;
      const toChIdx = toChapter ? chapterOrder.get(toChapter) : undefined;
      const spanChapters =
        fromChIdx !== undefined && toChIdx !== undefined ? Math.max(0, toChIdx - fromChIdx) : null;
      spans.push({
        id: link.id,
        gridId: grid.id,
        gridTitle: grid.title,
        fromTitle: link.fromTitle,
        toTitle: link.toTitle,
        fromProjectId: link.fromProjectId,
        toProjectId: link.toProjectId,
        fromProjectTitle: link.fromProjectTitle,
        toProjectTitle: link.toProjectTitle,
        note: link.note,
        spanBeats,
        spanChapters,
      });
    }
  }
  return spans.sort(
    (a, b) => a.gridTitle.localeCompare(b.gridTitle) || a.fromTitle.localeCompare(b.fromTitle) || a.id.localeCompare(b.id),
  );
}

function buildCharacterMatrix(
  index: Awaited<ReturnType<typeof loadCrossRefIndex>>,
  scopeIds: ReadonlySet<string>,
  chapters: readonly CharacterMatrixChapter[],
  scenesByChapter: ReadonlyMap<string, readonly string[]>,
): CharacterMatrix {
  const topCharacters = crossRefReport(index)
    .names.filter((n) => index.records.get(n.recordId)?.type === "character_dossier")
    .slice(0, 12);
  const rows: CharacterMatrixRow[] = topCharacters.map((char) => ({
    recordId: char.recordId,
    name: char.title,
    counts: chapters.map((ch) => {
      let total = 0;
      if (scopeIds.has(ch.id)) total += index.named.get(ch.id)?.get(char.recordId)?.count ?? 0;
      for (const sceneId of scenesByChapter.get(ch.id) ?? []) {
        if (scopeIds.has(sceneId)) total += index.named.get(sceneId)?.get(char.recordId)?.count ?? 0;
      }
      return total;
    }),
  }));
  return { chapters: [...chapters], rows };
}

/** Saved manuscript chapters and scenes only, in book order. No writes. */
export async function runManuscriptStyleCheck(
  db: DbOrTx,
  input: { projectId: string; draftId?: string | null; hasDrafts?: boolean },
): Promise<ManuscriptStyleCheckResult> {
  const [index, rows, chapterGoals] = await Promise.all([
    loadCrossRefIndex(db, input.projectId),
    listManuscriptInBookOrder(db, input),
    listChapterWritingGoals(db, input.projectId),
  ]);
  const manuscriptIds = rows.filter((r) => r.type === "manuscript_chapter" || r.type === "manuscript_scene").map((r) => r.id);
  const structureRows =
    manuscriptIds.length === 0
      ? ([] as Array<{ id: string; type: string; parentRecordId: string | null; fields: string }>)
      : await db.record.findMany({
          where: { projectId: input.projectId, trashedAt: null, id: { in: manuscriptIds } },
          select: { id: true, type: true, parentRecordId: true, fields: true },
        });

  const characterNames = styleCheckNameTerms(index);
  const targetByChapter = new Map(chapterGoals.map((g) => [g.recordId, g.targetWords] as const));
  const parentById = new Map(structureRows.map((r) => [r.id, r.parentRecordId] as const));
  const fieldsById = new Map(structureRows.map((r) => [r.id, safeFields(r.fields)] as const));
  const recordTypeById = new Map(
    structureRows.filter((r) => r.type === "manuscript_chapter" || r.type === "manuscript_scene").map((r) => [r.id, r.type as RecordType] as const),
  );

  const scopeIds = new Set(
    rows.filter((r) => r.type === "manuscript_chapter" || r.type === "manuscript_scene").map((r) => r.id),
  );
  const chapters: CharacterMatrixChapter[] = rows.filter((r) => r.type === "manuscript_chapter").map((r) => ({ id: r.id, title: r.title }));
  const chapterOrder = new Map(chapters.map((ch, i) => [ch.id, i] as const));
  const scenesByChapter = new Map<string, string[]>();
  for (const row of rows) {
    if (row.type !== "manuscript_scene") continue;
    const parentId = parentById.get(row.id);
    if (!parentId) continue;
    scenesByChapter.set(parentId, [...(scenesByChapter.get(parentId) ?? []), row.id]);
  }

  const records: ManuscriptStyleRecord[] = [];
  const pacing: ManuscriptPacingBar[] = [];
  const povSequence: ManuscriptPovSequenceItem[] = [];
  let totalIssues = 0;
  let dialogueWords = 0;
  let narrationWords = 0;
  const povTotals = new Map<string, number>();
  for (const row of rows) {
    if (row.type !== "manuscript_chapter" && row.type !== "manuscript_scene") continue;
    const wordTarget = row.type === "manuscript_chapter" ? targetByChapter.get(row.id) : undefined;
    pacing.push({
      id: row.id,
      title: row.title,
      words: countWords(row.body),
      ...(wordTarget !== undefined ? { wordTarget } : {}),
    });
    const meta = readManuscriptMeta(fieldsById.get(row.id) ?? {});
    povSequence.push({ recordId: row.id, title: row.title, type: row.type, pov: meta.pov.trim() });
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

  const [characterMatrix, weaveSpans] = await Promise.all([
    Promise.resolve(buildCharacterMatrix(index, scopeIds, chapters, scenesByChapter)),
    buildWeaveSpans(db, input.projectId, chapterOrder, recordTypeById, parentById),
  ]);

  return {
    records,
    totalIssues,
    pacing,
    dialogue: { dialogueWords, narrationWords },
    pov,
    povSequence,
    characterMatrix,
    weaveSpans,
  };
}