import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROPOSAL_INSTRUCTIONS } from "@/assistant/prompt";
import { PROPOSAL_OUTPUT_JSON_SCHEMA, PROPOSAL_SCHEMA_NAME, type ProposalDraft } from "@/assistant/proposalOutput";
import {
  ProviderError,
  type AssistantProvider,
  type OutputSchema,
  type ProviderEvent,
  type ProviderRequest,
  type StructuredResult,
} from "@/assistant/provider";
import type { ChangePackageV1 } from "@/changePackage/schema.v1";
import {
  applyProposal,
  findSourceConversation,
  getProposalReview,
  listProposalViews,
  runProposalTurn,
} from "@/server/services/assistantProposalService";
import {
  AssistantError,
  createConversation,
  getConversationView,
  prepareTurn,
  runTurn,
  type AssistantRuntime,
  type TurnSelection,
} from "@/server/services/assistantService";
import { applyChangePackage, previewChangePackage } from "@/server/services/changePackageService";
import { createProject, createWorkspace } from "@/server/services/projectService";
import { createRecord, setProtection, updateRecord } from "@/server/services/recordService";
import { createTestDb, IDS, seedProject, snapshotState, type TestDb } from "../helpers";

/*
 * Assistant change proposals with scripted model responses (no network, no
 * paid calls). Invented content only.
 */

const runtime: AssistantRuntime = {
  configured: true,
  model: "test-model",
  limits: { maxInputChars: 30_000, maxOutputTokens: 2_000, maxRequestsPerHour: 100, monthlyTokenCap: 10_000_000, requestTimeoutSeconds: 60, maxToolCalls: 12, maxToolRounds: 4, maxToolResultChars: 80_000 },
};

const OTHER = { workspace: "wsp_other", project: "prj_other_novel", record: "rec_other_secret" };
const usage = { inputTokens: 300, outputTokens: 120, totalTokens: 420 };

type Reply = StructuredResult | Error | ((request: ProviderRequest, signal: AbortSignal) => Promise<StructuredResult>);

