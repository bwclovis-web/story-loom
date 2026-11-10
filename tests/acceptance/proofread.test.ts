import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ProviderError,
  type AssistantProvider,
  type OutputSchema,
  type ProviderEvent,
  type ProviderRequest,
  type StructuredResult,
} from "@/assistant/provider";
import { normalizeNewlines } from "@/proofread/anchors";
import { acceptEdit, locateSuggestion, mapText } from "@/proofread/apply";
import { PROOFREAD_SCHEMA_NAME, type DraftSuggestion } from "@/proofread/output";
import { AssistantError, usageSummary, type AssistantRuntime } from "@/server/services/assistantService";
import { MutationRejectedError } from "@/server/services/errors";
import { prepareProofread, runProofread, type ProofreadResult } from "@/server/services/proofreadService";
import { createProject, createWorkspace } from "@/server/services/projectService";
import { createRecord, getRecord, getRevision, updateRecord } from "@/server/services/recordService";
import { applyEdit } from "@/writing/findReplace";
import { createTestDb, IDS, seedProject, snapshotState, type TestDb } from "../helpers";

/*
 * AI proofreading with scripted model responses (no network, no paid calls).
 * Invented content only.
 */

const runtime: AssistantRuntime = {
  configured: true,
  model: "test-model",
  limits: { maxInputChars: 30_000, maxOutputTokens: 2_000, maxRequestsPerHour: 100, monthlyTokenCap: 10_000_000, requestTimeoutSeconds: 60 },
};
const usage = { inputTokens: 500, outputTokens: 90, totalTokens: 590 };
const OTHER = { workspace: "wsp_other", project: "prj_other_novel", record: "rec_other_chapter" };
const CH2 = "rec_test_ch02_prose";

const CHAPTER =
  "Ines crossed the **salt** flats at dawn. She said teh tide was late.\r\n\r\n" +
  "\"Ain't no tide gonna wait,\" said old Brannoc of the Vell-Marsh. Teh tide was late again.\r\n\r\n" +
  "🌊 She recieved the café's ledger, *realy* worn, from [the archve](https://example.test/archve).";

type Reply = StructuredResult | Error | ((request: ProviderRequest, signal: AbortSignal) => Promise<StructuredResult>);

function scripted(...replies: Reply[]) {
  const calls: { request: ProviderRequest; schema: OutputSchema }[] = [];
  const provider: AssistantProvider = {
    // eslint-disable-next-line require-yield
    async *stream(): AsyncGenerator<ProviderEvent> {
      throw new Error("proofreading never streams");
    },
    async structured(request, schema, signal) {
      calls.push({ request, schema });
      const reply = replies.shift();
      if (!reply) throw new Error("no scripted reply left");
      if (reply instanceof Error) throw reply;
      return typeof reply === "function" ? reply(request, signal) : reply;
    },
  };
  return { provider, calls };
}

const s = (original: string, replacement: string, before = "", after = "", category: DraftSuggestion["category"] = "spelling"): DraftSuggestion => ({
  category,
  before,
  original,
  after,
  replacement,
  explanation: "Invented explanation.",
});
const json = (suggestions: unknown): StructuredResult => ({ status: "complete", text: JSON.stringify({ suggestions }), responseId: "resp_pr", usage });

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
  await seedProject(t.db);
  await createRecord(t.db, IDS.project, { recordId: CH2, type: "manuscript_chapter", title: "Chapter 2", body: CHAPTER, authorityStatus: "draft" });
  await createWorkspace(t.db, { id: OTHER.workspace, name: "Other workspace" });
  await createProject(t.db, { id: OTHER.project, workspaceId: OTHER.workspace, title: "Other novel" });
  await createRecord(t.db, OTHER.project, {
    recordId: OTHER.record,
    type: "manuscript_chapter",
    title: "Other chapter",
    body: "Teh other workspace's invented chapter.",
    authorityStatus: "draft",
  });
});

afterEach(async () => {
  await t.cleanup();
});

async function proofread(provider: AssistantProvider, range: { start: number; end: number } | null = null, recordId = CH2) {
  const prep = await prepareProofread(t.db, runtime, { projectId: IDS.project, recordId, revision: 1, range });
  return { prep, result: await runProofread(t.db, provider, prep, new AbortController().signal) };
}

