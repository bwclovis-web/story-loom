import Database from "better-sqlite3";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Db } from "./db";
import { mirrorFullBackupFolder } from "./backupMirror";
import { createWorkspaceBackup } from "./services/backupService";

/*
 * Full backups on disk: a raw SQLite snapshot plus one portable JSON backup per
 * workspace. Used by the db:* scripts and before anything is deleted permanently.
 * No "server-only" import: the scripts run outside Next.js.
 */

export const BACKUPS_DIR = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "backups");

export function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/** Consistent copy of a live SQLite file using SQLite's online backup API. */
export async function snapshotSqlite(sourceFile: string, destFile: string): Promise<void> {
  mkdirSync(path.dirname(destFile), { recursive: true });
  const sqlite = new Database(sourceFile, { readonly: true, fileMustExist: true });
  try {
    await sqlite.backup(destFile);
  } finally {
    sqlite.close();
  }
}

export interface FullBackupResult {
  dir: string;
  sqliteFile: string;
  workspaceFiles: Array<{ workspaceId: string; name: string; file: string }>;
  mirrorDestDir: string | null;
  mirrorError: string | null;
}

/**
 * Writes <backupsDir>/<timestamp>[-label]/ for the database file `db` is open on.
 * Every workspace is included, also those in the Trash.
 */
export async function writeFullBackup(
  db: Db,
  databaseFile: string,
  options: { backupsDir?: string; label?: string } = {},
): Promise<FullBackupResult> {
  const name = options.label ? `${timestamp()}-${options.label}` : timestamp();
  const dir = path.join(/*turbopackIgnore: true*/ options.backupsDir ?? BACKUPS_DIR, name);
  const sqliteFile = path.join(/*turbopackIgnore: true*/ dir, path.basename(databaseFile));
  await snapshotSqlite(databaseFile, sqliteFile);

  const workspaceFiles: FullBackupResult["workspaceFiles"] = [];
  const hasTables = await db.$queryRawUnsafe<Array<{ name: string }>>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='Workspace'",
  );
  if (hasTables.length > 0) {
    // Explicit columns: db:deploy backs up before newer columns exist.
    for (const ws of await db.workspace.findMany({ orderBy: { id: "asc" }, select: { id: true, name: true } })) {
      const backup = await createWorkspaceBackup(db, ws.id);
      const out = path.join(dir, `${ws.id}.wordly-backup.json`);
      writeFileSync(out, JSON.stringify(backup, null, 2), "utf8");
      workspaceFiles.push({ workspaceId: ws.id, name: ws.name, file: out });
    }
  }
  const mirror = mirrorFullBackupFolder(dir);
  return {
    dir,
    sqliteFile,
    workspaceFiles,
    mirrorDestDir: mirror.destDir,
    mirrorError: mirror.error,
  };
}
