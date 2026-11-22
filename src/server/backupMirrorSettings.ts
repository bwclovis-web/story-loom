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
  /** When true, the desktop shell may run rolling backups on a schedule. */
  scheduleEnabled?: boolean;
  /** How many mirrored backup folders to keep (default 14). */
  retentionCount?: number;
  /** ISO time of the last rolling backup written to the mirror. */
  lastScheduledBackupAt?: string | null;
}

export const DEFAULT_MIRROR_RETENTION = 14;

function fromEnv(): string | null {
  const raw = process.env.WORDLY_BACKUP_MIRROR_DIR?.trim();
  return raw ? path.resolve(raw) : null;
}

function normalizeSettings(parsed: Record<string, unknown>, mirrorDir: string | null): BackupMirrorSettings {
  const scheduleEnabled = parsed.scheduleEnabled === true;
  const rawRetention = parsed.retentionCount;
  const retentionCount =
    typeof rawRetention === "number" && Number.isInteger(rawRetention) && rawRetention >= 1 && rawRetention <= 365
      ? rawRetention
      : DEFAULT_MIRROR_RETENTION;
  const lastScheduledBackupAt =
    typeof parsed.lastScheduledBackupAt === "string" && parsed.lastScheduledBackupAt.trim()
      ? parsed.lastScheduledBackupAt.trim()
      : null;
  return { mirrorDir, scheduleEnabled, retentionCount, lastScheduledBackupAt };
}

function readFileSettings(): BackupMirrorSettings {
  const file = settingsFile();
  if (!existsSync(file)) {
    return { mirrorDir: null, scheduleEnabled: false, retentionCount: DEFAULT_MIRROR_RETENTION, lastScheduledBackupAt: null };
  }
  try {
    const parsed = parseJsonObject(readFileSync(file, "utf8"));
    const mirrorDir =
      typeof parsed.mirrorDir === "string" && parsed.mirrorDir.trim() ? path.resolve(parsed.mirrorDir.trim()) : null;
    return normalizeSettings(parsed, mirrorDir);
  } catch {
    return { mirrorDir: null, scheduleEnabled: false, retentionCount: DEFAULT_MIRROR_RETENTION, lastScheduledBackupAt: null };
  }
}

export function loadBackupMirrorSettings(): BackupMirrorSettings {
  const env = fromEnv();
  const file = readFileSettings();
  if (env) return { ...file, mirrorDir: env };
  return file;
}

export function validateMirrorDir(input: string): { ok: true; path: string } | { ok: false; message: string } {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, message: "Enter a folder path." };
  const resolved = path.resolve(trimmed);
  if (resolved.length > 260) return { ok: false, message: "That path is too long." };
  return { ok: true, path: resolved };
}

export function validateRetentionCount(input: number): { ok: true; value: number } | { ok: false; message: string } {
  if (!Number.isInteger(input) || input < 1 || input > 365) {
    return { ok: false, message: "Keep between 1 and 365 mirrored backups." };
  }
  return { ok: true, value: input };
}

export function saveBackupMirrorSettings(
  mirrorDir: string | null,
  partial: Partial<Omit<BackupMirrorSettings, "mirrorDir">> = {},
): BackupMirrorSettings {
  const current = readFileSettings();
  const next = normalizeSettings(
    {
      ...current,
      ...partial,
      mirrorDir,
    },
    mirrorDir,
  );
  mkdirSync(settingsDir(), { recursive: true });
  writeFileSync(settingsFile(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export function backupMirrorSettingsPath(): string {
  return settingsFile();
}