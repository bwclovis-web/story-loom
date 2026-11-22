import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { parseJsonObject } from "@/domain/json";

/*
 * Optional library folder for the desktop app (and WORDLY_LIBRARY_DIR).
 * When set, the SQLite file is <library>/storyloom.db. Developer runs keep
 * prisma/dev.db unless this is set.
 */

const DB_NAME = "storyloom.db";
const LOCK_NAME = "storyloom.lock.json";

function localDir(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), "local");
}

function librarySettingsFile(): string {
  return path.join(localDir(), "library.json");
}

export interface LibrarySettings {
  libraryDir: string | null;
}

export interface LibraryLock {
  pid: number;
  hostname: string;
  startedAt: string;
  appInstanceId: string;
}

export function librarySettingsPath(): string {
  return librarySettingsFile();
}

function fromEnv(): string | null {
  const raw = process.env.WORDLY_LIBRARY_DIR?.trim();
  return raw ? path.resolve(/*turbopackIgnore: true*/ raw) : null;
}

function readFileSettings(): LibrarySettings {
  const file = librarySettingsFile();
  if (!existsSync(file)) return { libraryDir: null };
  try {
    const parsed = parseJsonObject(readFileSync(file, "utf8"));
    const libraryDir =
      typeof parsed.libraryDir === "string" && parsed.libraryDir.trim()
        ? path.resolve(/*turbopackIgnore: true*/ parsed.libraryDir.trim())
        : null;
    return { libraryDir };
  } catch {
    return { libraryDir: null };
  }
}

export function loadLibrarySettings(): LibrarySettings {
  const env = fromEnv();
  if (env) return { libraryDir: env };
  return readFileSettings();
}

export function saveLibrarySettings(libraryDir: string | null): LibrarySettings {
  mkdirSync(localDir(), { recursive: true });
  const next: LibrarySettings = { libraryDir };
  writeFileSync(librarySettingsFile(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export function validateLibraryDir(input: string): { ok: true; path: string } | { ok: false; message: string } {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, message: "Enter a folder path." };
  const resolved = path.resolve(/*turbopackIgnore: true*/ trimmed);
  if (resolved.length > 260) return { ok: false, message: "That path is too long." };
  return { ok: true, path: resolved };
}

/** Absolute path of the SQLite file when a library folder is configured; otherwise null. */
export function libraryDatabasePath(settings: LibrarySettings = loadLibrarySettings()): string | null {
  if (!settings.libraryDir) return null;
  return path.join(settings.libraryDir, DB_NAME);
}

export function libraryLockPath(libraryDir: string): string {
  return path.join(libraryDir, LOCK_NAME);
}

export function readLibraryLock(libraryDir: string): LibraryLock | null {
  const file = libraryLockPath(libraryDir);
  if (!existsSync(file)) return null;
  try {
    const parsed = parseJsonObject(readFileSync(file, "utf8"));
    if (
      typeof parsed.pid !== "number" ||
      typeof parsed.hostname !== "string" ||
      typeof parsed.startedAt !== "string" ||
      typeof parsed.appInstanceId !== "string"
    ) {
      return null;
    }
    return {
      pid: parsed.pid,
      hostname: parsed.hostname,
      startedAt: parsed.startedAt,
      appInstanceId: parsed.appInstanceId,
    };
  } catch {
    return null;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export type LockCheck =
  | { status: "clear" }
  | { status: "ours"; lock: LibraryLock }
  | { status: "stale"; lock: LibraryLock }
  | { status: "foreign"; lock: LibraryLock };

export function inspectLibraryLock(libraryDir: string, appInstanceId: string): LockCheck {
  const lock = readLibraryLock(libraryDir);
  if (!lock) return { status: "clear" };
  if (lock.appInstanceId === appInstanceId) return { status: "ours", lock };
  if (lock.hostname === hostname() && !processAlive(lock.pid)) return { status: "stale", lock };
  return { status: "foreign", lock };
}

export function writeLibraryLock(libraryDir: string, appInstanceId: string): LibraryLock {
  mkdirSync(libraryDir, { recursive: true });
  const lock: LibraryLock = {
    pid: process.pid,
    hostname: hostname(),
    startedAt: new Date().toISOString(),
    appInstanceId,
  };
  const file = libraryLockPath(libraryDir);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
  renameSync(tmp, file);
  return lock;
}

export function clearLibraryLock(libraryDir: string, appInstanceId: string): void {
  const lock = readLibraryLock(libraryDir);
  if (!lock) return;
  if (lock.appInstanceId !== appInstanceId && lock.pid !== process.pid) return;
  try {
    unlinkSync(libraryLockPath(libraryDir));
  } catch {
    // Leaving a stale lock is recovered on the next launch.
  }
}

export function ensureLibraryDir(libraryDir: string): void {
  mkdirSync(libraryDir, { recursive: true });
}
