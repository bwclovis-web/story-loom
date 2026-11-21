import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { mirrorFullBackupFolder } from "@/server/backupMirror";
import { loadBackupMirrorSettings, saveBackupMirrorSettings, validateMirrorDir } from "@/server/backupMirrorSettings";

describe("backup mirror settings", () => {
  const previous = process.env.WORDLY_BACKUP_MIRROR_DIR;
  afterEach(() => {
    if (previous === undefined) delete process.env.WORDLY_BACKUP_MIRROR_DIR;
    else process.env.WORDLY_BACKUP_MIRROR_DIR = previous;
    saveBackupMirrorSettings(null);
  });

  it("validates mirror paths", () => {
    const ok = validateMirrorDir(path.join(tmpdir(), "wordly-mirror-test"));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(path.isAbsolute(ok.path)).toBe(true);
  });

  it("copies a backup folder into the configured mirror directory", () => {
    const root = mkdtempSync(path.join(tmpdir(), "wordly-mirror-"));
    const source = path.join(root, "source-backup");
    const mirrorRoot = path.join(root, "mirror-root");
    saveBackupMirrorSettings(mirrorRoot);
    expect(loadBackupMirrorSettings().mirrorDir).toBe(mirrorRoot);

    mkdirSync(source, { recursive: true });
    writeFileSync(path.join(source, "dev.db"), "sqlite", "utf8");
    writeFileSync(path.join(source, "ws.wordly-backup.json"), "{}", "utf8");

    const outcome = mirrorFullBackupFolder(source);
    expect(outcome.mirrored).toBe(true);
    expect(outcome.destDir).toBe(path.join(mirrorRoot, "source-backup"));
    expect(existsSync(path.join(outcome.destDir!, "mirror-manifest.json"))).toBe(true);
    const manifest = JSON.parse(readFileSync(path.join(outcome.destDir!, "mirror-manifest.json"), "utf8")) as { sourceDir: string };
    expect(manifest.sourceDir).toBe(source);
  });
});