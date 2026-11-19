import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AssistantProvider, ProviderEvent, ProviderRequest, StructuredResult } from "@/assistant/provider";
import { sha256, stableStringify } from "@/domain/json";
import type { WorkspaceBackupV1 } from "@/backup/format.v1";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "@/server/services/backupService";
import {
  addDictionaryEntries,
  addDictionaryEntry,
  DictionaryError,
  dictionaryForExport,
  dictionaryWordsForProject,
  listDictionary,
  removeDictionaryEntry,
  suggestReferenceTerms,
  updateDictionaryEntry,
} from "@/server/services/dictionaryService";
import type { AssistantRuntime } from "@/server/services/assistantService";
import { prepareProofread, runProofread } from "@/server/services/proofreadService";
import { createProject, createWorkspace } from "@/server/services/projectService";
import { createRecord } from "@/server/services/recordService";
import { standardWordChecker } from "@/server/spellDictionaries";
import { createTestDb, IDS, seedProject, snapshotState, type TestDb } from "../helpers";

/*
 * The author's dictionary against a real (temporary) database. Invented
 * names only; proofreading uses scripted responses, never the network.
 */

const SIBLING = "prj_test_sequel";
const OTHER = { workspace: "wsp_other", project: "prj_other_novel" };
const isKnown = standardWordChecker("en-US");

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
  await seedProject(t.db);
  await createProject(t.db, { id: SIBLING, workspaceId: IDS.workspace, title: "Test sequel" });
  await createWorkspace(t.db, { id: OTHER.workspace, name: "Other workspace" });
  await createProject(t.db, { id: OTHER.project, workspaceId: OTHER.workspace, title: "Other novel" });
});

afterEach(async () => {
  await t.cleanup();
});

const words = async (projectId: string) => (await dictionaryWordsForProject(t.db, projectId)).map((w) => w.word);

async function expectError(promise: Promise<unknown>, code: DictionaryError["code"]) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DictionaryError);
  expect((error as DictionaryError).code).toBe(code);
}

