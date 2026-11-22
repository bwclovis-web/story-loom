import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

const DEFAULT_RETENTION = 14;

/** Timestamped full-backup folder names from writeFullBackup (ISO with dashes). */
function isBackupFolderName(name: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z/.test(name);
}

function folderMtime(dir: string): number {
  try {
    return statSync(dir).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Keep the newest `retention` backup subfolders under `mirrorRoot` and remove the rest.
 * Sorting uses folder name (timestamp) then mtime as a tiebreaker.
 */
export function pruneMirrorBackups(mirrorRoot: string, retention: number = DEFAULT_RETENTION): {
  removed: string[];
  kept: string[];
} {
  if (!mirrorRoot || retention < 1 || !existsSync(mirrorRoot)) {
    return { removed: [], kept: [] };
  }
  const entries = readdirSync(mirrorRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && isBackupFolderName(d.name))
    .map((d) => d.name);
  const sorted = [...entries].sort((a, b) => {
    const byName = b.localeCompare(a);
    if (byName !== 0) return byName;
    return folderMtime(path.join(mirrorRoot, b)) - folderMtime(path.join(mirrorRoot, a));
  });
  const kept = sorted.slice(0, retention);
  const removed: string[] = [];
  for (const name of sorted.slice(retention)) {
    const target = path.join(mirrorRoot, name);
    try {
      rmSync(target, { recursive: true, force: true });
      removed.push(name);
    } catch {
      // leave on disk if removal fails
    }
  }
  return { removed, kept };
}