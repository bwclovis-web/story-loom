import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const TSX_CLI = require.resolve("tsx/cli");
import { memoryGrantSource, type LocalGrant } from "@/mcp/grant";
import { createWordlyMcpServer } from "@/mcp/server";
import { applyChangePackage } from "@/server/services/changePackageService";
import { createProject } from "@/server/services/projectService";
import { createRecord, updateRecord } from "@/server/services/recordService";
import { CHAPTER_PROSE, createTestDb, IDS, makePackage, seedProject, type TestDb } from "../helpers";

const OTHER_PROJECT = "prj_test_otherbook";
const OTHER_RECORD = "rec_test_other_secret";
const OTHER_TITLE = "Harbour Ledger Secret";
const OTHER_BODY = "The other book keeps a private tide table.";
const LONG_RECORD = "rec_test_longexcerpt";
const TAIL = "TAIL-MARKER-NOT-IN-EXCERPT";
const OVERSIZE = "rec_test_oversize";
const OVERSIZE_MARKER = "OVERSIZE-MARKER";

function grantFor(projectIds: string[], patch: Partial<LocalGrant> = {}): LocalGrant {
  return {
    id: "grn_test",
    label: "Test grant",
    status: "active",
    projectIds,
    capabilities: ["read"],
    manuscriptRead: false,
    ...patch,
  };
}

interface Session {
  client: Client;
  current: { grant: LocalGrant };
  close: () => Promise<void>;
}