describe("dictionary entries", () => {
  it("persist, can be edited and removed, and never touch records", async () => {
    const before = await snapshotState(t.db);
    const added = await addDictionaryEntry(t.db, IDS.project, { word: "Aldreth", caseSensitive: true, note: "the ferryman", scope: "project" }, "manual");
    expect(added).toMatchObject({ scope: "project", word: "Aldreth", caseSensitive: true, note: "the ferryman", origin: "manual" });

    const edited = await updateDictionaryEntry(t.db, IDS.project, added.id, { word: "Aldreth", caseSensitive: false, note: "", scope: "workspace" });
    expect(edited).toMatchObject({ scope: "workspace", caseSensitive: false, note: "" });
    expect((await listDictionary(t.db, IDS.project)).workspace.map((e) => e.word)).toEqual(["Aldreth"]);

    await removeDictionaryEntry(t.db, IDS.project, added.id);
    expect(await words(IDS.project)).toEqual([]);
    expect(await snapshotState(t.db)).toEqual(before);

    const audit = await t.db.auditEntry.findMany({ where: { action: { startsWith: "dictionary." } }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => a.action)).toEqual(["dictionary.add", "dictionary.update", "dictionary.remove"]);
  });

  it("keep project words to their book and share workspace words across the series only", async () => {
    await addDictionaryEntry(t.db, IDS.project, { word: "Aldreth", caseSensitive: true, scope: "project" }, "manual");
    await addDictionaryEntry(t.db, IDS.project, { word: "Vexmoor", caseSensitive: true, scope: "workspace" }, "manual");
    const foreign = await addDictionaryEntry(t.db, OTHER.project, { word: "Korrigane", caseSensitive: true, scope: "workspace" }, "manual");

    expect(await words(IDS.project)).toEqual(["Aldreth", "Vexmoor"]);
    expect(await words(SIBLING)).toEqual(["Vexmoor"]);
    expect(await words(OTHER.project)).toEqual(["Korrigane"]);

    // An entry from another workspace cannot be reached through this project.
    await expectError(updateDictionaryEntry(t.db, IDS.project, foreign.id, { word: "Korrigan", caseSensitive: true, scope: "project" }), "NOT_FOUND");
    await expectError(removeDictionaryEntry(t.db, IDS.project, foreign.id), "NOT_FOUND");
    expect(await words(OTHER.project)).toEqual(["Korrigane"]);

    const exported = await dictionaryForExport(t.db, IDS.project, "workspace");
    expect(exported).toEqual({ label: "Test workspace", entries: [{ word: "Vexmoor", caseSensitive: true, note: "" }] });
    expect((await dictionaryForExport(t.db, SIBLING, "project")).entries).toEqual([]);
  });

  it("reject duplicates but allow two exact capitalisations", async () => {
    await addDictionaryEntry(t.db, IDS.project, { word: "Aldreth", caseSensitive: true, scope: "workspace" }, "manual");
    await expectError(addDictionaryEntry(t.db, IDS.project, { word: "Aldreth", caseSensitive: true, scope: "project" }, "manual"), "DUPLICATE");
    await expectError(addDictionaryEntry(t.db, SIBLING, { word: "aldreth", caseSensitive: false, scope: "project" }, "manual"), "DUPLICATE");
    await addDictionaryEntry(t.db, IDS.project, { word: "ALDRETH", caseSensitive: true, scope: "project" }, "manual");
    await expectError(addDictionaryEntry(t.db, IDS.project, { word: "Aldreth Vexmoor", caseSensitive: true, scope: "project" }, "manual"), "INVALID");
    // The same word can be a project word in another workspace.
    await addDictionaryEntry(t.db, OTHER.project, { word: "Aldreth", caseSensitive: true, scope: "project" }, "manual");
  });

  it("add only the picked words from an import, listing what was skipped", async () => {
    await addDictionaryEntry(t.db, IDS.project, { word: "Aldreth", caseSensitive: true, scope: "project" }, "manual");
    const result = await addDictionaryEntries(
      t.db,
      IDS.project,
      "workspace",
      [
        { word: "Vexmoor", caseSensitive: true, note: "marsh city" },
        { word: "Aldreth", caseSensitive: true },
        { word: "two words", caseSensitive: false },
        { word: "vexmoor", caseSensitive: false },
      ],
      "import",
    );
    expect(result.added.map((a) => [a.word, a.scope, a.origin, a.note])).toEqual([["Vexmoor", "workspace", "import", "marsh city"]]);
    expect(result.skipped.map((s) => s.word)).toEqual(["Aldreth", "two words", "vexmoor"]);
    expect(result.skipped[0].message).toContain("project dictionary");
    expect(await words(IDS.project)).toEqual(["Aldreth", "Vexmoor"]);
    const audit = await t.db.auditEntry.findFirstOrThrow({ where: { action: "dictionary.import" } });
    expect(audit.summary).toContain("Added 1 word");
  });
});

describe("names from reference records", () => {
  it("suggests unknown words from reference titles, names and aliases, but adds nothing", async () => {
    await createRecord(t.db, IDS.project, {
      recordId: "rec_test_aldreth",
      type: "character_dossier",
      title: "Aldreth Vexmoor",
      body: "Ferryman. Mentions Quillmarsh in the body only.",
      fields: { name: "Aldreth Vexmoor", aliases: ["the Grey Korrigane", "Vex", "Tamsk"] },
      authorityStatus: "draft",
    });
    await createRecord(t.db, IDS.project, {
      recordId: "rec_test_ch02",
      type: "manuscript_chapter",
      title: "Zephrine",
      body: "Orvanne waited.",
      authorityStatus: "draft",
    });
    await addDictionaryEntry(t.db, IDS.project, { word: "Vexmoor", caseSensitive: true, scope: "workspace" }, "manual");
    const before = await t.db.dictionaryEntry.count();

    const found = await suggestReferenceTerms(t.db, IDS.project, isKnown);
    // "Vex" and "Grey" are ordinary words; "Vexmoor" is already accepted; body text and chapters are not read.
    expect(found.map((f) => f.word)).toEqual(["Aldreth", "Korrigane", "Tamsk"]);
    expect(found[0]).toMatchObject({ caseSensitive: true, sources: [{ recordId: "rec_test_aldreth", title: "Aldreth Vexmoor" }] });
    expect(await t.db.dictionaryEntry.count()).toBe(before);

    // Other projects' references are not suggested.
    expect(await suggestReferenceTerms(t.db, SIBLING, isKnown)).toEqual([]);
  });
});

