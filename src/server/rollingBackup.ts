import type { Db } from "./db";
import { databaseFilePath } from "./dbLocation";
import { writeFullBackup } from "./backupFiles";
import { loadBackupMirrorSettings, saveBackupMirrorSettings } from "./backupMirrorSettings";
import { pruneMirrorBackups } from "./backupMirrorPrune";

export type RollingBackupOutcome =
  | {
      ok: true;
      dir: string;
      mirrorDestDir: string | null;
      mirrorError: string | null;
      pruned: string[];
    }
  | {
      ok: false;
      message: string;
    };

export async function runRollingBackup(
  db: Db,
  options: { label?: string; databaseFile?: string } = {},
): Promise<RollingBackupOutcome> {
  const settings = loadBackupMirrorSettings();
  if (!settings.mirrorDir) {
    return { ok: false, message: "Set a backup mirror folder before running a rolling backup." };
  }
  const file = options.databaseFile ?? databaseFilePath();
  try {
    const result = await writeFullBackup(db, file, { label: options.label ?? "rolling" });
    const retention = settings.retentionCount ?? 14;
    const { removed } = pruneMirrorBackups(settings.mirrorDir, retention);
    saveBackupMirrorSettings(settings.mirrorDir, {
      scheduleEnabled: settings.scheduleEnabled,
      retentionCount: settings.retentionCount,
      lastScheduledBackupAt: new Date().toISOString(),
    });
    return {
      ok: true,
      dir: result.dir,
      mirrorDestDir: result.mirrorDestDir,
      mirrorError: result.mirrorError,
      pruned: removed,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}