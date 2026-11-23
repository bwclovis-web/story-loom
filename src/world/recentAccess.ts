/** Client-only recently opened World references. Never written by the server. */

export interface RecentAccessEntry {
  id: string;
  title: string;
  openedAt: string;
}

const PREFIX = "storyloom.world.recent.";
const MAX = 12;

function key(projectId: string): string {
  return `${PREFIX}${projectId}`;
}

export function readRecentAccess(projectId: string): RecentAccessEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key(projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        if (typeof row.id !== "string" || typeof row.title !== "string" || typeof row.openedAt !== "string") return [];
        return [{ id: row.id, title: row.title, openedAt: row.openedAt }];
      })
      .slice(0, MAX);
  } catch {
    return [];
  }
}

export function rememberRecentAccess(projectId: string, entry: { id: string; title: string }): RecentAccessEntry[] {
  if (typeof window === "undefined") return [];
  const next: RecentAccessEntry[] = [
    { id: entry.id, title: entry.title, openedAt: new Date().toISOString() },
    ...readRecentAccess(projectId).filter((item) => item.id !== entry.id),
  ].slice(0, MAX);
  try {
    window.localStorage.setItem(key(projectId), JSON.stringify(next));
  } catch {
    /* ignore quota / private mode */
  }
  return next;
}
