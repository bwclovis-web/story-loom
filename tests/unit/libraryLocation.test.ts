import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("library location and lock", () => {
  let dir: string;
  let previousLibrary: string | undefined;
  let previousCwd: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "storyloom-library-"));
    previousLibrary = process.env.WORDLY_LIBRARY_DIR;
    previousCwd = process.cwd();
    process.chdir(dir);
    delete process.env.WORDLY_LIBRARY_DIR;
  });

  afterEach(() => {
    process.chdir(previousCwd);
    if (previousLibrary === undefined) delete process.env.WORDLY_LIBRARY_DIR;
    else process.env.WORDLY_LIBRARY_DIR = previousLibrary;
    rmSync(dir, { recursive: true, force: true });
  });

  it("resolves storyloom.db under the library folder", async () => {
    const { saveLibrarySettings, libraryDatabasePath, loadLibrarySettings } = await import(
      "@/server/libraryLocation"
    );
    const libraryDir = path.join(dir, "novels");
    saveLibrarySettings(libraryDir);
    expect(loadLibrarySettings().libraryDir).toBe(path.resolve(libraryDir));
    expect(libraryDatabasePath()).toBe(path.join(path.resolve(libraryDir), "storyloom.db"));
  });

  it("writes and clears a lock for this instance", async () => {
    const {
      ensureLibraryDir,
      writeLibraryLock,
      clearLibraryLock,
      inspectLibraryLock,
      readLibraryLock,
    } = await import("@/server/libraryLocation");
    const libraryDir = path.join(dir, "lib");
    ensureLibraryDir(libraryDir);
    const id = "test-instance-1";
    expect(inspectLibraryLock(libraryDir, id).status).toBe("clear");
    writeLibraryLock(libraryDir, id);
    expect(inspectLibraryLock(libraryDir, id).status).toBe("ours");
    expect(readLibraryLock(libraryDir)?.appInstanceId).toBe(id);
    clearLibraryLock(libraryDir, id);
    expect(inspectLibraryLock(libraryDir, id).status).toBe("clear");
  });

  it("marks another instance as foreign", async () => {
    const { ensureLibraryDir, writeLibraryLock, inspectLibraryLock } = await import(
      "@/server/libraryLocation"
    );
    const libraryDir = path.join(dir, "shared");
    ensureLibraryDir(libraryDir);
    writeLibraryLock(libraryDir, "instance-a");
    expect(inspectLibraryLock(libraryDir, "instance-b").status).toBe("foreign");
  });
});
