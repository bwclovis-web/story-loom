import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { pruneMirrorBackups } from "@/server/backupMirrorPrune";

describe("pruneMirrorBackups", () => {
  it("keeps the newest retention folders and removes older ones", () => {
    const root = mkdtempSync(path.join(tmpdir(), "wordly-prune-"));
    const names = [
      "2026-01-01T12-00-00-000Z",
      "2026-01-02T12-00-00-000Z",
      "2026-01-03T12-00-00-000Z",
      "2026-01-04T12-00-00-000Z",
    ];
    for (const name of names) {
      const dir = path.join(root, name);
      mkdirSync(dir);
      writeFileSync(path.join(dir, "mirror-manifest.json"), "{}", "utf8");
    }
    const { kept, removed } = pruneMirrorBackups(root, 2);
    expect(kept).toEqual(["2026-01-04T12-00-00-000Z", "2026-01-03T12-00-00-000Z"]);
    expect(removed).toEqual(["2026-01-02T12-00-00-000Z", "2026-01-01T12-00-00-000Z"]);
    expect(existsSync(path.join(root, "2026-01-01T12-00-00-000Z"))).toBe(false);
    expect(existsSync(path.join(root, "2026-01-04T12-00-00-000Z"))).toBe(true);
  });
});