/** What the editor does: accept the given suggestions one by one in the text box. */
function acceptAll(source: string, result: ProofreadResult, ids: string[]): string {
  let text = source;
  for (const id of ids) {
    const sug = result.suggestions.find((x) => x.id === id)!;
    const loc = locateSuggestion(source, text, mapText(source, text), sug, undefined);
    const edit = acceptEdit(loc, sug, true);
    if (!edit.ok) throw new Error(edit.message);
    text = applyEdit(text, edit.edit);
  }
  return text;
}

describe("proofreading requests", () => {
  it("sends only the chosen record's saved text and never writes records", async () => {
    const before = await snapshotState(t.db);
    const { provider, calls } = scripted(
      json([
        s("teh", "the", "She said ", " tide"),
        s("Teh", "The", "Vell-Marsh. ", " tide was late again."),
        s("recieved", "received", "🌊 She ", " the café's"),
        s("realy", "really", "*", "*"),
      ]),
    );
    const { prep, result } = await proofread(provider);

    expect(calls).toHaveLength(1);
    expect(calls[0].schema.name).toBe(PROOFREAD_SCHEMA_NAME);
    const sent = calls[0].request.input.map((m) => m.content).join("\n");
    expect(calls[0].request.input).toHaveLength(1);
    expect(sent).toContain(normalizeNewlines(CHAPTER));
    expect(sent).not.toContain("\r");
    for (const other of ["Archivist. Thirty years old.", "salt. Mara is a senior member", "The ledger had been dry", "Teh other workspace"]) {
      expect(sent).not.toContain(other);
    }
    expect(calls[0].request.maxOutputTokens).toBe(runtime.limits.maxOutputTokens);

    expect(result.status).toBe("complete");
    expect(result.recordId).toBe(CH2);
    expect(result.revision).toBe(1);
    expect(result.suggestions.map((x) => x.original)).toEqual(["teh", "Teh", "recieved", "realy"]);
    expect(result.rejected).toEqual([]);
    expect(await snapshotState(t.db)).toEqual(before);

    const run = await t.db.proofreadRun.findUniqueOrThrow({ where: { id: prep.runId } });
    expect(run).toMatchObject({
      workspaceId: IDS.workspace,
      projectId: IDS.project,
      recordId: CH2,
      revisionNumber: 1,
      mode: "proofread",
      scope: "document",
      status: "complete",
      totalTokens: 590,
      suggestionCount: 4,
      rejectedCount: 0,
    });
    expect(Object.keys(run)).not.toContain("text");
  });

  it("applies accepted suggestions through the normal save, keeping formatting, dialect and history", async () => {
    const { provider } = scripted(
      json([
        s("teh", "the", "She said ", " tide"),
        s("Ain't", "Isn't", "\"", " no tide", "grammar"),
        s("realy", "really", "*", "*"),
        s("archve", "archive", "[the ", "]("),
      ]),
    );
    const { result } = await proofread(provider);
    const source = normalizeNewlines(CHAPTER);
    const dialect = result.suggestions.find((x) => x.original === "Ain't")!;
    const accepted = result.suggestions.filter((x) => x !== dialect).map((x) => x.id);
    const edited = acceptAll(source, result, accepted);

    expect(edited).toContain("She said the tide was late.");
    expect(edited).toContain("\"Ain't no tide gonna wait,\"");
    expect(edited).toContain("*really* worn, from [the archive](https://example.test/archve).");
    expect(edited).toContain("**salt**");
    expect(edited.split("\n")).toHaveLength(source.split("\n").length);

    const unlockless = updateRecord(t.db, IDS.project, { recordId: CH2, expectedRevision: 1, title: "Chapter 2", body: edited, fields: {} });
    await expect(unlockless).rejects.toBeInstanceOf(MutationRejectedError);
    await unlockless.catch((e: MutationRejectedError) => expect(e.issues.map((i) => i.code)).toContain("PROTECTED_RECORD"));
    expect((await getRecord(t.db, IDS.project, CH2)).currentRevision).toBe(1);

    await updateRecord(t.db, IDS.project, { recordId: CH2, expectedRevision: 1, title: "Chapter 2", body: edited, fields: {}, unlockProtected: true });
    const saved = await getRecord(t.db, IDS.project, CH2);
    expect(saved.currentRevision).toBe(2);
    expect(saved.protected).toBe(true);
    expect(saved.body).toBe(edited);
    expect((await getRevision(t.db, CH2, 1))?.body).toBe(CHAPTER);
  });

  it("proofreads a protected record without unlocking it", async () => {
    const before = await getRecord(t.db, IDS.project, IDS.chapter);
    expect(before.protected).toBe(true);
    const { provider } = scripted(json([s("dry", "dried", "had been ", " for")]));
    const { result } = await proofread(provider, null, IDS.chapter);
    expect(result.status).toBe("complete");
    const after = await getRecord(t.db, IDS.project, IDS.chapter);
    expect(after).toEqual(before);
  });

  it("checks only the selected range and reports offsets in the whole text", async () => {
    const source = normalizeNewlines(CHAPTER);
    const start = source.indexOf("\"Ain't");
    const end = source.indexOf("🌊");
    const { provider, calls } = scripted(json([s("Teh", "The", "Marsh. ", " tide")]));
    const { result } = await proofread(provider, { start, end });
    const sent = calls[0].request.input[0].content;
    expect(sent).toContain(source.slice(start, end));
    expect(sent).not.toContain("Ines crossed");
    expect(sent).not.toContain("recieved");
    expect(result.scope).toBe("selection");
    expect(result.suggestions[0].start).toBe(source.lastIndexOf("Teh tide"));
  });

  it("reports suggestions that cannot be placed safely instead of dropping them", async () => {
    const { provider } = scripted(
      json([s("tide", "tides"), s("tide was late", "tide was late"), s("archve)", "archive)", "example.test/", ""), s("salt", "Salt **")]),
    );
    const { result, prep } = await proofread(provider);
    expect(result.status).toBe("complete");
    expect(result.suggestions).toEqual([]);
    expect(result.rejected.map((r) => r.reason)).toEqual(["ambiguous", "unchanged", "protected_markup", "formatting"]);
    expect((await t.db.proofreadRun.findUniqueOrThrow({ where: { id: prep.runId } })).rejectedCount).toBe(4);
  });
});

