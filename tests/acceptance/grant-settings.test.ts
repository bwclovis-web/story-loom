import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readGrantFile } from "@/mcp/grant";
import { readGrantSettings, saveGrantSettings } from "@/server/services/grantSettingsService";
import { trashProject } from "@/server/services/trashService";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";

describe("ChatGPT connection settings", () => {
  let t: TestDb;
  let dir: string;
  let env: Record<string, string>;
  let grantFile: string;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
    dir = mkdtempSync(path.join(tmpdir(), "wordly-grant-"));
    grantFile = path.join(dir, "mcp", "grant.json");
    env = { WORDLY_MCP_GRANT_FILE: grantFile };
  });
  afterEach(async () => {
    await t.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a read-only grant the adapter accepts, and turns it off without losing the projects", async () => {
    expect((await readGrantSettings(env, dir)).load).toMatchObject({ ok: false, reason: "missing" });

    const on = await saveGrantSettings(t.db, env, dir, { active: true, projectIds: [IDS.project], manuscriptRead: false });
    expect(on.ok).toBe(true);
    const loaded = await readGrantFile(grantFile);
    expect(loaded).toEqual({
      ok: true,
      grant: { id: "grn_local_app", label: "Set in Wordly Editor", status: "active", projectIds: [IDS.project], capabilities: ["read"], manuscriptRead: false },
    });

    await saveGrantSettings(t.db, env, dir, { active: false, projectIds: [IDS.project], manuscriptRead: true });
    const off = await readGrantFile(grantFile);
    expect(off.ok && [off.grant.status, off.grant.projectIds, off.grant.manuscriptRead]).toEqual(["revoked", [IDS.project], true]);
    expect(JSON.parse(readFileSync(grantFile, "utf8")).capabilities).toEqual(["read"]);
  });

  it("keeps the id and label of an existing grant", async () => {
    const custom = path.join(dir, "custom.json");
    writeFileSync(custom, JSON.stringify({ id: "grn_mine", label: "My grant", status: "revoked", projectIds: [], capabilities: ["read"] }));
    const customEnv = { WORDLY_MCP_GRANT_FILE: custom };
    await saveGrantSettings(t.db, customEnv, dir, { active: true, projectIds: [], manuscriptRead: false });
    const loaded = await readGrantFile(custom);
    expect(loaded.ok && [loaded.grant.id, loaded.grant.label, loaded.grant.status]).toEqual(["grn_mine", "My grant", "active"]);
  });

  it("refuses unknown or trashed projects and leaves an unreadable file alone", async () => {
    const unknown = await saveGrantSettings(t.db, env, dir, { active: true, projectIds: ["prj_not_here"], manuscriptRead: false });
    expect(unknown.ok).toBe(false);

    await trashProject(t.db, { projectId: IDS.project, actor: "author" });
    const trashed = await saveGrantSettings(t.db, env, dir, { active: true, projectIds: [IDS.project], manuscriptRead: false });
    expect(trashed.ok).toBe(false);
    expect((await readGrantSettings(env, dir)).load).toMatchObject({ ok: false, reason: "missing" });

    const broken = path.join(dir, "broken.json");
    writeFileSync(broken, '{"id": "grn_x", "capabilities": ["write"]');
    const result = await saveGrantSettings(t.db, { WORDLY_MCP_GRANT_FILE: broken }, dir, { active: false, projectIds: [], manuscriptRead: false });
    expect(result.ok).toBe(false);
    expect(readFileSync(broken, "utf8")).toBe('{"id": "grn_x", "capabilities": ["write"]');
  });
});
