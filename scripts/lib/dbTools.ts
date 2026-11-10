import "dotenv/config";
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { writeFullBackup, type FullBackupResult } from "../../src/server/backupFiles";
import { createDb } from "../../src/server/db";
import { databaseFilePath, fileUrl } from "../../src/server/dbLocation";

export { BACKUPS_DIR, snapshotSqlite, timestamp, type FullBackupResult } from "../../src/server/backupFiles";

export function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

export function flagValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const VALUE_FLAGS = new Set(["--new-database", "--name", "--label"]);

export function positionalArgs(): string[] {
  const args = process.argv.slice(2);
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      if (VALUE_FLAGS.has(args[i])) i++;
      continue;
    }
    out.push(args[i]);
  }
  return out;
}

export function databaseExists(file = databaseFilePath()): boolean {
  return existsSync(file) && statSync(file).size > 0;
}

/**
 * Writes backups/<timestamp>[-label]/ containing a raw SQLite snapshot of the
 * whole database plus one portable JSON backup per workspace.
 */
export async function backupCurrentDatabase(label?: string): Promise<FullBackupResult> {
  const file = databaseFilePath();
  if (!databaseExists(file)) throw new Error(`No database found at ${file}; nothing to back up.`);
  const db = createDb(fileUrl(file));
  try {
    return await writeFullBackup(db, file, { label });
  } finally {
    await db.$disconnect();
  }
}

export function printBackup(result: FullBackupResult) {
  console.log(`Backup written to ${result.dir}`);
  console.log(`  SQLite snapshot: ${path.basename(result.sqliteFile)}`);
  for (const w of result.workspaceFiles) console.log(`  Workspace "${w.name}" (${w.workspaceId}): ${path.basename(w.file)}`);
}

function runTool(args: string[], dbFile: string): void {
  const command = ["pnpm", "exec", ...args].map((a) => (/^[\w./:=@-]+$/.test(a) ? a : JSON.stringify(a))).join(" ");
  const result = spawnSync(command, {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, DATABASE_URL: fileUrl(dbFile) },
  });
  if (result.status !== 0) throw new Error(`${args.join(" ")} failed with exit code ${result.status}`);
}

/** Runs the project's Prisma CLI against an explicit database file. */
export function runPrisma(args: string[], dbFile = databaseFilePath()): void {
  runTool(["prisma", ...args], dbFile);
}

export function runSeed(dbFile = databaseFilePath()): void {
  runTool(["tsx", "prisma/seed.ts"], dbFile);
}

export async function main(fn: () => Promise<void>) {
  try {
    await fn();
  } catch (error) {
    console.error(`\nError: ${(error as Error).message}`);
    process.exit(1);
  }
}