async function openSession(db: TestDb["db"], grant: LocalGrant): Promise<Session> {
  const current = { grant };
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createWordlyMcpServer({ db, grants: memoryGrantSource(current), disabled: () => false });
  const client = new Client({ name: "wordly-test", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    current,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content?: { type: string; text?: string }[];
  };
  const text = (result.content ?? []).map((item) => (item.type === "text" ? (item.text ?? "") : "")).join("\n");
  return { result, text, json: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

describe("read-only MCP adapter", () => {
  let t: TestDb;
  let session: Session;

  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
    session = await openSession(t.db, grantFor([IDS.project]));
  });

  afterEach(async () => {
    await session.close();
    await t.cleanup();
  });

  it("lists only granted projects and reads a reference without shortening it", async () => {
    const revisionsBefore = await t.db.revision.count();
    const listed = await call(session.client, "list_projects", {});
    expect(listed.result.isError).toBeFalsy();
    expect(listed.json.projects).toEqual([
      expect.objectContaining({ id: IDS.project, title: "Test novel", workspaceName: "Test workspace" }),
    ]);

    const found = await call(session.client, "search_references", { projectId: IDS.project, query: "SALT GUILD" });
    expect(found.result.isError).toBeFalsy();
    const matches = found.json.matches as { id: string; matchedIn: string; excerptTruncated: boolean }[];
    expect(matches.map((match) => match.id)).toEqual([IDS.world]);
    expect(matches[0]?.matchedIn).toBe("title");
    expect(matches[0]?.excerptTruncated).toBe(false);
    expect(found.json.manuscriptExcluded).toBe(true);

    const read = await call(session.client, "get_records", { projectId: IDS.project, recordIds: [IDS.dossier] });
    const records = read.json.records as { body: string; currentRevision: number }[];
    expect(records[0]?.body).toBe("Archivist. Thirty years old.");
    expect(records[0]?.currentRevision).toBe(1);
    expect(await t.db.revision.count()).toBe(revisionsBefore);
  });

  it("pages every search match and labels a shortened excerpt", async () => {
    const ids: string[] = [];
    for (let n = 1; n <= 25; n += 1) {
      const id = `rec_test_beacon_${String(n).padStart(2, "0")}`;
      ids.push(id);
      await createRecord(t.db, IDS.project, {
        recordId: id,
        type: "reference_note",
        title: `Beacon note ${n}`,
        body: `beacon signal ${n}`,
        authorityStatus: "draft",
      });
    }
    const body = `lanternwick ${"word ".repeat(80)}${TAIL}`;
    await createRecord(t.db, IDS.project, {
      recordId: LONG_RECORD,
      type: "reference_note",
      title: "Long note",
      body,
      authorityStatus: "draft",
    });

    const collected: string[] = [];
    let cursor: string | undefined;
    let total = 0;
    for (let page = 0; page < 6; page += 1) {
      const result = await call(session.client, "search_references", {
        projectId: IDS.project,
        query: "beacon signal",
        limit: 10,
        cursor,
      });
      expect(result.result.isError).toBeFalsy();
      const matches = result.json.matches as { id: string }[];
      const info = result.json.page as { total: number; complete: boolean; nextCursor: string | null; returned: number };
      total = info.total;
      collected.push(...matches.map((match) => match.id));
      expect(info.returned).toBe(matches.length);
      if (info.complete) {
        expect(info.nextCursor).toBeNull();
        break;
      }
      expect(info.nextCursor).toBeTruthy();
      cursor = info.nextCursor ?? undefined;
    }
    expect(total).toBe(25);
    expect(collected.sort()).toEqual(ids.sort());
    expect(new Set(collected).size).toBe(25);

    const excerpt = await call(session.client, "search_references", { projectId: IDS.project, query: "lanternwick" });
    const hit = (excerpt.json.matches as { id: string; excerpt: string; excerptTruncated: boolean }[]).find((match) => match.id === LONG_RECORD);
    expect(hit?.excerptTruncated).toBe(true);
    expect(hit?.excerpt).not.toContain(TAIL);
    const full = await call(session.client, "get_records", { projectId: IDS.project, recordIds: [LONG_RECORD] });
    expect(JSON.stringify(full.json)).toContain(TAIL);

    const refused = await call(session.client, "search_references", { projectId: IDS.project, query: "beacon", limit: 1000 });
    expect(refused.result.isError).toBe(true);
    expect(refused.json.error).toMatchObject({ code: "LIMIT_OUT_OF_RANGE" });
    expect(refused.text).not.toContain("beacon signal");

    const badCursor = await call(session.client, "search_references", { projectId: IDS.project, query: "beacon", cursor: "%%%" });
    expect(badCursor.result.isError).toBe(true);
    expect(badCursor.json.error).toMatchObject({ code: "INVALID_CURSOR" });
  });

  it("matches case-insensitively after Unicode normalisation", async () => {
    await createRecord(t.db, IDS.project, {
      recordId: "rec_test_cafe_note",
      type: "reference_note",
      title: "Cafe note",
      body: "The cafe\u0301 kept a blue lantern.",
      authorityStatus: "draft",
    });
    const found = await call(session.client, "search_references", { projectId: IDS.project, query: "café" });
    const hit = (found.json.matches as { id: string; excerpt: string }[]).find((match) => match.id === "rec_test_cafe_note");
    expect(hit?.excerpt).toContain("café");
  });

  it("refuses an oversized record instead of shortening it", async () => {
    await createRecord(t.db, IDS.project, {
      recordId: OVERSIZE,
      type: "reference_note",
      title: "Oversized note",
      body: `${OVERSIZE_MARKER}${"x".repeat(70_000)}`,
      authorityStatus: "draft",
    });
    const read = await call(session.client, "get_records", { projectId: IDS.project, recordIds: [OVERSIZE] });
    expect(read.result.isError).toBe(true);
    expect(read.json.error).toMatchObject({ code: "RESULT_TOO_LARGE" });
    expect(read.text).not.toContain(OVERSIZE_MARKER);
    const items = (read.json.error as { items: { id: string; chars: number }[] }).items;
    expect(items[0]?.id).toBe(OVERSIZE);
    expect(items[0]?.chars).toBeGreaterThan(60_000);

    const version = await call(session.client, "get_revision", { projectId: IDS.project, recordId: OVERSIZE, revision: 1 });
    expect(version.result.isError).toBe(true);
    expect(version.text).not.toContain(OVERSIZE_MARKER);

    const listed = await call(session.client, "list_revisions", { projectId: IDS.project, recordId: OVERSIZE });
    expect(listed.result.isError).toBeFalsy();
    expect(listed.text).not.toContain(OVERSIZE_MARKER);
  });

  it("reads a long document one section at a time, with in-text status, and never shortens a section", async () => {
    const guide = readFileSync(path.resolve(__dirname, "..", "fixtures", "markdown", "Saltmarsh_Annals_Series_Guide_CURRENT.md"), "utf8").replace(/\r\n/g, "\n");
    const big = `${guide}\n## 4. Appendix [WORKING PROPOSAL]\n\n${OVERSIZE_MARKER}${"y".repeat(65_000)}\n\n### 4A. Short note [OPEN]\n\nSmall.\n`;
    await createRecord(t.db, IDS.project, { recordId: "rec_test_guide", type: "story_architecture", title: "Guide", body: big, authorityStatus: "approved" });

    const listed = await call(session.client, "list_sections", { projectId: IDS.project, recordId: "rec_test_guide" });
    expect(listed.result.isError).toBeFalsy();
    expect(listed.text).not.toContain(OVERSIZE_MARKER);
    expect(listed.json.statusMarkedInText).toBe(true);
    const sections = listed.json.sections as { sectionId: string; parentId: string | null; title: string; statusTag: string | null; chars: number }[];
    const rules = sections.find((s) => s.title.startsWith("1. Governing"))!;
    const bells = sections.find((s) => s.title.startsWith("1A."))!;
    const appendix = sections.find((s) => s.title.startsWith("4."))!;
    expect(rules.statusTag).toBe("APPROVED FRAMEWORK");
    expect(bells).toMatchObject({ parentId: rules.sectionId, statusTag: "APPROVED / OPEN" });

    const read = await call(session.client, "get_section", { projectId: IDS.project, recordId: "rec_test_guide", sectionId: bells.sectionId });
    expect(read.result.isError).toBeFalsy();
    expect(read.json).toMatchObject({ authorityStatus: "approved", statusMarkedInText: true, statusTag: "APPROVED / OPEN" });
    expect(read.json.text).toBe("### 1A. SA-TIDE-001 — Tide Bells [APPROVED / OPEN]\n\nBells ring at slack water. Exact count OPEN.\n\n");
    expect((read.json.path as { statusTag: string | null }[]).map((p) => p.statusTag)).toEqual([null, "APPROVED FRAMEWORK", "APPROVED / OPEN"]);

    const tooBig = await call(session.client, "get_section", { projectId: IDS.project, recordId: "rec_test_guide", sectionId: appendix.sectionId });
    expect(tooBig.result.isError).toBe(true);
    expect(tooBig.json.error).toMatchObject({ code: "RESULT_TOO_LARGE" });
    expect(tooBig.text).not.toContain(OVERSIZE_MARKER);
    expect((tooBig.json.error as { items: { title: string }[] }).items.map((i) => i.title)).toEqual(["4A. Short note [OPEN]"]);

    const missing = await call(session.client, "get_section", { projectId: IDS.project, recordId: "rec_test_guide", sectionId: "doc-nope" });
    expect(missing.json.error).toMatchObject({ code: "SECTION_NOT_FOUND" });

    const chapter = await call(session.client, "list_sections", { projectId: IDS.project, recordId: IDS.chapter });
    expect(chapter.json.error).toMatchObject({ code: "MANUSCRIPT_NOT_PERMITTED" });
    expect(chapter.text).not.toContain(CHAPTER_PROSE.slice(0, 20));

    const whole = await call(session.client, "get_records", { projectId: IDS.project, recordIds: [IDS.dossier] });
    expect((whole.json.records as { statusMarkedInText: boolean }[])[0].statusMarkedInText).toBe(false);
  });

  it("pages saved versions and change history without dropping rows", async () => {
    for (let revision = 1; revision <= 4; revision += 1) {
      await updateRecord(t.db, IDS.project, {
        recordId: IDS.dossier,
        expectedRevision: revision,
        body: `Archivist. Revision ${revision + 1}.`,
      });
    }
    await applyChangePackage(t.db, makePackage({ operations: [
      {
        op: "update_record",
        recordId: IDS.dossier,
        expectedRevision: 5,
        changes: { body: { replace: "Archivist. After the package." } },
      },
    ] }), { projectId: IDS.project });

    const numbers: number[] = [];
    let cursor: string | undefined;
    let total = 0;
    for (let page = 0; page < 8; page += 1) {
      const result = await call(session.client, "list_revisions", { projectId: IDS.project, recordId: IDS.dossier, limit: 2, cursor });
      expect(result.result.isError).toBeFalsy();
      const info = result.json.page as { total: number; complete: boolean; nextCursor: string | null };
      total = info.total;
      numbers.push(...(result.json.revisions as { revisionNumber: number; body?: string }[]).map((row) => row.revisionNumber));
      expect(result.text).not.toContain("Archivist. After the package.");
      if (info.complete) break;
      cursor = info.nextCursor ?? undefined;
    }
    expect(total).toBe(numbers.length);
    expect(numbers).toEqual([6, 5, 4, 3, 2, 1]);

    const full = await call(session.client, "get_revision", { projectId: IDS.project, recordId: IDS.dossier, revision: 1 });
    expect(full.json.body).toBe("Archivist. Thirty years old.");
    const missing = await call(session.client, "get_revision", { projectId: IDS.project, recordId: IDS.dossier, revision: 99 });
    expect(missing.json.error).toMatchObject({ code: "REVISION_NOT_FOUND" });

    const auditIds: string[] = [];
    cursor = undefined;
    let auditTotal = 0;
    for (let page = 0; page < 20; page += 1) {
      const history = await call(session.client, "review_history", { projectId: IDS.project, limit: 2, auditCursor: cursor });
      expect(history.result.isError).toBeFalsy();
      const audit = history.json.audit as { items: { id: string; withheld?: string; summary?: string }[]; page: { total: number; complete: boolean; nextCursor: string | null } };
      auditTotal = audit.page.total;
      auditIds.push(...audit.items.map((item) => item.id));
      expect(history.text).not.toContain(CHAPTER_PROSE);
      expect(history.text).not.toContain('Manuscript chapter "Chapter 1"');
      if (audit.page.complete) break;
      cursor = audit.page.nextCursor ?? undefined;
    }
    expect(new Set(auditIds).size).toBe(auditTotal);
    expect(auditTotal).toBe(auditIds.length);

    const first = await call(session.client, "review_history", { projectId: IDS.project, limit: 20 });
    const packages = (first.json.packages as { items: { packageId: string; summary: string | null }[] }).items;
    expect(packages.some((item) => item.summary === "Approved dossier update")).toBe(true);
    const auditItems = (first.json.audit as { items: { withheld?: string }[] }).items;
    expect(auditItems.some((item) => item.withheld === "MANUSCRIPT_NOT_PERMITTED")).toBe(true);
  });

  it("keeps other projects, missing records, and manuscript text out of results", async () => {
    await createProject(t.db, { id: OTHER_PROJECT, workspaceId: IDS.workspace, title: "Other book" });
    await createRecord(t.db, OTHER_PROJECT, {
      recordId: OTHER_RECORD,
      type: "reference_note",
      title: OTHER_TITLE,
      body: OTHER_BODY,
      authorityStatus: "draft",
    });

    const listed = await call(session.client, "list_projects", {});
    expect(listed.text).not.toContain("Other book");
    const denied = await call(session.client, "search_references", { projectId: OTHER_PROJECT, query: "tide" });
    expect(denied.json.error).toMatchObject({ code: "PROJECT_NOT_PERMITTED" });
    expect(denied.text).not.toContain(OTHER_TITLE);
    expect(denied.text).not.toContain(OTHER_BODY);

    const missing = await call(session.client, "get_records", { projectId: IDS.project, recordIds: [OTHER_RECORD, "rec_test_missing1"] });
    expect(missing.result.isError).toBeFalsy();
    expect(missing.json.records).toEqual([]);
    expect(missing.json.missing).toEqual([
      { recordId: OTHER_RECORD, code: "RECORD_NOT_FOUND" },
      { recordId: "rec_test_missing1", code: "RECORD_NOT_FOUND" },
    ]);
    expect(missing.text).not.toContain(OTHER_BODY);

    const chapter = await call(session.client, "get_records", { projectId: IDS.project, recordIds: [IDS.chapter, IDS.dossier] });
    expect(chapter.result.isError).toBeFalsy();
    expect(chapter.json.denied).toEqual([{ recordId: IDS.chapter, code: "MANUSCRIPT_NOT_PERMITTED" }]);
    expect((chapter.json.records as { id: string }[]).map((record) => record.id)).toEqual([IDS.dossier]);
    expect(chapter.text).not.toContain(CHAPTER_PROSE);

    const versions = await call(session.client, "list_revisions", { projectId: IDS.project, recordId: IDS.chapter });
    expect(versions.json.error).toMatchObject({ code: "MANUSCRIPT_NOT_PERMITTED" });
    expect(versions.text).not.toContain(CHAPTER_PROSE);

    const proseSearch = await call(session.client, "search_references", { projectId: IDS.project, query: "three hundred years" });
    expect(proseSearch.text).not.toContain(CHAPTER_PROSE);
    expect((proseSearch.json.matches as { id: string }[]).map((match) => match.id)).not.toContain(IDS.chapter);

    const asked = await call(session.client, "search_references", {
      projectId: IDS.project,
      query: "ledger",
      types: ["manuscript_chapter"],
    });
    expect(asked.json.error).toMatchObject({ code: "MANUSCRIPT_NOT_PERMITTED" });

    session.current.grant = grantFor([IDS.project], { manuscriptRead: true });
    const allowed = await call(session.client, "get_records", { projectId: IDS.project, recordIds: [IDS.chapter] });
    expect((allowed.json.records as { body: string }[])[0]?.body).toBe(CHAPTER_PROSE);
  });

  it("refuses a revoked grant and a grant without read permission on the next call", async () => {
    session.current.grant = grantFor([IDS.project], { status: "revoked" });
    const revoked = await call(session.client, "list_projects", {});
    expect(revoked.json.error).toMatchObject({ code: "GRANT_REVOKED" });
    expect(revoked.text).not.toContain("Test novel");

    session.current.grant = grantFor([IDS.project], { capabilities: [] as unknown as ["read"] });
    const blocked = await call(session.client, "get_records", { projectId: IDS.project, recordIds: [IDS.dossier] });
    expect(blocked.json.error).toMatchObject({ code: "CAPABILITY_DENIED" });
    expect(blocked.text).not.toContain("Thirty years");

    const tooMany = await call(session.client, "get_records", {
      projectId: IDS.project,
      recordIds: Array.from({ length: 11 }, (_, index) => `rec_test_extra_${index}`),
    });
    // The grant still cannot read, so the capability check wins.
    expect(tooMany.json.error).toMatchObject({ code: "CAPABILITY_DENIED" });

    session.current.grant = grantFor([IDS.project]);
    const overflow = await call(session.client, "get_records", {
      projectId: IDS.project,
      recordIds: Array.from({ length: 11 }, (_, index) => `rec_test_extra_${index}`),
    });
    expect(overflow.json.error).toMatchObject({ code: "TOO_MANY_RECORDS" });
    expect(overflow.text).not.toContain("Thirty years");

    const duplicate = await call(session.client, "get_records", { projectId: IDS.project, recordIds: [IDS.dossier, IDS.dossier] });
    expect(duplicate.json.error).toMatchObject({ code: "DUPLICATE_RECORD_ID" });
  });
});

describe("stdio protocol output", () => {
  it("writes only JSON-RPC on stdout and does not start when disabled or revoked", async () => {
    const diag = createStdioDiag("stdio-protocol");
    try {
      diag.phase("createTestDb:start");
      const t = await createTestDb();
      diag.phase("createTestDb:done");
      const dir = mkdtempSync(path.join(tmpdir(), "wordly-stdio-"));
      try {
        diag.phase("seedProject:start");
        await seedProject(t.db);
        diag.phase("seedProject:done");
        const grantPath = path.join(dir, "grant.json");
        writeFileSync(grantPath, JSON.stringify(grantFor([IDS.project])));
        const baseEnv = {
          ...process.env,
          DATABASE_URL: `file:${t.file.replace(/\\/g, "/")}`,
          WORDLY_MCP_GRANT_FILE: grantPath,
          WORDLY_MCP_DISABLED: "",
        };
        diag.phase("speak:start");
        const lines = await speak(baseEnv, [
          request(1, "initialize", {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name: "wordly-test", version: "0.0.0" },
          }),
          notify("notifications/initialized"),
          request(2, "tools/list"),
          request(3, "tools/call", { name: "list_projects", arguments: {} }),
        ], diag);
        diag.phase("speak:done");
        expect(lines.map((line) => JSON.parse(line) as { id?: number })).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: 1 }), expect.objectContaining({ id: 2 }), expect.objectContaining({ id: 3 })]),
        );
        const listed = JSON.parse(lines.find((line) => JSON.parse(line).id === 3) ?? "{}") as {
          result?: { isError?: boolean; content?: { text: string }[] };
        };
        expect(listed.result?.isError).toBeFalsy();
        expect(listed.result?.content?.[0]?.text).toContain("Test novel");
        expect(lines.join("\n")).not.toContain(CHAPTER_PROSE);
        for (const name of ["WORDLY_OPENAI_API_KEY", "OPENAI_API_KEY"]) {
          const secret = process.env[name];
          if (secret) expect(lines.join("\n")).not.toContain(secret);
        }

        diag.phase("disabled:start");
        const disabled = await exitOf({ ...baseEnv, WORDLY_MCP_DISABLED: "1" }, diag, "disabled");
        diag.phase("disabled:done");
        expect(disabled.code).not.toBe(0);
        expect(disabled.stdout).toBe("");

        writeFileSync(grantPath, JSON.stringify(grantFor([IDS.project], { status: "revoked" })));
        diag.phase("revoked:start");
        const revoked = await exitOf({ ...baseEnv, WORDLY_MCP_DISABLED: "" }, diag, "revoked");
        diag.phase("revoked:done");
        expect(revoked.code).not.toBe(0);
        expect(revoked.stdout).toBe("");
      } finally {
        diag.phase("cleanup:start");
        await t.cleanup();
        rmSync(dir, { recursive: true, force: true });
        diag.phase("cleanup:done");
      }
    } catch (error) {
      diag.note(`failure: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      diag.flush();
    }
  }, 45_000);
});

function request(id: number, method: string, params: Record<string, unknown> = {}): string {
  return `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
}

function notify(method: string): string {
  return `${JSON.stringify({ jsonrpc: "2.0", method })}\n`;
}

interface StdioDiag {
  phase: (name: string) => void;
  note: (message: string) => void;
  flush: () => void;
  snapshot: () => string;
}

function createStdioDiag(label: string): StdioDiag {
  const started = Date.now();
  const phases: { name: string; ms: number }[] = [];
  const notes: string[] = [];
  return {
    phase(name) {
      phases.push({ name, ms: Date.now() - started });
      process.stderr.write(`[mcp-stdio-diag ${label}] ${name} +${Date.now() - started}ms\n`);
    },
    note(message) {
      notes.push(message);
      process.stderr.write(`[mcp-stdio-diag ${label}] ${message}\n`);
    },
    flush() {
      const last = phases[phases.length - 1];
      process.stderr.write(
        `[mcp-stdio-diag ${label}] summary last=${last?.name ?? "(none)"} elapsed=${Date.now() - started}ms phases=${phases.map((p) => `${p.name}@${p.ms}`).join(",")}${notes.length ? ` notes=${notes.join(" | ")}` : ""}\n`,
      );
    },
    snapshot() {
      const last = phases[phases.length - 1];
      return `last=${last?.name ?? "(none)"} elapsed=${Date.now() - started}ms phases=${phases.map((p) => `${p.name}@${p.ms}`).join(",")}`;
    },
  };
}

function speak(env: NodeJS.ProcessEnv, messages: string[], diag?: StdioDiag): Promise<string[]> {
  diag?.phase("speak:spawn");
  const child = start(env);
  const lines: string[] = [];
  let buffer = "";
  let stderr = "";
  let settled = false;
  let exitCode: number | null | undefined;
  let exitSignal: NodeJS.Signals | null | undefined;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) if (part.trim()) lines.push(part);
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  return new Promise((resolve, reject) => {
    const detail = () =>
      `${diag?.snapshot() ?? ""}\nexitCode=${String(exitCode)} signal=${String(exitSignal)}\nstderr: ${stderr}\nstdout lines: ${lines.join(" | ")}`;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timer);
      diag?.phase("speak:fail");
      stopChild(child);
      reject(new Error(`${message}\n${detail()}`));
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timer);
      diag?.phase("speak:responses-ready");
      stopChild(child);
      resolve(lines);
    };
    const timer = setTimeout(() => fail(`stdio timed out. buffer=${buffer}`), 40_000);
    const poll = setInterval(() => {
      let ids: Set<number | undefined>;
      try {
        ids = new Set(lines.map((line) => (JSON.parse(line) as { id?: number }).id));
      } catch (error) {
        fail(error instanceof Error ? error.message : "stdout was not JSON");
        return;
      }
      if (ids.has(1) && ids.has(2) && ids.has(3)) finish();
    }, 50);
    child.on("exit", (code, signal) => {
      exitCode = code;
      exitSignal = signal;
      diag?.phase(`speak:child-exit code=${String(code)} signal=${String(signal)}`);
      if (!lines.some((line) => { try { return (JSON.parse(line) as { id?: number }).id === 3; } catch { return false; } })) {
        fail(`stdio exited ${code} before tools/call`);
      }
    });
    diag?.phase("speak:stdin-write");
    for (const message of messages) child.stdin.write(message);
  });
}

