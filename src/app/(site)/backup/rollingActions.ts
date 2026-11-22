"use server";

import { revalidatePath } from "next/cache";
import { errorIssue, type Issue } from "@/domain/issues";
import { getDb } from "@/server/db";
import {
  loadBackupMirrorSettings,
  saveBackupMirrorSettings,
  validateMirrorDir,
  validateRetentionCount,
} from "@/server/backupMirrorSettings";
import { runRollingBackup } from "@/server/rollingBackup";

export type RollingFormResult = { ok: true; message: string } | { ok: false; issues: Issue[] };

export async function saveBackupScheduleAction(formData: FormData): Promise<RollingFormResult> {
  if (process.env.WORDLY_BACKUP_MIRROR_DIR?.trim()) {
    return {
      ok: false,
      issues: [errorIssue("INVALID_CHANGE", "Schedule is controlled alongside WORDLY_BACKUP_MIRROR_DIR in .env.")],
    };
  }
  const settings = loadBackupMirrorSettings();
  const enabled = formData.get("scheduleEnabled") === "1";
  const retentionRaw = Number(formData.get("retentionCount") ?? settings.retentionCount ?? 14);
  const retention = validateRetentionCount(retentionRaw);
  if (!retention.ok) return { ok: false, issues: [errorIssue("INVALID_CHANGE", retention.message)] };
  if (enabled && !settings.mirrorDir) {
    return {
      ok: false,
      issues: [errorIssue("INVALID_CHANGE", "Choose a mirror folder before enabling the rolling schedule.")],
    };
  }
  saveBackupMirrorSettings(settings.mirrorDir, {
    scheduleEnabled: enabled,
    retentionCount: retention.value,
    lastScheduledBackupAt: settings.lastScheduledBackupAt,
  });
  revalidatePath("/backup");
  revalidatePath("/settings");
  return {
    ok: true,
    message: enabled
      ? `Rolling schedule on (keep last ${retention.value} mirrors).`
      : `Rolling schedule off (still keeping ${retention.value} when you run a rolling backup).`,
  };
}

export async function runRollingBackupNowAction(): Promise<RollingFormResult> {
  const db = getDb();
  const outcome = await runRollingBackup(db);
  if (!outcome.ok) return { ok: false, issues: [errorIssue("INVALID_CHANGE", outcome.message)] };
  revalidatePath("/backup");
  const pruned = outcome.pruned.length
    ? ` Removed ${outcome.pruned.length} older mirror folder${outcome.pruned.length === 1 ? "" : "s"}.`
    : "";
  const mirrorNote = outcome.mirrorError ? ` Mirror warning: ${outcome.mirrorError}` : "";
  return {
    ok: true,
    message: `Rolling backup written under backups/ and mirrored.${pruned}${mirrorNote}`,
  };
}