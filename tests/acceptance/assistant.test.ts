import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listSections } from "@/writing/sections";
import { ProviderError, type AssistantProvider, type ProviderEvent, type ProviderRequest } from "@/assistant/provider";
import { createProject, createWorkspace } from "@/server/services/projectService";
import { createRecord, updateRecord } from "@/server/services/recordService";
import {
  AssistantError,
  createConversation,
  deleteConversation,
  getConversationView,
  listConversations,
  prepareTurn,
  runTurn,
  usageSummary,
  type AssistantRuntime,
  type TurnInput,
  type TurnSelection,
} from "@/server/services/assistantService";
import { CHAPTER_PROSE, createTestDb, IDS, seedProject, snapshotState, type TestDb } from "../helpers";

/*
 * Assistant behavior with a scripted provider (no network, no paid calls).
 * Invented content only.
 */

const runtime: AssistantRuntime = {
  configured: true,
  model: "test-model",
  limits: { maxInputChars: 20_000, maxOutputTokens: 500, maxRequestsPerHour: 30, monthlyTokenCap: 1_000_000, requestTimeoutSeconds: 60 },
};

const OTHER = { workspace: "wsp_other", project: "prj_other_novel", record: "rec_other_secret" };

type Script = (request: ProviderRequest, signal: AbortSignal) => AsyncGenerator<ProviderEvent>;

function scripted(script: Script) {
  const requests: ProviderRequest[] = [];
  const provider: AssistantProvider = {
    stream(request, signal) {
      requests.push(request);
      return script(request, signal);
    },
    async structured() {
      throw new Error("not used in discussion tests");
    },
  };
  return { provider, requests };
}

const answers = (text: string, usage = { inputTokens: 100, outputTokens: 20, totalTokens: 120 }): Script =>
  async function* () {
    for (const piece of text.match(/.{1,5}/gs) ?? []) yield { type: "delta", text: piece };
    yield { type: "done", status: "complete", responseId: "resp_test", usage };
  };

const noSelection: TurnSelection = { references: [], manuscript: null, includeMessageIds: [] };

function ask(conversationId: string, question: string, selection: Partial<TurnSelection> = {}, projectId: string = IDS.project): TurnInput {
  return { kind: "ask", projectId, conversationId, question, selection: { ...noSelection, ...selection } };
}

async function expectAssistantError(promise: Promise<unknown>, code: string) {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(AssistantError);
  expect((error as AssistantError).code).toBe(code);
  return error as AssistantError;
}

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
  await seedProject(t.db);
  await createWorkspace(t.db, { id: OTHER.workspace, name: "Other workspace" });
  await createProject(t.db, { id: OTHER.project, workspaceId: OTHER.workspace, title: "Other novel" });
  await createRecord(t.db, OTHER.project, {
    recordId: OTHER.record,
    type: "worldbuilding",
    title: "Other secret",
    body: "Unrelated invented secret from another workspace.",
    authorityStatus: "approved",
  });
});

afterEach(async () => {
  await t.cleanup();
});

describe("assistant: configuration", () => {
  it("refuses to send when not configured and stores nothing", async () => {
    const conv = await createConversation(t.db, IDS.project);
    const { provider, requests } = scripted(answers("unused"));
    await expectAssistantError(
      prepareTurn(t.db, { ...runtime, configured: false, model: null }, ask(conv.id, "Hello?")),
      "NOT_CONFIGURED",
    );
    expect(requests).toHaveLength(0);
    expect(provider).toBeDefined();
    expect(await t.db.assistantMessage.count()).toBe(0);
  });
});