function scripted(...replies: Reply[]) {
  const calls: { request: ProviderRequest; schema: OutputSchema }[] = [];
  const provider: AssistantProvider = {
    // eslint-disable-next-line require-yield
    async *stream(): AsyncGenerator<ProviderEvent> {
      throw new Error("discussion replies are scripted separately");
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

function chatProvider(text: string): AssistantProvider {
  return {
    async *stream() {
      yield { type: "delta", text };
      yield { type: "done", status: "complete", usage };
    },
    async structured() {
      throw new Error("not a proposal");
    },
  };
}

const json = (value: unknown): StructuredResult => ({ status: "complete", text: JSON.stringify(value), responseId: "resp_p", usage });

function draft(operations: ProposalDraft["operations"], extra: Partial<ProposalDraft> = {}): ProposalDraft {
  return { summary: "Make Mara thirty-four.", operations, relatedRecords: [], fieldTextDisagreements: [], ...extra };
}

const ageUpdate: ProposalDraft["operations"][number] = {
  op: "update_record",
  recordId: IDS.dossier,
  title: null,
  body: "Archivist. Thirty-four years old.",
  setFields: [{ key: "age", valueJson: "34" }],
  unsetFields: [],
  authorityStatus: null,
  note: "Matches the age decision.",
};

const noSelection: TurnSelection = { references: [], manuscript: null, includeMessageIds: [] };
const refs = (...ids: string[]) => ids.map((recordId) => ({ recordId, revision: 1 }));

async function prepare(
  provider: AssistantProvider,
  request: string,
  selection: Partial<TurnSelection>,
  conversationId?: string,
  projectId: string = IDS.project,
) {
  const convId = conversationId ?? (await createConversation(t.db, projectId)).id;
  const turn = await prepareTurn(t.db, runtime, {
    kind: "ask",
    mode: "proposal",
    projectId,
    conversationId: convId,
    question: request,
    selection: { ...noSelection, ...selection },
  });
  const result = await runProposalTurn(t.db, provider, turn, new AbortController().signal);
  return { convId, turn, result };
}

async function proposalOf(convId: string, messageId: string, projectId: string = IDS.project) {
  const views = await listProposalViews(t.db, projectId, convId);
  return views[messageId];
}

async function recordState() {
  const s = await snapshotState(t.db);
  const audits = await t.db.auditEntry.count();
  return { ...s, audits };
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

describe("assistant proposals: discussion and approval", () => {
  it("never changes records during discussion, and a conversational yes approves nothing", async () => {
    const before = await recordState();
    const conv = await createConversation(t.db, IDS.project);
    const ask = (question: string) =>
      prepareTurn(t.db, runtime, { kind: "ask", projectId: IDS.project, conversationId: conv.id, question, selection: { ...noSelection, references: refs(IDS.dossier) } });
    await runTurn(t.db, chatProvider("I could make Mara 34. Shall I?"), await ask("Should Mara be older?"), new AbortController().signal);
    await runTurn(t.db, chatProvider("Understood."), await ask("Yes, do it. I approve."), new AbortController().signal);
    expect(await recordState()).toEqual(before);
    expect(await t.db.assistantProposal.count()).toBe(0);

    const { provider } = scripted(json(draft([ageUpdate])));
    const { result } = await prepare(provider, "Prepare the age change.", { references: refs(IDS.dossier) }, conv.id);
    await runTurn(t.db, chatProvider("Great."), await ask("Yes, apply it."), new AbortController().signal);

    expect(await recordState()).toEqual(before);
    const stored = await t.db.assistantProposal.findUniqueOrThrow({ where: { id: result.proposalId! } });
    expect(stored.status).toBe("proposed");
  });

  it("prepares a package with server-assigned metadata and applies it once, on explicit Apply", async () => {
    const { provider, calls } = scripted(
      json(
        draft(
          [
            ageUpdate,
            { op: "create_record", type: "reference_note", title: "Salt calendar", body: "Invented calendar notes.", fields: [{ key: "months", valueJson: "13" }], authorityStatus: "proposed", note: null },
          ],
          { relatedRecords: [{ recordId: IDS.world, note: "Mentions Mara; check her age is not stated." }] },
        ),
      ),
    );
    const before = await recordState();
    const { convId, turn, result } = await prepare(provider, "Make Mara 34 and note the salt calendar.", { references: refs(IDS.dossier, IDS.world) });

    expect(result).toMatchObject({ status: "complete", errorCode: null });
    expect(calls[0].schema).toEqual({ name: PROPOSAL_SCHEMA_NAME, schema: PROPOSAL_OUTPUT_JSON_SCHEMA });
    expect(calls[0].request.instructions).toContain(PROPOSAL_INSTRUCTIONS);
    expect(calls[0].request.input.at(-1)!.content).toContain("Author's request for a change proposal:\nMake Mara 34");
    expect(calls[0].request.input.at(-1)!.content).not.toContain("Unrelated invented secret");
    expect(await recordState()).toEqual(before);

    const row = await t.db.assistantProposal.findUniqueOrThrow({ where: { id: result.proposalId! } });
    const pkg = JSON.parse(row.packageJson) as ChangePackageV1;
    expect(pkg).toMatchObject({
      workspaceId: IDS.workspace,
      projectId: IDS.project,
      scope: "reference",
      protectedOverrides: [],
      approval: { status: "proposed" },
    });
    expect(pkg.packageId).toMatch(/^pkg_/);
    expect(pkg.source?.conversationLabel).toContain(row.id);
    expect(pkg.operations[0]).toMatchObject({ op: "update_record", recordId: IDS.dossier, expectedRevision: 1 });
    expect(pkg.operations[1]).toMatchObject({ op: "create_record", authorityStatus: "proposed" });
    expect((pkg.operations[1] as { newRecordId: string }).newRecordId).toMatch(/^rec_/);

    const view = await proposalOf(convId, turn.assistantMessageId);
    expect(view.status).toBe("proposed");
    expect(view.preview!.canApply).toBe(true);
    expect(view.preview!.operations[0].bodyChanged).toBe(true);
    expect(view.preview!.operations[0].bodyDiff.filter((p) => p.added).map((p) => p.value).join("")).toContain("four");
    expect(view.preview!.operations[0].fieldDiffs).toEqual([{ key: "age", change: "changed", before: 30, after: 34 }]);
    expect(view.canonChanges.map((c) => [c.recordId, c.reason])).toEqual([[IDS.dossier, "approved_content_changed"]]);

    const wrongHash = await applyProposal(t.db, { projectId: IDS.project, proposalId: row.id, contentHash: "0".repeat(64), confirmCanon: true });
    expect(wrongHash).toMatchObject({ status: "rejected", issues: [{ code: "PROPOSAL_MISMATCH" }] });
    const unconfirmed = await applyProposal(t.db, { projectId: IDS.project, proposalId: row.id, contentHash: row.contentHash, confirmCanon: false });
    expect(unconfirmed).toMatchObject({ status: "rejected", issues: [{ code: "CANON_CONFIRMATION_REQUIRED" }] });
    expect(await recordState()).toEqual(before);

    const applied = await applyProposal(t.db, { projectId: IDS.project, proposalId: row.id, contentHash: row.contentHash, confirmCanon: true });
    expect(applied.status).toBe("applied");
    if (applied.status !== "applied") return;
    expect(applied.result.changes.map((c) => [c.recordId, c.previousRevision, c.newRevision])).toEqual([
      [IDS.dossier, 1, 2],
      [(pkg.operations[1] as { newRecordId: string }).newRecordId, null, 1],
    ]);
    expect(applied.result.reviewItems.some((r) => r.recordId === IDS.world && r.origin === "package_note")).toBe(true);

    const dossier = await t.db.record.findUniqueOrThrow({ where: { id: IDS.dossier } });
    expect(dossier.currentRevision).toBe(2);
    expect(JSON.parse(dossier.fields)).toMatchObject({ age: 34 });
    const created = await t.db.record.findUniqueOrThrow({ where: { id: (pkg.operations[1] as { newRecordId: string }).newRecordId } });
    expect(created.authorityStatus).toBe("proposed");
    expect((await t.db.record.findUniqueOrThrow({ where: { id: IDS.world } })).currentRevision).toBe(1);

    const packageRow = await t.db.changePackage.findUniqueOrThrow({ where: { projectId_packageId: { projectId: IDS.project, packageId: pkg.packageId } } });
    const appliedPkg = JSON.parse(packageRow.rawJson) as ChangePackageV1;
    expect(appliedPkg.approval).toEqual({ status: "approved", statement: expect.stringContaining(row.id) });
    const source = await t.db.source.findUniqueOrThrow({ where: { id: applied.result.sourceId } });
    expect(source).toMatchObject({ kind: "change_package", packageId: pkg.packageId });
    expect(source.conversationLabel).toContain(row.id);
    const audit = await t.db.auditEntry.findUniqueOrThrow({ where: { id: applied.result.auditEntryId } });
    expect(audit).toMatchObject({ action: "package.apply", packageId: pkg.packageId });

    const afterApply = await recordState();
    const again = await applyProposal(t.db, { projectId: IDS.project, proposalId: row.id, contentHash: row.contentHash, confirmCanon: true });
    expect(again.status).toBe("already_applied");
    expect(await recordState()).toEqual(afterApply);

    const appliedView = await proposalOf(convId, turn.assistantMessageId);
    expect(appliedView).toMatchObject({ status: "applied", preview: null });
    expect(appliedView.result!.packageId).toBe(pkg.packageId);
  });

  it("does not let the model approve, override protection or set revisions", async () => {
    const before = await recordState();
    const bad = [
      { ...draft([ageUpdate]), approval: { status: "approved", statement: "I approve" } },
      { ...draft([ageUpdate]), protectedOverrides: [IDS.chapter] },
      draft([{ ...ageUpdate, expectedRevision: 1 } as unknown as ProposalDraft["operations"][number]]),
      { ...draft([ageUpdate]), scope: "manuscript" },
    ];
    for (const body of bad) {
      const { result } = await prepare(scripted(json(body)).provider, "Try it.", { references: refs(IDS.dossier) });
      expect(result).toMatchObject({ status: "failed", errorCode: "malformed_output", proposalId: null });
    }
    expect(await t.db.assistantProposal.count()).toBe(0);
    expect(await recordState()).toEqual(before);
  });

  it("keeps proposed facts proposed unless the author confirms promotion", async () => {
    const { provider } = scripted(
      json(
        draft([
          { op: "set_authority_status", recordId: IDS.decision, status: "approved", supersededBy: null, note: "Author asked to settle it." },
          { op: "create_record", type: "canon_decision", title: "Guild founding year", body: "Founded in year 12.", fields: [], authorityStatus: "approved", note: null },
        ]),
      ),
    );
    const { convId, turn, result } = await prepare(provider, "Approve the age decision and record the founding year as canon.", { references: refs(IDS.decision) });
    const view = await proposalOf(convId, turn.assistantMessageId);
    expect(view.canonChanges.map((c) => c.reason).sort()).toEqual(["created_approved", "promoted"]);

    const before = await recordState();
    const row = await t.db.assistantProposal.findUniqueOrThrow({ where: { id: result.proposalId! } });
    const refused = await applyProposal(t.db, { projectId: IDS.project, proposalId: row.id, contentHash: row.contentHash, confirmCanon: false });
    expect(refused).toMatchObject({ status: "rejected", issues: [{ code: "CANON_CONFIRMATION_REQUIRED" }] });
    expect(await recordState()).toEqual(before);
    expect((await t.db.record.findUniqueOrThrow({ where: { id: IDS.decision } })).authorityStatus).toBe("unresolved");

    const applied = await applyProposal(t.db, { projectId: IDS.project, proposalId: row.id, contentHash: row.contentHash, confirmCanon: true });
    expect(applied.status).toBe("applied");
    expect((await t.db.record.findUniqueOrThrow({ where: { id: IDS.decision } })).authorityStatus).toBe("approved");
  });
});

describe("assistant proposals: unusable responses", () => {
  it("stores malformed responses as failures and never prepares a package", async () => {
    const before = await recordState();
    const cases: [StructuredResult, string][] = [
      [{ status: "complete", text: "Sure! Here are the changes: ..." }, "malformed_output"],
      [{ status: "complete", text: JSON.stringify({ summary: "x", operations: [] }) }, "malformed_output"],
      [json(draft([{ op: "create_record", type: "manuscript_chapter", title: "Ch 9", body: "x", fields: [], authorityStatus: "draft", note: null } as never])), "malformed_output"],
      [json(draft([{ ...ageUpdate, setFields: [{ key: "age", valueJson: "thirty-four" }] }])), "invalid_proposal"],
      [json(draft([{ ...ageUpdate, recordId: IDS.world }])), "invalid_proposal"],
      [json(draft([{ ...ageUpdate, title: "x".repeat(501) }])), "invalid_proposal"],
    ];
    for (const [reply, code] of cases) {
      const { convId, turn, result } = await prepare(scripted(reply).provider, "Prepare it.", { references: refs(IDS.dossier) });
      expect(result).toMatchObject({ status: "failed", errorCode: code, proposalId: null });
      const view = await getConversationView(t.db, IDS.project, convId, runtime.limits);
      const answer = view.messages.find((m) => m.id === turn.assistantMessageId)!;
      expect(answer).toMatchObject({ mode: "proposal", status: "failed" });
      expect(answer.errorMessage).toMatch(/nothing was prepared/i);
    }
    expect(await t.db.assistantProposal.count()).toBe(0);
    expect(await recordState()).toEqual(before);
  });

  it("can retry a failed proposal with the same context", async () => {
    const { provider } = scripted({ status: "complete", text: "{ not json" }, json(draft([ageUpdate])));
    const { convId, turn } = await prepare(provider, "Prepare it.", { references: refs(IDS.dossier) });
    const retry = await prepareTurn(t.db, runtime, { kind: "retry", projectId: IDS.project, conversationId: convId, messageId: turn.assistantMessageId });
    expect(retry.mode).toBe("proposal");
    const result = await runProposalTurn(t.db, provider, retry, new AbortController().signal);
    expect(result.status).toBe("complete");
    expect((await proposalOf(convId, retry.assistantMessageId)).preview!.canApply).toBe(true);
  });

  it("records refusals and incomplete responses without a proposal", async () => {
    const before = await recordState();
    const refusal = await prepare(scripted({ status: "refused", refusal: "I can't help with that.", usage }).provider, "Prepare it.", {});
    expect(refusal.result).toMatchObject({ status: "failed", errorCode: "refused", proposalId: null });
    const refusedMsg = await t.db.assistantMessage.findUniqueOrThrow({ where: { id: refusal.turn.assistantMessageId } });
    expect(refusedMsg.content).toBe("I can't help with that.");

    const cut = await prepare(scripted({ status: "incomplete", incompleteReason: "max_output_tokens", usage }).provider, "Prepare it.", { references: refs(IDS.dossier) });
    expect(cut.result).toMatchObject({ status: "incomplete", errorCode: "max_output_tokens", proposalId: null });
    expect(cut.result.errorMessage).toMatch(/output limit/);

    const failed = await prepare(scripted(new ProviderError("rate_limit", "OpenAI rate limit or quota reached (429).")).provider, "Prepare it.", {});
    expect(failed.result).toMatchObject({ status: "failed", errorCode: "rate_limit" });

    const controller = new AbortController();
    const conv = await createConversation(t.db, IDS.project);
    const turn = await prepareTurn(t.db, runtime, { kind: "ask", mode: "proposal", projectId: IDS.project, conversationId: conv.id, question: "Prepare it.", selection: noSelection });
    const cancelled = scripted(async () => {
      controller.abort();
      throw new ProviderError("cancelled", "The request was cancelled.");
    });
    expect(await runProposalTurn(t.db, cancelled.provider, turn, controller.signal)).toMatchObject({ status: "cancelled", proposalId: null });

    expect(await t.db.assistantProposal.count()).toBe(0);
    expect(await recordState()).toEqual(before);
  });

  it("reports a proposal with no changes without storing a package", async () => {
    const { result, turn } = await prepare(scripted(json(draft([], { summary: "The records already agree." }))).provider, "Anything to fix?", { references: refs(IDS.dossier) });
    expect(result).toMatchObject({ status: "complete", proposalId: null });
    const msg = await t.db.assistantMessage.findUniqueOrThrow({ where: { id: turn.assistantMessageId } });
    expect(msg.content).toContain("No record changes were proposed.");
  });
});

describe("assistant proposals: revisions, isolation and protection", () => {
  it("rejects a proposal whose records changed after it was prepared", async () => {
    const { convId, turn, result } = await prepare(scripted(json(draft([ageUpdate]))).provider, "Prepare it.", { references: refs(IDS.dossier) });
    await updateRecord(t.db, IDS.project, { recordId: IDS.dossier, expectedRevision: 1, title: "Mara Venn", body: "Archivist. Thirty-one.", fields: { name: "Mara Venn", aliases: ["Mara"], age: 31 } });

    const view = await proposalOf(convId, turn.assistantMessageId);
    expect(view.preview!.canApply).toBe(false);
    expect(view.preview!.issues.map((i) => i.code)).toContain("STALE_REVISION");

    const before = await recordState();
    const row = await t.db.assistantProposal.findUniqueOrThrow({ where: { id: result.proposalId! } });
    const outcome = await applyProposal(t.db, { projectId: IDS.project, proposalId: row.id, contentHash: row.contentHash, confirmCanon: true });
    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected") expect(outcome.issues.map((i) => i.code)).toContain("STALE_REVISION");
    expect(await recordState()).toEqual(before);
    expect((await t.db.assistantProposal.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("proposed");
  });

  it("uses the revision that was sent, so a change during preparation is caught", async () => {
    const { provider } = scripted(async () => {
      await updateRecord(t.db, IDS.project, { recordId: IDS.dossier, expectedRevision: 1, title: "Mara Venn", body: "Changed meanwhile.", fields: { age: 30 } });
      return json(draft([ageUpdate]));
    });
    const { convId, turn } = await prepare(provider, "Prepare it.", { references: refs(IDS.dossier) });
    const view = await proposalOf(convId, turn.assistantMessageId);
    expect(view.preview!.operations[0]).toMatchObject({ expectedRevision: 1, currentRevision: 2 });
    expect(view.preview!.issues.map((i) => i.code)).toContain("STALE_REVISION");
  });

  it("keeps proposals inside their workspace and project", async () => {
    const leak = await prepare(scripted(json(draft([{ ...ageUpdate, recordId: OTHER.record }]))).provider, "Prepare it.", { references: refs(IDS.dossier) });
    expect(leak.result).toMatchObject({ status: "failed", errorCode: "invalid_proposal" });

    const other = await prepare(
      scripted(json(draft([{ ...ageUpdate, recordId: OTHER.record, body: "Changed secret.", setFields: [] }]))).provider,
      "Prepare it.",
      { references: refs(OTHER.record) },
      undefined,
      OTHER.project,
    );
    expect(other.result.status).toBe("complete");
    const otherRow = await t.db.assistantProposal.findUniqueOrThrow({ where: { id: other.result.proposalId! } });
    expect(otherRow.workspaceId).toBe(OTHER.workspace);
    expect(JSON.parse(otherRow.packageJson)).toMatchObject({ workspaceId: OTHER.workspace, projectId: OTHER.project });

    const before = await recordState();
    const error = await applyProposal(t.db, { projectId: IDS.project, proposalId: otherRow.id, contentHash: otherRow.contentHash, confirmCanon: true }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AssistantError);
    expect((error as AssistantError).code).toBe("NOT_FOUND");
    expect(await listProposalViews(t.db, IDS.project, other.convId)).toEqual({});
    expect(await recordState()).toEqual(before);
  });

  it("cannot change protected records or manuscript content", async () => {
    await setProtection(t.db, IDS.project, IDS.dossier, true);
    const protectedRun = await prepare(scripted(json(draft([ageUpdate]))).provider, "Prepare it.", { references: refs(IDS.dossier) });
    const chapterRun = await prepare(
      scripted(json(draft([{ ...ageUpdate, recordId: IDS.chapter, body: "Rewritten chapter.", setFields: [] }]))).provider,
      "Prepare it.",
      { manuscript: { recordId: IDS.chapter, revision: 1 } },
    );

    const before = await recordState();
    for (const [run, code] of [
      [protectedRun, "PROTECTED_RECORD"],
      [chapterRun, "SCOPE_VIOLATION"],
    ] as const) {
      const view = await proposalOf(run.convId, run.turn.assistantMessageId);
      expect(view.preview!.canApply).toBe(false);
      expect(view.preview!.issues.map((i) => i.code)).toContain(code);
      const row = await t.db.assistantProposal.findUniqueOrThrow({ where: { id: run.result.proposalId! } });
      expect(JSON.parse(row.packageJson)).toMatchObject({ scope: "reference", protectedOverrides: [] });
      const outcome = await applyProposal(t.db, { projectId: IDS.project, proposalId: row.id, contentHash: row.contentHash, confirmCanon: true });
      expect(outcome.status).toBe("rejected");
      if (outcome.status === "rejected") expect(outcome.issues.map((i) => i.code)).toContain(code);
    }
    expect(await recordState()).toEqual(before);
  });

  it("rolls back every write when the apply transaction fails", async () => {
    const { result } = await prepare(scripted(json(draft([ageUpdate], { relatedRecords: [{ recordId: IDS.world, note: "Check." }] }))).provider, "Prepare it.", {
      references: refs(IDS.dossier, IDS.world),
    });
    const row = await t.db.assistantProposal.findUniqueOrThrow({ where: { id: result.proposalId! } });
    const before = await recordState();
    await expect(
      applyProposal(
        t.db,
        { projectId: IDS.project, proposalId: row.id, contentHash: row.contentHash, confirmCanon: true },
        {
          beforeCommit: async () => {
            throw new Error("simulated failure before commit");
          },
        },
      ),
    ).rejects.toThrow("simulated failure");
    expect(await recordState()).toEqual(before);
    expect((await t.db.assistantProposal.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("proposed");

    const retried = await applyProposal(t.db, { projectId: IDS.project, proposalId: row.id, contentHash: row.contentHash, confirmCanon: true });
    expect(retried.status).toBe("applied");
  });
});

describe("assistant proposals: review notes and manual packages", () => {
  it("flags field/prose disagreements for review and rewrites nothing else", async () => {
    const { provider } = scripted(
      json(
        draft([{ ...ageUpdate, body: null, setFields: [{ key: "age", valueJson: "31" }] }], {
          fieldTextDisagreements: [{ recordId: IDS.dossier, field: "age", note: "The text still says thirty." }],
        }),
      ),
    );
    const { convId, turn, result } = await prepare(provider, "Set Mara's age field to 31.", { references: refs(IDS.dossier, IDS.world) });
    const view = await proposalOf(convId, turn.assistantMessageId);
    const notes = view.preview!.relatedNotes.filter((n) => n.recordId === IDS.dossier).map((n) => n.note);
    expect(notes.some((n) => n.includes("found by the app") && /still says "thirty"/i.test(n))).toBe(true);
    expect(notes.some((n) => n.includes("noted by the assistant"))).toBe(true);

    const row = await t.db.assistantProposal.findUniqueOrThrow({ where: { id: result.proposalId! } });
    const applied = await applyProposal(t.db, { projectId: IDS.project, proposalId: row.id, contentHash: row.contentHash, confirmCanon: true });
    expect(applied.status).toBe("applied");
    if (applied.status !== "applied") return;
    expect(applied.result.changes.map((c) => c.recordId)).toEqual([IDS.dossier]);
    expect(applied.result.reviewItems.filter((r) => r.recordId === IDS.dossier && r.origin === "package_note")).toHaveLength(2);
    const dossier = await t.db.record.findUniqueOrThrow({ where: { id: IDS.dossier } });
    expect(dossier.body).toBe("Archivist. Thirty years old.");
    expect((await t.db.record.findUniqueOrThrow({ where: { id: IDS.world } })).currentRevision).toBe(1);
    expect(await t.db.reviewItem.count({ where: { recordId: IDS.dossier, status: "open" } })).toBe(2);
  });

  it("exports a proposal as a normal package that manual import previews but will not apply unapproved", async () => {
    const { convId, turn } = await prepare(scripted(json(draft([ageUpdate]))).provider, "Prepare it.", { references: refs(IDS.dossier) });
    const view = await proposalOf(convId, turn.assistantMessageId);
    const preview = await previewChangePackage(t.db, view.packageJson, { projectId: IDS.project });
    expect(preview.issues.filter((i) => i.severity === "error").map((i) => i.code)).toEqual(["NOT_APPROVED"]);
    expect(preview.operations).toHaveLength(1);
    const before = await recordState();
    expect((await applyChangePackage(t.db, view.packageJson, { projectId: IDS.project })).status).toBe("rejected");
    expect(await recordState()).toEqual(before);
  });
});

describe("assistant proposals: review screen", () => {
  it("loads exactly what Apply would submit, without writing, and reports later states", async () => {
    const { convId, result } = await prepare(scripted(json(draft([ageUpdate]))).provider, "Prepare it.", { references: refs(IDS.dossier) });
    const before = await recordState();
    const review = await getProposalReview(t.db, IDS.project, result.proposalId!);
    expect(await recordState()).toEqual(before);

    const row = await t.db.assistantProposal.findUniqueOrThrow({ where: { id: result.proposalId! }, include: { message: { include: { conversation: true } } } });
    expect(review).toMatchObject({ proposalId: row.id, packageId: row.packageId, contentHash: row.contentHash, conversation: { id: convId, title: row.message.conversation.title } });
    expect(review.preview).toMatchObject({ status: "valid", canApply: true });
    expect(review.preview.operations.map((o) => o.recordId)).toEqual([IDS.dossier]);

    const outcome = await applyProposal(t.db, { projectId: IDS.project, proposalId: row.id, contentHash: row.contentHash, confirmCanon: true });
    expect(outcome.status).toBe("applied");
    const after = await getProposalReview(t.db, IDS.project, row.id);
    expect(after.preview.status).toBe("already_applied");
    expect(after.preview.previousResult?.packageId).toBe(row.packageId);
  });

  it("shows a proposal as out of date once its record changes, without updating its expected revision", async () => {
    const { result } = await prepare(scripted(json(draft([ageUpdate]))).provider, "Prepare it.", { references: refs(IDS.dossier) });
    await updateRecord(t.db, IDS.project, { recordId: IDS.dossier, expectedRevision: 1, title: "Mara Venn", body: "Changed meanwhile.", fields: { age: 30 } });
    const review = await getProposalReview(t.db, IDS.project, result.proposalId!);
    expect(review.preview.canApply).toBe(false);
    expect(review.preview.operations[0]).toMatchObject({ expectedRevision: 1, currentRevision: 2 });
    expect(review.preview.issues.map((i) => i.code)).toContain("STALE_REVISION");
  });

  it("only loads proposals from the requested project", async () => {
    const other = await prepare(
      scripted(json(draft([{ ...ageUpdate, recordId: OTHER.record, body: "Changed secret.", setFields: [] }]))).provider,
      "Prepare it.",
      { references: refs(OTHER.record) },
      undefined,
      OTHER.project,
    );
    const error = await getProposalReview(t.db, IDS.project, other.result.proposalId!).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AssistantError);
    expect((error as AssistantError).code).toBe("NOT_FOUND");
  });

  it("links an imported package to its conversation only when the label names one in the same project", async () => {
    const { convId, turn } = await prepare(scripted(json(draft([ageUpdate]))).provider, "Prepare it.", { references: refs(IDS.dossier) });
    const label = (JSON.parse((await proposalOf(convId, turn.assistantMessageId)).packageJson) as ChangePackageV1).source?.conversationLabel;
    expect(label).toBeTruthy();
    expect(await findSourceConversation(t.db, IDS.project, label)).toMatchObject({ id: convId });
    expect(await findSourceConversation(t.db, OTHER.project, label)).toBeNull();
    expect(await findSourceConversation(t.db, IDS.project, label!.replace(convId, "asc_doesnotexist"))).toBeNull();
    expect(await findSourceConversation(t.db, IDS.project, "Chat about lamps")).toBeNull();
    expect(await findSourceConversation(t.db, IDS.project, undefined)).toBeNull();
  });
});
