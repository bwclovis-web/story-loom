import { MANUSCRIPT_TYPES } from "@/domain/recordTypes";
import { countWords } from "@/writing/wordCount";
import type { DbOrTx } from "../db";
import { manuscriptDraftWhere, type DraftScope } from "./draftService";
import { getChapterWritingGoal, getProjectWritingGoal } from "./writingGoalService";
import { manuscriptWordCounts, resolveDraftScope, sumWordCounts } from "./wordCountService";

export interface WritingProgressSnapshot {
  bookWords: number;
  projectTarget: number | null;
  projectDeadline: Date | null;
  wordsToday: number;
  wordsSession: number;
  chapterTarget: number | null;
  chapterWords?: number;
}

function startOfLocalDay(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Words added on saved manuscript revisions since `since`, counting positive body deltas only. */
export async function wordsWrittenSince(
  db: DbOrTx,
  projectId: string,
  scope: DraftScope,
  since: Date,
): Promise<number> {
  const recordIds = (
    await db.record.findMany({
      where: {
        projectId,
        trashedAt: null,
        type: { in: [...MANUSCRIPT_TYPES] },
        ...manuscriptDraftWhere(scope),
      },
      select: { id: true },
    })
  ).map((row) => row.id);
  if (!recordIds.length) return 0;

  const revisions = await db.revision.findMany({
    where: { recordId: { in: recordIds }, createdAt: { gte: since } },
    select: { recordId: true, revisionNumber: true, body: true },
    orderBy: [{ recordId: "asc" }, { revisionNumber: "asc" }],
  });
  if (!revisions.length) return 0;

  const firstInPeriod = new Map<string, number>();
  for (const revision of revisions) {
    const current = firstInPeriod.get(revision.recordId);
    if (current === undefined || revision.revisionNumber < current) {
      firstInPeriod.set(revision.recordId, revision.revisionNumber);
    }
  }

  const baselineRows = await db.revision.findMany({
    where: {
      OR: [...firstInPeriod.entries()]
        .filter(([, revisionNumber]) => revisionNumber > 1)
        .map(([recordId, revisionNumber]) => ({ recordId, revisionNumber: revisionNumber - 1 })),
    },
    select: { recordId: true, revisionNumber: true, body: true },
  });
  const baseline = new Map(baselineRows.map((row) => [`${row.recordId}:${row.revisionNumber}`, countWords(row.body)]));

  let total = 0;
  const running = new Map<string, number>();
  for (const revision of revisions) {
    const prev =
      revision.revisionNumber === 1
        ? 0
        : (running.get(revision.recordId) ??
          baseline.get(`${revision.recordId}:${revision.revisionNumber - 1}`) ??
          0);
    const next = countWords(revision.body);
    total += Math.max(0, next - prev);
    running.set(revision.recordId, next);
  }
  return total;
}

/** Positive word deltas on saved revisions since `since`, one row per revision. */
export async function positiveWordDeltas(
  db: DbOrTx,
  projectId: string,
  scope: DraftScope,
  since: Date,
): Promise<{ at: Date; words: number }[]> {
  const recordIds = (
    await db.record.findMany({
      where: {
        projectId,
        trashedAt: null,
        type: { in: [...MANUSCRIPT_TYPES] },
        ...manuscriptDraftWhere(scope),
      },
      select: { id: true },
    })
  ).map((row) => row.id);
  if (!recordIds.length) return [];
  const revisions = await db.revision.findMany({
    where: { recordId: { in: recordIds }, createdAt: { gte: since } },
    select: { recordId: true, revisionNumber: true, body: true, createdAt: true },
    orderBy: [{ recordId: "asc" }, { revisionNumber: "asc" }],
  });
  if (!revisions.length) return [];
  const firstInPeriod = new Map<string, number>();
  for (const revision of revisions) {
    const current = firstInPeriod.get(revision.recordId);
    if (current === undefined || revision.revisionNumber < current) firstInPeriod.set(revision.recordId, revision.revisionNumber);
  }
  const baselinePairs = [...firstInPeriod.entries()]
    .filter(([, revisionNumber]) => revisionNumber > 1)
    .map(([recordId, revisionNumber]) => ({ recordId, revisionNumber: revisionNumber - 1 }));
  const baselineRows = baselinePairs.length
    ? await db.revision.findMany({
        where: { OR: baselinePairs },
        select: { recordId: true, revisionNumber: true, body: true },
      })
    : [];
  const baseline = new Map(baselineRows.map((row) => [`${row.recordId}:${row.revisionNumber}`, countWords(row.body)]));
  const running = new Map<string, number>();
  const deltas: { at: Date; words: number }[] = [];
  for (const revision of revisions) {
    const prev =
      revision.revisionNumber === 1
        ? 0
        : (running.get(revision.recordId) ?? baseline.get(`${revision.recordId}:${revision.revisionNumber - 1}`) ?? 0);
    const next = countWords(revision.body);
    deltas.push({ at: revision.createdAt, words: Math.max(0, next - prev) });
    running.set(revision.recordId, next);
  }
  return deltas;
}

export async function buildWritingProgress(
  db: DbOrTx,
  input: {
    projectId: string;
    hasDrafts: boolean;
    draftId: string | null;
    sessionSince: Date | null;
    chapterRecordId?: string | null;
  },
): Promise<WritingProgressSnapshot> {
  const scope = resolveDraftScope(input.hasDrafts, input.draftId);
  const counts = await manuscriptWordCounts(db, input.projectId, scope);
  const bookWords = sumWordCounts(counts);
  const today = startOfLocalDay();
  const [projectGoal, chapterGoal, wordsToday, wordsSession] = await Promise.all([
    getProjectWritingGoal(db, input.projectId),
    input.chapterRecordId ? getChapterWritingGoal(db, input.projectId, input.chapterRecordId) : Promise.resolve(null),
    wordsWrittenSince(db, input.projectId, scope, today),
    input.sessionSince ? wordsWrittenSince(db, input.projectId, scope, input.sessionSince) : Promise.resolve(0),
  ]);
  const chapterWords = input.chapterRecordId ? (counts.get(input.chapterRecordId) ?? 0) : 0;
  return {
    bookWords,
    projectTarget: projectGoal?.targetWords ?? null,
    projectDeadline: projectGoal?.deadlineAt ?? null,
    wordsToday,
    wordsSession: input.sessionSince ? wordsSession : wordsToday,
    chapterTarget: chapterGoal?.targetWords ?? null,
    ...(input.chapterRecordId ? { chapterWords } : {}),
  };
}