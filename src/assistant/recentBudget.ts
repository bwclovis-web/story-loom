export const DEFAULT_RECENT_BUDGET = 8000;
const MIN_RECENT_BUDGET = 2000;
const MAX_RECENT_BUDGET = 50_000;

export function clampRecentBudget(chars: number): number {
  if (!Number.isFinite(chars)) return DEFAULT_RECENT_BUDGET;
  return Math.min(MAX_RECENT_BUDGET, Math.max(MIN_RECENT_BUDGET, Math.floor(chars)));
}

/** Newest-first complete messages that fit within the character budget. */
export function budgetRecentMessageIds(
  messages: readonly { id: string; role: string; status: string; content: string }[],
  budgetChars: number,
): string[] {
  const budget = clampRecentBudget(budgetChars);
  const ids: string[] = [];
  let used = 0;
  for (const m of [...messages].reverse()) {
    if (m.role === "assistant" && m.status !== "complete") continue;
    if (m.role !== "user" && m.role !== "assistant") continue;
    const len = m.content.length;
    if (ids.length && used + len > budget) break;
    if (!ids.length && len > budget) {
      ids.push(m.id);
      break;
    }
    ids.push(m.id);
    used += len;
    if (used >= budget) break;
  }
  return ids;
}
