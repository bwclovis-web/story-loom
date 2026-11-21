import { mkdtempSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFullBackup } from "@/server/backupFiles";
import { loadBackupMirrorSettings, saveBackupMirrorSettings } from "@/server/backupMirrorSettings";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";

describe("backup mirror on full backup", () => {
  let t: TestDb;
  let mirrorRoot: string;
  const previous = process.env.WORDLY_BACKUP_MIRROR_DIR;

  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
    const root = mkdtempSync(path.join(tmpdir(), "wordly-full-mirror-"));
    mirrorRoot = path.join(root, "cloud");
    saveBackupMirrorSettings(mirrorRoot);
  });

  afterEach(async () => {
    if (previous === undefined) delete process.env.WORDLY_BACKUP_MIRROR_DIR;
    else process.env.WORDLY_BACKUP_MIRROR_DIR = previous;
    saveBackupMirrorSettings(null);
    await t.cleanup();
  });

  it("writeFullBackup includes a mirror copy when configured", async () => {
    const backupsDir = mkdtempSync(path.join(tmpdir(), "wordly-backups-"));
    const result = await writeFullBackup(t.db, t.file, { backupsDir, label: "mirror-test" });
    expect(result.mirrorDestDir).toBeTruthy();
    expect(result.mirrorError).toBeNull();
    expect(loadBackupMirrorSettings().mirrorDir).toBe(mirrorRoot);
    const { existsSync } = await import("node:fs");
    expect(existsSync(path.join(result.mirrorDestDir!, path.basename(result.sqliteFile)))).toBe(true);
  });
});