describe("assistant: context selection", () => {
  it("sends only the selected records, passage and earlier messages, and records the revisions used", async () => {
    const conv = await createConversation(t.db, IDS.project);
    const first = scripted(answers("First answer."));
    const turn1 = await prepareTurn(t.db, runtime, ask(conv.id, "Who is Mara?"));
    await runTurn(t.db, first.provider, turn1, new AbortController().signal);

    const before = await snapshotState(t.db);
    const start = CHAPTER_PROSE.indexOf("Mara Venn");
    const end = start + "Mara Venn knew this".length;
    const second = scripted(answers("Second answer."));
    const deltas: string[] = [];
    const turn2 = await prepareTurn(
      t.db,
      runtime,
      ask(conv.id, "What does the passage show?", {
        references: [{ recordId: IDS.dossier, revision: 1 }],
        manuscript: { recordId: IDS.chapter, revision: 1, passage: { start, end } },
        includeMessageIds: [turn1.assistantMessageId],
      }),
    );
    const result = await runTurn(t.db, second.provider, turn2, new AbortController().signal, (d) => deltas.push(d));

    expect(result.status).toBe("complete");
    expect(deltas.join("")).toBe("Second answer.");
    const sent = second.requests[0];
    expect(sent.model).toBe("test-model");
    expect(sent.maxOutputTokens).toBe(500);
    expect(sent.input.map((m) => m.role)).toEqual(["assistant", "user"]);
    expect(sent.input[0].content).toBe("First answer.");
    const final = sent.input[1].content;
    expect(final).toContain("Archivist. Thirty years old.");
    expect(final).toContain("Mara Venn knew this");
    expect(final).not.toContain("The ledger had been dry");
    expect(final).not.toContain("Salt Guild");
    expect(final).not.toContain("Unrelated invented secret");
    expect(final).not.toContain("Who is Mara?");

    const view = await getConversationView(t.db, IDS.project, conv.id, runtime.limits);
    const answer = view.messages.find((m) => m.id === turn2.assistantMessageId)!;
    expect(answer.content).toBe("Second answer.");
    expect(answer.includedMessageIds).toEqual([turn1.assistantMessageId]);
    expect(answer.totalTokens).toBe(120);
    expect(answer.usageEstimated).toBe(false);
    expect(answer.contextItems.map((c) => [c.recordId, c.kind, c.revisionNumber, c.passageStart, c.passageEnd])).toEqual([
      [IDS.dossier, "reference", 1, null, null],
      [IDS.chapter, "passage", 1, start, end],
    ]);
    expect(answer.basedOnOlderVersions).toBe(false);

    expect(await snapshotState(t.db)).toEqual(before);
  });

  it("refuses a selection that changed after it was made", async () => {
    const conv = await createConversation(t.db, IDS.project);
    await updateRecord(t.db, IDS.project, { recordId: IDS.dossier, expectedRevision: 1, body: "Archivist. Revised." });
    await expectAssistantError(
      prepareTurn(t.db, runtime, ask(conv.id, "Q", { references: [{ recordId: IDS.dossier, revision: 1 }] })),
      "STALE_SELECTION",
    );
    expect(await t.db.assistantMessage.count()).toBe(0);
  });

  it("refuses manuscript chapters in the reference list and passages outside the text", async () => {
    const conv = await createConversation(t.db, IDS.project);
    await expectAssistantError(
      prepareTurn(t.db, runtime, ask(conv.id, "Q", { references: [{ recordId: IDS.chapter, revision: 1 }] })),
      "INVALID_REQUEST",
    );
    await expectAssistantError(
      prepareTurn(t.db, runtime, ask(conv.id, "Q", { manuscript: { recordId: IDS.chapter, revision: 1, passage: { start: 5, end: 100_000 } } })),
      "INVALID_REQUEST",
    );
  });

  it("flags an answer once a record it used has a newer version", async () => {
    const conv = await createConversation(t.db, IDS.project);
    const { provider } = scripted(answers("About Mara."));
    const turn = await prepareTurn(t.db, runtime, ask(conv.id, "Q", { references: [{ recordId: IDS.dossier, revision: 1 }] }));
    await runTurn(t.db, provider, turn, new AbortController().signal);
    await updateRecord(t.db, IDS.project, { recordId: IDS.dossier, expectedRevision: 1, body: "Archivist. Revised." });

    const view = await getConversationView(t.db, IDS.project, conv.id, runtime.limits);
    const answer = view.messages.find((m) => m.id === turn.assistantMessageId)!;
    expect(answer.basedOnOlderVersions).toBe(true);
    expect(answer.contextItems[0]).toMatchObject({ revisionNumber: 1, currentRevision: 2, olderVersion: true });
  });
});

