import { spawn } from "node:child_process";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createTestDb, seedProject } from "../helpers";

describe("SQLite concurrency", () => {
  it("keeps delete journal mode and lets a second process read once a writer releases its lock", async () => {
    const t = await createTestDb();
    const writer = new Database(t.file);
    try {
      await seedProject(t.db);
      expect(writer.pragma("journal_mode", { simple: true })).toBe("delete");
      expect(writer.pragma("busy_timeout", { simple: true })).toBe(5000);

      const child = spawn(
        process.execPath,
        [
          "-e",
          `const Database = require("better-sqlite3");
           const db = new Database(process.env.WORDLY_TEST_DB);
           process.stdin.once("data", () => {
             const start = Date.now();
             try {
               const row = db.prepare("SELECT COUNT(*) AS n FROM Record").get();
               db.close();
               process.stdout.write(JSON.stringify({ n: Number(row.n), waited: Date.now() - start }));
               process.exit(0);
             } catch (error) {
               process.stderr.write(error instanceof Error ? error.message : "read failed");
               process.exit(1);
             }
           });
           process.stdout.write("ready\\n");`,
        ],
        { cwd: process.cwd(), env: { ...process.env, WORDLY_TEST_DB: t.file }, stdio: ["pipe", "pipe", "pipe"] },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));
      const readyAt = Date.now() + 5000;
      while (!stdout.includes("ready") && Date.now() < readyAt) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(stdout, stderr).toContain("ready");
      writer.exec("BEGIN EXCLUSIVE");
      child.stdin.write("go\n");
      child.stdin.end();
      await new Promise((resolve) => setTimeout(resolve, 300));
      writer.exec("COMMIT");
      const code = await exited;
      expect(code, stderr).toBe(0);
      const result = JSON.parse(stdout.slice(stdout.indexOf("{"))) as { n: number; waited: number };
      expect(result.n).toBeGreaterThan(0);
      expect(result.waited).toBeGreaterThanOrEqual(250);
      expect(writer.pragma("journal_mode", { simple: true })).toBe("delete");
      expect(await t.db.record.count()).toBe(result.n);
    } finally {
      writer.close();
      await t.cleanup();
    }
  });
});
