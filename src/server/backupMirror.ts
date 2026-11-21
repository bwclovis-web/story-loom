import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadBackupMirrorSettings } from "./backupMirrorSettings";

export interface BackupMirrorOutcome {
  mirrored: boolean;
  destDir: string | null;
  error: string | null;
}

/** Copy a full backup folder (from writeFullBackup) into the configured mirror directory. */
export function mirrorFullBackupFolder(sourceDir: string): BackupMirrorOutcome {
  const settings = loadBackupMirrorSettings();
  if (!settings.mirrorDir) return { mirrored: false, destDir: null, error: null };
  if (!existsSync(sourceDir)) {
    return { mirrored: false, destDir: null, error: `Backup folder not found: ${sourceDir}` };
  }
  const destDir = path.join(settings.mirrorDir, path.basename(sourceDir));
  try {
    mkdirSync(settings.mirrorDir, { recursive: true });
    cpSync(sourceDir, destDir, { recursive: true, force: true });
    writeFileSync(
      path.join(destDir, "mirror-manifest.json"),
      JSON.stringify(
        {
          mirroredAt: new Date().toISOString(),
          sourceDir,
          note: "Copy of a Story Loom full backup. Use pnpm db:verify-backup on this folder before trusting a restore.",
        },
        null,
        2,
      ),
      "utf8",
    );
    return { mirrored: true, destDir, error: null };
  } catch (error) {
    return { mirrored: false, destDir: null, error: (error as Error).message };
  }
}