describe("assistant: sections of a long document", () => {
  const GUIDE_ID = "rec_series_guide";
  const guideBody = readFileSync(path.resolve(__dirname, "..", "fixtures", "markdown", "Saltmarsh_Annals_Series_Guide_CURRENT.md"), "utf8").replace(
    /\n/g,
    "\r\n",
  );

  beforeEach(async () => {
    await createRecord(t.db, IDS.project, {
      recordId: GUIDE_ID,
      type: "story_architecture",
      title: "Series Guide",
      body: guideBody,
      fields: { refIds: ["SA-GUIDE-001"] },
      authorityStatus: "approved",
    });
  });

  it("sends only the chosen sections, with their headings and in-text status, and retries the same text", async () => {
    const sections = listSections(guideBody);
    const rules = sections.find((s) => s.title.startsWith("1. Governing"))!;
    const bells = sections.find((s) => s.title.startsWith("1A."))!;
    const register = sections.find((s) => s.title.startsWith("3."))!;
    const conv = await createConversation(t.db, IDS.project);
    const first = scripted(answers("First."));
    const turn = await prepareTurn(
      t.db,
      runtime,
      ask(conv.id, "What is settled about the bells?", {
        references: [{ recordId: GUIDE_ID, revision: 1, sections: [bells.id, rules.id, register.id] }],
      }),
    );
    await runTurn(t.db, first.provider, turn, new AbortController().signal);
    const sent = first.requests[0].input.at(-1)!.content;
    expect(first.requests[0].instructions).toContain('statusMarkedInText="yes"');
    expect(sent).toContain('kind="section" statusMarkedInText="yes" sectionPath="Saltmarsh Annals — Series Guide > 1. Governing Rules [APPROVED FRAMEWORK]" sectionStatus="APPROVED FRAMEWORK"');
    expect(sent).toContain('sectionPath="Saltmarsh Annals — Series Guide > 3. Chapter Register [25 October 2026]"');
    expect(sent).not.toContain('sectionStatus="25 October 2026"');
    expect(sent).toContain("Exact count OPEN.");
    expect(sent).toContain("| SA-B1-C01 | The Low Tide | Draft |");
    expect(sent).not.toContain("Close third person");
    expect(sent.match(/Bells ring at slack water/g)).toHaveLength(1);
    expect(sent).not.toContain("Structured fields (JSON)");

    const items = await t.db.assistantContextItem.findMany({ where: { messageId: turn.assistantMessageId }, orderBy: { passageStart: "asc" } });
    expect(items.map((i) => [i.kind, i.passageStart, i.passageEnd])).toEqual([
      ["section", rules.start, rules.end],
      ["section", register.start, register.end],
    ]);

    await t.db.assistantMessage.update({ where: { id: turn.assistantMessageId }, data: { status: "failed" } });
    const again = scripted(answers("Retried."));
    const retry = await prepareTurn(t.db, runtime, { kind: "retry", projectId: IDS.project, conversationId: conv.id, messageId: turn.assistantMessageId });
    await runTurn(t.db, again.provider, retry, new AbortController().signal);
    const unbound = (s: string) => s.replace(/SOURCE-[0-9a-f]+/g, "SOURCE-x");
    expect(unbound(again.requests[0].input.at(-1)!.content)).toBe(unbound(sent));
  });

  it("marks a whole document whose headings carry status tags", async () => {
    const conv = await createConversation(t.db, IDS.project);
    const { provider, requests } = scripted(answers("Ok."));
    const turn = await prepareTurn(t.db, runtime, ask(conv.id, "Q", { references: [{ recordId: GUIDE_ID, revision: 1 }] }));
    await runTurn(t.db, provider, turn, new AbortController().signal);
    expect(requests[0].input.at(-1)!.content).toContain('status="approved (canon)" revision=1 kind="reference" statusMarkedInText="yes"');
    const dossier = await prepareTurn(t.db, runtime, ask((await createConversation(t.db, IDS.project)).id, "Q", { references: [{ recordId: IDS.dossier, revision: 1 }] }));
    expect(dossier.request.input.at(-1)!.content).not.toContain("statusMarkedInText");
  });

  it("refuses unknown sections and a document chosen both whole and in sections", async () => {
    const conv = await createConversation(t.db, IDS.project);
    const [first] = listSections(guideBody);
    await expectAssistantError(
      prepareTurn(t.db, runtime, ask(conv.id, "Q", { references: [{ recordId: GUIDE_ID, revision: 1, sections: ["doc-missing"] }] })),
      "INVALID_REQUEST",
    );
    await expectAssistantError(
      prepareTurn(
        t.db,
        runtime,
        ask(conv.id, "Q", {
          references: [
            { recordId: GUIDE_ID, revision: 1 },
            { recordId: GUIDE_ID, revision: 1, sections: [first.id] },
          ],
        }),
      ),
      "INVALID_REQUEST",
    );
    await expectAssistantError(
      prepareTurn(t.db, runtime, ask(conv.id, "Q", { references: [{ recordId: IDS.chapter, revision: 1, sections: [first.id] }] })),
      "INVALID_REQUEST",
    );
    expect(await t.db.assistantMessage.count()).toBe(0);
  });
});

