"use server";

import { revalidatePath } from "next/cache";
import { errorIssue, type Issue } from "@/domain/issues";
import {
  loadBackupMirrorSettings,
  saveBackupMirrorSettings,
  validateMirrorDir,
} from "@/server/backupMirrorSettings";

export async function saveBackupMirrorDirAction(
  raw: string,
): Promise<{ ok: true; mirrorDir: string | null } | { ok: false; issues: Issue[] }> {
  if (process.env.WORDLY_BACKUP_MIRROR_DIR?.trim()) {
    return {
      ok: false,
      issues: [errorIssue("INVALID_CHANGE", "Clear WORDLY_BACKUP_MIRROR_DIR in .env before changing the mirror folder here.")],
    };
  }
  const trimmed = raw.trim();
  const current = loadBackupMirrorSettings();
  if (!trimmed) {
    saveBackupMirrorSettings(null, {
      scheduleEnabled: false,
      retentionCount: current.retentionCount,
      lastScheduledBackupAt: current.lastScheduledBackupAt,
    });
    revalidatePath("/backup");
    revalidatePath("/settings");
    return { ok: true, mirrorDir: null };
  }
  const check = validateMirrorDir(trimmed);
  if (!check.ok) return { ok: false, issues: [errorIssue("INVALID_CHANGE", check.message)] };
  saveBackupMirrorSettings(check.path, {
    scheduleEnabled: current.scheduleEnabled,
    retentionCount: current.retentionCount,
    lastScheduledBackupAt: current.lastScheduledBackupAt,
  });
  revalidatePath("/backup");
  revalidatePath("/settings");
  return { ok: true, mirrorDir: check.path };
}

export async function clearBackupMirrorDirAction(): Promise<
  { ok: true; mirrorDir: null } | { ok: false; issues: Issue[] }
> {
  if (process.env.WORDLY_BACKUP_MIRROR_DIR?.trim()) {
    return {
      ok: false,
      issues: [errorIssue("INVALID_CHANGE", "Clear WORDLY_BACKUP_MIRROR_DIR in .env to turn off the mirror.")],
    };
  }
  const current = loadBackupMirrorSettings();
  saveBackupMirrorSettings(null, {
    scheduleEnabled: false,
    retentionCount: current.retentionCount,
    lastScheduledBackupAt: current.lastScheduledBackupAt,
  });
  revalidatePath("/backup");
  revalidatePath("/settings");
  return { ok: true, mirrorDir: null };
}

export async function readBackupMirrorDirAction(): Promise<{ mirrorDir: string | null; fromEnv: boolean }> {
  const settings = loadBackupMirrorSettings();
  return { mirrorDir: settings.mirrorDir, fromEnv: Boolean(process.env.WORDLY_BACKUP_MIRROR_DIR?.trim()) };
}