import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseJsonObject } from "@/domain/json";

function settingsDir(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), "local");
}

function settingsFile(): string {
  return path.join(settingsDir(), "backup-mirror.json");
}

export interface BackupMirrorSettings {
  /** Absolute folder path. Each full backup is copied into a timestamped subfolder here. */
  mirrorDir: string | null;
}

function fromEnv(): string | null {
  const raw = process.env.WORDLY_BACKUP_MIRROR_DIR?.trim();
  return raw ? path.resolve(raw) : null;
}

function readFileSettings(): BackupMirrorSettings {
  const file = settingsFile();
  if (!existsSync(file)) return { mirrorDir: null };
  try {
    const parsed = parseJsonObject(readFileSync(file, "utf8"));
    const mirrorDir = typeof parsed.mirrorDir === "string" && parsed.mirrorDir.trim() ? path.resolve(parsed.mirrorDir.trim()) : null;
    return { mirrorDir };
  } catch {
    return { mirrorDir: null };
  }
}

export function loadBackupMirrorSettings(): BackupMirrorSettings {
  const env = fromEnv();
  if (env) return { mirrorDir: env };
  return readFileSettings();
}

export function validateMirrorDir(input: string): { ok: true; path: string } | { ok: false; message: string } {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, message: "Enter a folder path." };
  const resolved = path.resolve(trimmed);
  if (resolved.length > 260) return { ok: false, message: "That path is too long." };
  return { ok: true, path: resolved };
}

export function saveBackupMirrorSettings(mirrorDir: string | null): BackupMirrorSettings {
  mkdirSync(settingsDir(), { recursive: true });
  const next: BackupMirrorSettings = { mirrorDir };
  writeFileSync(settingsFile(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function backupMirrorSettingsPath(): string {
  return settingsFile();
}