describe("assistant: workspace isolation", () => {
  it("keeps conversations, records and messages inside their own workspace", async () => {
    const mine = await createConversation(t.db, IDS.project);
    const theirs = await createConversation(t.db, OTHER.project);
    expect((await t.db.assistantConversation.findUnique({ where: { id: theirs.id } }))?.workspaceId).toBe(OTHER.workspace);

    expect((await listConversations(t.db, IDS.project)).map((c) => c.id)).toEqual([mine.id]);
    await expectAssistantError(getConversationView(t.db, IDS.project, theirs.id, runtime.limits), "NOT_FOUND");
    await expectAssistantError(prepareTurn(t.db, runtime, ask(theirs.id, "Q")), "NOT_FOUND");
    await expectAssistantError(deleteConversation(t.db, IDS.project, theirs.id), "NOT_FOUND");

    await expectAssistantError(
      prepareTurn(t.db, runtime, ask(mine.id, "Q", { references: [{ recordId: OTHER.record, revision: 1 }] })),
      "INVALID_REQUEST",
    );

    const { provider } = scripted(answers("Other answer."));
    const otherTurn = await prepareTurn(t.db, runtime, ask(theirs.id, "Q", {}, OTHER.project));
    await runTurn(t.db, provider, otherTurn, new AbortController().signal);
    await expectAssistantError(
      prepareTurn(t.db, runtime, ask(mine.id, "Q", { includeMessageIds: [otherTurn.assistantMessageId] })),
      "INVALID_REQUEST",
    );
  });
});

describe("assistant: cancellation, failures and retry", () => {
  it("keeps the partial answer when cancelled, then retries with the same revisions", async () => {
    const conv = await createConversation(t.db, IDS.project);
    const controller = new AbortController();
    const { provider } = scripted(async function* (_req, signal) {
      yield { type: "delta", text: "Mara is" };
      if (signal.aborted) throw new ProviderError("cancelled", "x");
      await new Promise((_, reject) => signal.addEventListener("abort", () => reject(new ProviderError("cancelled", "x"))));
    });
    const turn = await prepareTurn(t.db, runtime, ask(conv.id, "Who?", { references: [{ recordId: IDS.dossier, revision: 1 }] }));
    const result = await runTurn(t.db, provider, turn, controller.signal, () => controller.abort());

    expect(result.status).toBe("cancelled");
    const stored = await t.db.assistantMessage.findUniqueOrThrow({ where: { id: turn.assistantMessageId } });
    expect(stored.content).toBe("Mara is");
    expect(stored.usageEstimated).toBe(true);
    expect(stored.totalTokens).toBeGreaterThan(0);

    await updateRecord(t.db, IDS.project, { recordId: IDS.dossier, expectedRevision: 1, body: "Archivist. Revised." });
    const again = scripted(answers("Retried."));
    const retry = await prepareTurn(t.db, runtime, { kind: "retry", projectId: IDS.project, conversationId: conv.id, messageId: turn.assistantMessageId });
    await runTurn(t.db, again.provider, retry, new AbortController().signal);

    expect(retry.userMessageId).toBe(turn.userMessageId);
    expect(again.requests[0].input.at(-1)!.content).toContain("Archivist. Thirty years old.");
    const view = await getConversationView(t.db, IDS.project, conv.id, runtime.limits);
    expect(view.messages.filter((m) => m.role === "user")).toHaveLength(1);
    const retried = view.messages.find((m) => m.id === retry.assistantMessageId)!;
    expect(retried.status).toBe("complete");
    expect(retried.basedOnOlderVersions).toBe(true);
  });

  it("stores provider failures with a clear message and no invented usage", async () => {
    const conv = await createConversation(t.db, IDS.project);
    const { provider } = scripted(async function* () {
      throw new ProviderError("rate_limit", "OpenAI rate limit or quota reached (429).", 429);
    });
    const turn = await prepareTurn(t.db, runtime, ask(conv.id, "Q"));
    const result = await runTurn(t.db, provider, turn, new AbortController().signal);
    expect(result).toMatchObject({ status: "failed", errorCode: "rate_limit" });
    const stored = await t.db.assistantMessage.findUniqueOrThrow({ where: { id: turn.assistantMessageId } });
    expect(stored.errorMessage).toContain("429");
    expect(stored.totalTokens).toBeNull();

    const midway = scripted(async function* () {
      yield { type: "delta", text: "Half an" };
      throw new ProviderError("connection", "Could not reach OpenAI.");
    });
    const turn2 = await prepareTurn(t.db, runtime, { kind: "retry", projectId: IDS.project, conversationId: conv.id, messageId: turn.assistantMessageId });
    expect(await runTurn(t.db, midway.provider, turn2, new AbortController().signal)).toMatchObject({ status: "failed", errorCode: "connection" });
    const partial = await t.db.assistantMessage.findUniqueOrThrow({ where: { id: turn2.assistantMessageId } });
    expect(partial.content).toBe("Half an");
    expect(partial.usageEstimated).toBe(true);
  });

  it("stores an answer cut at the output limit as incomplete", async () => {
    const conv = await createConversation(t.db, IDS.project);
    const { provider } = scripted(async function* () {
      yield { type: "delta", text: "Long" };
      yield { type: "done", status: "incomplete", incompleteReason: "max_output_tokens", usage: { inputTokens: 10, outputTokens: 500, totalTokens: 510 } };
    });
    const turn = await prepareTurn(t.db, runtime, ask(conv.id, "Q"));
    expect(await runTurn(t.db, provider, turn, new AbortController().signal)).toMatchObject({ status: "incomplete", errorCode: "max_output_tokens" });
  });

  it("allows one running answer per conversation and recovers interrupted ones", async () => {
    const conv = await createConversation(t.db, IDS.project);
    const now = new Date();
    await prepareTurn(t.db, runtime, ask(conv.id, "First"), now);
    await expectAssistantError(prepareTurn(t.db, runtime, ask(conv.id, "Second"), now), "BUSY");
    await expectAssistantError(deleteConversation(t.db, IDS.project, conv.id), "BUSY");

    const later = new Date(now.getTime() + (runtime.limits.requestTimeoutSeconds + 120) * 1000);
    const view = await getConversationView(t.db, IDS.project, conv.id, runtime.limits, later);
    expect(view.messages.at(-1)).toMatchObject({ status: "failed", errorCode: "interrupted" });
    await prepareTurn(t.db, runtime, ask(conv.id, "Second"), later);
  });
});