describe("dictionary in backup and restore", () => {
  async function withEntries() {
    await addDictionaryEntry(t.db, IDS.project, { word: "Aldreth", caseSensitive: true, note: "ferryman", scope: "project" }, "manual");
    await addDictionaryEntry(t.db, IDS.project, { word: "glimmerfrost", caseSensitive: false, scope: "workspace" }, "editor");
  }

  it("round-trips entries into another database", async () => {
    await withEntries();
    const backup = await createWorkspaceBackup(t.db, IDS.workspace);
    expect(backup.counts.dictionaryEntries).toBe(2);
    expect(backup.dictionaryEntries?.map((e) => [e.word, e.projectId, e.caseSensitive, e.note, e.origin])).toEqual([
      ["Aldreth", IDS.project, true, "ferryman", "manual"],
      ["glimmerfrost", null, false, "", "editor"],
    ]);

    const target = await createTestDb();
    try {
      const outcome = await restoreWorkspaceBackup(target.db, JSON.stringify(backup), { idStrategy: "preserve" });
      expect(outcome.ok).toBe(true);
      expect(await dictionaryWordsForProject(target.db, IDS.project)).toEqual([
        { word: "Aldreth", caseSensitive: true },
        { word: "glimmerfrost", caseSensitive: false },
      ]);
      const again = await createWorkspaceBackup(target.db, IDS.workspace);
      expect(again.dictionaryEntries).toEqual(backup.dictionaryEntries);
    } finally {
      await target.cleanup();
    }
  });

  it("restores beside the original with new IDs and its own entries", async () => {
    await withEntries();
    const backup = await createWorkspaceBackup(t.db, IDS.workspace);
    const outcome = await restoreWorkspaceBackup(t.db, backup, { idStrategy: "remap" });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const copyProject = outcome.projects.find((p) => p.title === "Test novel")!.id;
    const copyEntries = await t.db.dictionaryEntry.findMany({ where: { workspaceId: outcome.workspaceId } });
    expect(copyEntries).toHaveLength(2);
    expect(copyEntries.find((e) => e.word === "Aldreth")!.projectId).toBe(copyProject);
    expect(copyEntries.some((e) => backup.dictionaryEntries!.some((o) => o.id === e.id))).toBe(false);

    // Removing a word in the copy leaves the original alone.
    const copied = (await listDictionary(t.db, copyProject)).project[0];
    await removeDictionaryEntry(t.db, copyProject, copied.id);
    expect(await words(IDS.project)).toEqual(["Aldreth", "glimmerfrost"]);
  });

  it("backs up a database that does not have the dictionary table yet", async () => {
    // What `pnpm db:deploy` does: back up the old database, then migrate it.
    await t.db.$executeRawUnsafe('DROP TABLE "DictionaryEntry"');
    const backup = await createWorkspaceBackup(t.db, IDS.workspace);
    expect(backup.dictionaryEntries).toEqual([]);
    expect(backup.counts.records).toBeGreaterThan(0);
  });

  it("restores older backups made before the dictionary existed, and rejects bad entries", async () => {
    await withEntries();
    const backup = await createWorkspaceBackup(t.db, IDS.workspace);
    const resign = (b: Omit<WorkspaceBackupV1, "checksum">): WorkspaceBackupV1 => ({ ...b, checksum: sha256(stableStringify(b)) });
    const { checksum: _c, dictionaryEntries: _d, ...older } = backup;
    const { dictionaryEntries: _n, ...olderCounts } = older.counts;

    const target = await createTestDb();
    try {
      const outcome = await restoreWorkspaceBackup(target.db, resign({ ...older, counts: olderCounts }), { idStrategy: "preserve" });
      expect(outcome.ok).toBe(true);
      expect(await dictionaryWordsForProject(target.db, IDS.project)).toEqual([]);

      const { checksum: _x, ...body } = backup;
      const bad = resign({ ...body, dictionaryEntries: body.dictionaryEntries!.map((e) => ({ ...e, word: "two words" })) });
      const rejected = await restoreWorkspaceBackup(target.db, bad, { idStrategy: "remap" });
      expect(rejected.ok).toBe(false);
      expect(await target.db.workspace.count()).toBe(1);
    } finally {
      await target.cleanup();
    }
  });
});

