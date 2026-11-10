import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { parseGrant, readGrantFile } from "@/mcp/grant";
import { decodeCursor, encodeCursor } from "@/mcp/cursor";
import { inspectAdapter, inspectAssistant } from "@/mcp/status";
import { createTestDb, IDS, seedProject } from "../helpers";

describe("local grant file", () => {
  it("accepts a read-only grant and keeps manuscript access off when omitted", () => {
    const loaded = parseGrant(
      JSON.stringify({
        id: "grn_local_dev",
        label: "Local development",
        status: "active",
        projectIds: [IDS.project],
        capabilities: ["read"],
      }),
    );
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.grant.capabilities).toEqual(["read"]);
    expect(loaded.grant.manuscriptRead).toBe(false);
  });

  it("rejects write capabilities, duplicates, and extra fields", () => {
    const write = parseGrant(
      JSON.stringify({
        id: "grn_local_dev",
        label: "Local development",
        status: "active",
        projectIds: [IDS.project],
        capabilities: ["prepare"],
      }),
    );
    expect(write.ok).toBe(false);
    if (!write.ok) expect(write.problems.join(" ")).toContain('["read"]');

    const duplicate = parseGrant(
      JSON.stringify({
        id: "grn_local_dev",
        label: "Local development",
        status: "active",
        projectIds: [IDS.project, IDS.project],
        capabilities: ["read"],
        manuscriptRead: false,
      }),
    );
    expect(duplicate.ok).toBe(false);

    const extra = parseGrant(
      JSON.stringify({
        id: "grn_local_dev",
        label: "Local development",
        status: "active",
        projectIds: [],
        capabilities: ["read"],
        apply: true,
      }),
    );
    expect(extra.ok).toBe(false);
  });

  it("reads a revoked grant as revoked and refuses a file that is too large", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "wordly-grant-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const revokedPath = path.join(dir, "revoked.json");
    writeFileSync(
      revokedPath,
      JSON.stringify({
        id: "grn_local_dev",
        label: "Local development",
        status: "revoked",
        projectIds: [IDS.project],
        capabilities: ["read"],
        manuscriptRead: false,
      }),
    );
    const revoked = await readGrantFile(revokedPath);
    expect(revoked.ok).toBe(true);
    if (revoked.ok) expect(revoked.grant.status).toBe("revoked");

    const hugePath = path.join(dir, "huge.json");
    writeFileSync(hugePath, `{"id":"${"x".repeat(70_000)}"}`);
    const huge = await readGrantFile(hugePath);
    expect(huge.ok).toBe(false);
    if (!huge.ok) expect(huge.problems.join(" ")).toContain("was not read");

    const missing = await readGrantFile(path.join(dir, "missing.json"));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toBe("missing");
  });
});

describe("result cursors", () => {
  it("round-trips a row token and rejects a cursor that was not issued", () => {
    expect(decodeCursor(encodeCursor("rec_test_mara_dossier"))).toBe("rec_test_mara_dossier");
    expect(() => decodeCursor("not-a-cursor")).toThrow(/cursor/i);
  });
});

describe("connection status", () => {
  it("does not call the assistant configured when no request was sent", () => {
    const missing = inspectAssistant({});
    expect(missing.state).toBe("not_configured");
    expect(missing.notChecked.join(" ")).toContain("No request was sent");

    const present = inspectAssistant({ WORDLY_OPENAI_API_KEY: "sk-test-secret", OPENAI_MODEL: "test-model" });
    expect(present.state).toBe("connection_not_verified");
    expect(JSON.stringify(present)).not.toContain("sk-test-secret");
    expect(present.checked.join(" ")).toContain("test-model");
  });

  it("marks the local adapter ready only after a tool list and list_projects, and never marks ChatGPT connected", async () => {
    const t = await createTestDb();
    try {
      await seedProject(t.db);
      const dir = mkdtempSync(path.join(tmpdir(), "wordly-status-"));
      onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
      const grantPath = path.join(dir, "grant.json");
      writeFileSync(
        grantPath,
        JSON.stringify({
          id: "grn_local_dev",
          label: "Local development",
          status: "active",
          projectIds: [IDS.project],
          capabilities: ["read"],
          manuscriptRead: false,
        }),
      );
      const env = { WORDLY_MCP_GRANT_FILE: grantPath };
      const ready = await inspectAdapter(t.db, env, dir);
      expect(ready.local.state).toBe("local_adapter_ready");
      expect(ready.chatgpt.state).toBe("connection_not_verified");
      expect(ready.projects.map((project) => project.title)).toEqual(["Test novel"]);
      expect(ready.local.checked.join(" ")).toContain("list_projects");
      expect(ready.chatgpt.notChecked.join(" ")).toContain("ChatGPT was not contacted");
      expect(JSON.stringify(ready)).not.toContain("The ledger had been dry");

      const disabled = await inspectAdapter(t.db, { ...env, WORDLY_MCP_DISABLED: "1" }, dir);
      expect(disabled.local.state).toBe("disabled");
      expect(disabled.chatgpt.state).toBe("disabled");
      expect(disabled.projects).toEqual([]);

      const missing = await inspectAdapter(t.db, { WORDLY_MCP_GRANT_FILE: path.join(dir, "absent.json") }, dir);
      expect(missing.local.state).toBe("not_configured");
      expect(missing.chatgpt.state).toBe("not_configured");
    } finally {
      await t.cleanup();
    }
  });
});
