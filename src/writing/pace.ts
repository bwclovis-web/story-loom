export interface DayWords {
  iso: string;
  words: number;
}

export function localDayIso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function shiftIsoDay(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map((part) => Number(part));
  const date = new Date(year!, (month ?? 1) - 1, day ?? 1);
  date.setDate(date.getDate() + days);
  return localDayIso(date);
}

/** One entry per day, oldest first, ending on `today`. Missing days are zero. */
export function fillDayRange(deltas: readonly { at: Date; words: number }[], today: Date, days: number): DayWords[] {
  const totals = new Map<string, number>();
  for (const delta of deltas) {
    if (delta.words <= 0) continue;
    const key = localDayIso(delta.at);
    totals.set(key, (totals.get(key) ?? 0) + delta.words);
  }
  const end = localDayIso(today);
  const out: DayWords[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const iso = shiftIsoDay(end, -offset);
    out.push({ iso, words: totals.get(iso) ?? 0 });
  }
  return out;
}

/**
 * Consecutive days with saved words, ending today, or yesterday when today is still empty.
 */
export function writingStreak(days: readonly DayWords[], todayIso: string): number {
  const totals = new Map(days.map((day) => [day.iso, day.words]));
  let cursor = (totals.get(todayIso) ?? 0) > 0 ? todayIso : shiftIsoDay(todayIso, -1);
  let streak = 0;
  while ((totals.get(cursor) ?? 0) > 0) {
    streak += 1;
    cursor = shiftIsoDay(cursor, -1);
  }
  return streak;
}

/** Words still needed per day to meet the target by the deadline. Null when either is unset. */
export function dailyPaceTarget(bookWords: number, targetWords: number | null, deadline: Date | null, now: Date): number | null {
  if (targetWords == null || deadline == null || Number.isNaN(deadline.getTime())) return null;
  const remaining = Math.max(0, targetWords - bookWords);
  const ms = deadline.getTime() - now.getTime();
  const days = Math.max(1, Math.ceil(ms / 86_400_000));
  return Math.ceil(remaining / days);
}