describe("dictionary words in AI proofreading", () => {
  const runtime: AssistantRuntime = {
    configured: true,
    model: "test-model",
    limits: { maxInputChars: 30_000, maxOutputTokens: 2_000, maxRequestsPerHour: 100, monthlyTokenCap: 10_000_000, requestTimeoutSeconds: 60, maxToolCalls: 12, maxToolRounds: 4, maxToolResultChars: 80_000 },
  };
  const CHAPTER = "Aldreth said teh ferry to Vexmoor was late. Aldrith waved.";

  function scripted(reply: unknown) {
    const calls: ProviderRequest[] = [];
    const provider: AssistantProvider = {
      // eslint-disable-next-line require-yield
      async *stream(): AsyncGenerator<ProviderEvent> {
        throw new Error("proofreading never streams");
      },
      async structured(request): Promise<StructuredResult> {
        calls.push(request);
        return { status: "complete", text: JSON.stringify(reply), responseId: "resp_dict", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
      },
    };
    return { provider, calls };
  }

  const suggestion = (original: string, replacement: string, before: string, after: string) => ({
    category: "spelling",
    before,
    original,
    after,
    replacement,
    explanation: "Invented explanation.",
  });

  it("sends the accepted words found in the text and leaves out changes to them", async () => {
    await createRecord(t.db, IDS.project, { recordId: "rec_test_ch03", type: "manuscript_chapter", title: "Chapter 3", body: CHAPTER, authorityStatus: "draft" });
    await addDictionaryEntry(t.db, IDS.project, { word: "Aldreth", caseSensitive: true, scope: "project" }, "manual");
    await addDictionaryEntry(t.db, IDS.project, { word: "Vexmoor", caseSensitive: true, scope: "workspace" }, "manual");
    await addDictionaryEntry(t.db, IDS.project, { word: "Korrigane", caseSensitive: true, scope: "workspace" }, "manual");
    await addDictionaryEntry(t.db, OTHER.project, { word: "Quillmarsh", caseSensitive: true, scope: "workspace" }, "manual");

    const { provider, calls } = scripted({
      suggestions: [
        suggestion("teh", "the", "Aldreth said ", " ferry"),
        suggestion("Vexmoor", "Vexmore", "ferry to ", " was late"),
        suggestion("Aldrith", "Aldreth", "late. ", " waved"),
      ],
    });
    const prep = await prepareProofread(t.db, runtime, { projectId: IDS.project, recordId: "rec_test_ch03", revision: 1, range: null });
    const result = await runProofread(t.db, provider, prep, new AbortController().signal);

    const sent = calls[0].input.map((m) => m.content).join("\n");
    expect(sent).toContain('Accepted spellings from the author\'s dictionary: "Aldreth" (match case), "Vexmoor" (match case)');
    expect(sent).not.toContain("Korrigane");
    expect(sent).not.toContain("Quillmarsh");

    // The similar but different name is still offered as a correction; the dictionary word is not changed.
    expect(result.suggestions.map((s) => s.original)).toEqual(["teh", "Aldrith"]);
    expect(result.rejected.map((r) => [r.original, r.reason])).toEqual([["Vexmoor", "dictionary_word"]]);
    const run = await t.db.proofreadRun.findUniqueOrThrow({ where: { id: prep.runId } });
    expect(run.dictionaryTermCount).toBe(2);
  });
});