describe("proofreading failures", () => {
  it.each([
    ["not JSON", { status: "complete", text: "Sure! Here are fixes: teh -> the", usage } as StructuredResult],
    ["extra keys", json([{ ...s("teh", "the"), start: 10, approved: true }])],
    ["wrong category", json([{ ...s("teh", "the"), category: "style" }])],
    ["missing list", { status: "complete", text: JSON.stringify({ fixes: [] }), usage } as StructuredResult],
  ])("stores a malformed response (%s) as failed with no suggestions", async (_label, reply) => {
    const before = await snapshotState(t.db);
    const { provider } = scripted(reply);
    const { result, prep } = await proofread(provider);
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("malformed_output");
    expect(result.suggestions).toEqual([]);
    const run = await t.db.proofreadRun.findUniqueOrThrow({ where: { id: prep.runId } });
    expect(run.status).toBe("failed");
    expect(run.totalTokens).toBe(590);
    expect(await snapshotState(t.db)).toEqual(before);
  });

  it("treats a refusal as failed with no suggestions", async () => {
    const { provider } = scripted({ status: "refused", refusal: "I can't help with that.", usage });
    const { result } = await proofread(provider);
    expect(result).toMatchObject({ status: "failed", errorCode: "refused", suggestions: [] });
    expect(result.errorMessage).toContain("declined");
  });

  it("never uses a partial response that stopped at the output limit", async () => {
    const { provider } = scripted({ status: "incomplete", incompleteReason: "max_output_tokens", usage });
    const { result, prep } = await proofread(provider);
    expect(result).toMatchObject({ status: "incomplete", errorCode: "max_output_tokens", suggestions: [] });
    expect(result.errorMessage).toContain("shorter selection");
    expect((await t.db.proofreadRun.findUniqueOrThrow({ where: { id: prep.runId } })).status).toBe("incomplete");
  });

  it("stores provider errors and cancellations, with estimated usage for a cancel", async () => {
    const { provider } = scripted(new ProviderError("rate_limit", "OpenAI rate limit or quota reached (429)."));
    const failed = await proofread(provider);
    expect(failed.result).toMatchObject({ status: "failed", errorCode: "rate_limit" });

    const controller = new AbortController();
    const { provider: slow } = scripted(
      (_req, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new ProviderError("cancelled", "The request was cancelled.")));
        }),
    );
    const prep = await prepareProofread(t.db, runtime, { projectId: IDS.project, recordId: CH2, revision: 1, range: null });
    const pending = runProofread(t.db, slow, prep, controller.signal);
    controller.abort();
    const cancelled = await pending;
    expect(cancelled).toMatchObject({ status: "cancelled", errorCode: "cancelled", suggestions: [] });
    expect(cancelled.usage?.estimated).toBe(true);
    const run = await t.db.proofreadRun.findUniqueOrThrow({ where: { id: prep.runId } });
    expect(run.usageEstimated).toBe(true);
    expect(run.totalTokens).toBeGreaterThan(0);
  });
});