describe("assistant: limits", () => {
  it("refuses an oversize request with a breakdown and without sending or storing anything", async () => {
    const conv = await createConversation(t.db, IDS.project);
    await updateRecord(t.db, IDS.project, { recordId: IDS.world, expectedRevision: 1, body: "Salt. ".repeat(5000) });
    const { requests } = scripted(answers("unused"));
    const error = await expectAssistantError(
      prepareTurn(t.db, runtime, ask(conv.id, "Q", { references: [{ recordId: IDS.world, revision: 2 }] })),
      "TOO_LARGE",
    );
    expect(error.message).toMatch(/limit is 20,000/);
    expect(error.size?.items[0].label).toBe("The Salt Guild (rev 2)");
    expect(requests).toHaveLength(0);
    expect(await t.db.assistantMessage.count()).toBe(0);
  });

  it("enforces the hourly request limit and the monthly token cap", async () => {
    const conv = await createConversation(t.db, IDS.project);
    const { provider } = scripted(answers("Done.", { inputTokens: 900, outputTokens: 100, totalTokens: 1000 }));
    const turn = await prepareTurn(t.db, runtime, ask(conv.id, "Q"));
    await runTurn(t.db, provider, turn, new AbortController().signal);

    await expectAssistantError(
      prepareTurn(t.db, { ...runtime, limits: { ...runtime.limits, maxRequestsPerHour: 1 } }, ask(conv.id, "Q2")),
      "RATE_LIMITED",
    );
    const capped = await expectAssistantError(
      prepareTurn(t.db, { ...runtime, limits: { ...runtime.limits, monthlyTokenCap: 1500 } }, ask(conv.id, "Q2")),
      "USAGE_CAP",
    );
    expect(capped.message).toMatch(/estimate/);

    const usage = await usageSummary(t.db, runtime.limits);
    expect(usage.monthTokens).toBe(1000);
    expect(usage.requestsLastHour).toBe(1);
  });
});
