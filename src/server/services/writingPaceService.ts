import { dailyPaceTarget, fillDayRange, localDayIso, writingStreak, type DayWords } from "@/writing/pace";
import type { DbOrTx } from "../db";
import { positiveWordDeltas } from "./writingProgressService";
import { resolveDraftScope } from "./wordCountService";

export interface WritingPaceReport {
  days: DayWords[];
  streak: number;
  dailyTarget: number | null;
}

/** Thirty saved-word days, the current streak, and the words still needed each day. */
export async function buildWritingPace(
  db: DbOrTx,
  input: {
    projectId: string;
    hasDrafts: boolean;
    draftId: string | null;
    bookWords: number;
    projectTarget: number | null;
    projectDeadline: Date | null;
    now?: Date;
  },
): Promise<WritingPaceReport> {
  const now = input.now ?? new Date();
  const scope = resolveDraftScope(input.hasDrafts, input.draftId);
  const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
  const deltas = await positiveWordDeltas(db, input.projectId, scope, since);
  const days = fillDayRange(deltas, now, 30);
  return {
    days,
    streak: writingStreak(days, localDayIso(now)),
    dailyTarget: dailyPaceTarget(input.bookWords, input.projectTarget, input.projectDeadline, now),
  };
}