describe("proofreading limits and isolation", () => {
  it("refuses a record that was saved again since the page was loaded", async () => {
    await updateRecord(t.db, IDS.project, { recordId: CH2, expectedRevision: 1, title: "Chapter 2", body: "New text.", fields: {}, unlockProtected: true });
    const attempt = prepareProofread(t.db, runtime, { projectId: IDS.project, recordId: CH2, revision: 1, range: null });
    await expect(attempt).rejects.toMatchObject({ code: "STALE_SELECTION" });
    expect(await t.db.proofreadRun.count()).toBe(0);
  });

  it("keeps workspaces apart", async () => {
    const fromOther = prepareProofread(t.db, runtime, { projectId: IDS.project, recordId: OTHER.record, revision: 1, range: null });
    await expect(fromOther).rejects.toMatchObject({ code: "NOT_FOUND" });
    const intoOther = prepareProofread(t.db, runtime, { projectId: OTHER.project, recordId: CH2, revision: 1, range: null });
    await expect(intoOther).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await t.db.proofreadRun.count()).toBe(0);
  });

  it("validates the selection and refuses empty text", async () => {
    for (const range of [{ start: 5, end: 5 }, { start: -1, end: 4 }, { start: 0, end: 1_000_000 }, { start: 1.5, end: 4 }]) {
      await expect(prepareProofread(t.db, runtime, { projectId: IDS.project, recordId: CH2, revision: 1, range })).rejects.toMatchObject({
        code: "INVALID_REQUEST",
      });
    }
    const source = normalizeNewlines(CHAPTER);
    const blank = source.indexOf("\n\n");
    await expect(
      prepareProofread(t.db, runtime, { projectId: IDS.project, recordId: CH2, revision: 1, range: { start: blank, end: blank + 2 } }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("refuses when not configured, too large, busy, or over the shared limits", async () => {
    await expect(
      prepareProofread(t.db, { ...runtime, configured: false, model: null }, { projectId: IDS.project, recordId: CH2, revision: 1, range: null }),
    ).rejects.toMatchObject({ code: "NOT_CONFIGURED" });

    const tiny = { ...runtime, limits: { ...runtime.limits, maxInputChars: 1_000 } };
    const large = prepareProofread(t.db, tiny, { projectId: IDS.project, recordId: CH2, revision: 1, range: null });
    await expect(large).rejects.toMatchObject({ code: "TOO_LARGE" });
    await large.catch((e: AssistantError) => expect(e.size?.items.some((i) => i.label.includes("Chapter 2"))).toBe(true));

    await prepareProofread(t.db, runtime, { projectId: IDS.project, recordId: CH2, revision: 1, range: null });
    await expect(prepareProofread(t.db, runtime, { projectId: IDS.project, recordId: CH2, revision: 1, range: null })).rejects.toMatchObject({
      code: "BUSY",
    });

    const oneAnHour = { ...runtime, limits: { ...runtime.limits, maxRequestsPerHour: 1 } };
    await expect(
      prepareProofread(t.db, oneAnHour, { projectId: IDS.project, recordId: IDS.dossier, revision: 1, range: null }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect((await usageSummary(t.db, runtime.limits)).requestsLastHour).toBe(1);
  });

  it("counts proofreading tokens toward the monthly cap", async () => {
    const { provider } = scripted(json([]));
    await proofread(provider);
    const summary = await usageSummary(t.db, runtime.limits);
    expect(summary.monthTokens).toBe(590);
    const capped = { ...runtime, limits: { ...runtime.limits, monthlyTokenCap: 1_000 } };
    await expect(
      prepareProofread(t.db, capped, { projectId: IDS.project, recordId: IDS.dossier, revision: 1, range: null }),
    ).rejects.toMatchObject({ code: "USAGE_CAP" });
  });
});