function exitOf(
  env: NodeJS.ProcessEnv,
  diag?: StdioDiag,
  label = "exitOf",
): Promise<{ code: number | null; stdout: string }> {
  diag?.phase(`${label}:spawn`);
  const child = start(env);
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.stdin.end();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      diag?.phase(`${label}:timeout`);
      stopChild(child);
      reject(
        new Error(
          `${label} child did not exit within 12s\n${diag?.snapshot() ?? ""}\nstderr: ${stderr}\nstdout: ${stdout}`,
        ),
      );
    }, 12_000);
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      diag?.phase(`${label}:exit code=${String(code)} signal=${String(signal)}`);
      if (stderr.trim()) diag?.note(`${label} stderr: ${stderr.trim().slice(0, 400)}`);
      resolve({ code, stdout });
    });
  });
}

/** Kill without waiting — shell/pnpm trees can ignore a single kill under load. */
function stopChild(child: ChildProcessWithoutNullStreams): void {
  try {
    child.stdin.end();
  } catch {
    /* ignore */
  }
  child.kill();
}

function start(env: NodeJS.ProcessEnv): ChildProcessWithoutNullStreams {
  // Spawn node+tsx directly (no shell/pnpm). Under suite load, `pnpm exec` with
  // shell:true often left a live grandchild after kill, so speak() waited forever
  // on exit and hit the Vitest 45s timeout without the speak 40s error.
  return spawn(process.execPath, [TSX_CLI, "scripts/mcp-stdio.ts"], {
    cwd: path.resolve(__dirname, "../.."),
    shell: false,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;
}
