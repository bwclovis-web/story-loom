import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyRetrievalMeta } from "@/assistant/retrievalMeta";
import type { AssistantProvider, ProviderRequest, ProviderRound } from "@/assistant/provider";
import { createConversation, prepareTurn, runTurn } from "@/server/services/assistantService";
import { executeAssistantTool, type RetrievalContext } from "@/server/services/assistantRetrievalService";
import { startAuthorRewrite } from "@/server/services/draftService";
import { acceptEstablishedFact, proposeExtractedFacts, runCharacterKnowledgeCheck } from "@/server/services/establishedFactService";
import { createRecord } from "@/server/services/recordService";
import { addWeaveBeat, addWeaveThread, createWeaveGrid } from "@/server/services/weaveService";
import { otherDraftRowByRecord, plotRowForManuscript } from "@/ui/plotGridPlacement";
import { CHAPTER_PROSE, createTestDb, IDS, seedProject, type TestDb } from "../helpers";

const limits = {
  maxInputChars: 20_000,
  maxOutputTokens: 500,
  maxRequestsPerHour: 30,
  monthlyTokenCap: 1_000_000,
  requestTimeoutSeconds: 60,
  maxToolCalls: 4,
  maxToolRounds: 1,
  maxToolResultChars: 80_000,
};

describe("three-chapter author workflow", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("reports empty chronology, missing fact evidence, and rewrite-grid coverage with a mocked provider", async () => {
    await createRecord(t.db, IDS.project, {
      recordId: "rec_test_ch02",
      type: "manuscript_chapter",
      title: "Chapter 2",
      body: "Mara Venn told the guild what she had seen.",
      authorityStatus: "draft",
    });
    await createRecord(t.db, IDS.project, {
      recordId: "rec_test_ch03",
      type: "manuscript_chapter",
      title: "Chapter 3",
      body: "The third morning was quiet. Mara Venn did not speak of the ledger.",
      authorityStatus: "draft",
    });
    const rewrite = await startAuthorRewrite(t.db, IDS.project);
    const chapters = await t.db.record.findMany({
      where: { projectId: IDS.project, type: "manuscript_chapter", trashedAt: null },
      select: { id: true, title: true, draftId: true, body: true },
    });
    const zero = (title: string) => chapters.find((row) => row.title === title && row.draftId === rewrite.zeroDraft.id)!;
    const author = (title: string) => chapters.find((row) => row.title === title && row.draftId === rewrite.authorDraft.id)!;
    expect(author("Chapter 1").body).toBe("");
    expect(author("Chapter 3").body).toBe("");

    const grid = await createWeaveGrid(t.db, IDS.project, { title: "Rewrite plan", viewKind: "author_rewrite" });
    const thread = await addWeaveThread(t.db, IDS.project, grid.id, { title: "Ledger" });
    await addWeaveBeat(t.db, IDS.project, grid.id, {
      title: "Finds the ledger",
      x: 10,
      y: 10,
      threadId: thread.id,
      manuscriptRecordId: zero("Chapter 1").id,
    });
    await addWeaveBeat(t.db, IDS.project, grid.id, {
      title: "Tells the guild",
      x: 10,
      y: 40,
      threadId: thread.id,
      manuscriptRecordId: zero("Chapter 2").id,
    });
    const links = await t.db.rewriteSourceLink.findMany({
      where: { projectId: IDS.project },
      select: { fromRecordId: true, toRecordId: true },
    });
    const authorRows = new Set([author("Chapter 1").id, author("Chapter 2").id, author("Chapter 3").id]);
    const placement = otherDraftRowByRecord(authorRows, links);
    const beats = await t.db.weaveBeat.findMany({ where: { projectId: IDS.project } });
    const rows = beats.map((beat) => plotRowForManuscript(beat.manuscriptRecordId, authorRows, placement));
    expect(rows).toEqual(expect.arrayContaining([author("Chapter 1").id, author("Chapter 2").id]));
    expect(rows).toHaveLength(2);
    expect(rows).not.toContain(author("Chapter 3").id);

    const proposed = await proposeExtractedFacts(t.db, IDS.project, {
      subjectRecordId: IDS.dossier,
      evidenceKind: "zero_draft",
      statements: ["Mara checks the ledger every morning."],
    });
    const fact = proposed.find((row) => row.statement.startsWith("Mara checks"))!;
    await acceptEstablishedFact(t.db, IDS.project, fact.id);

    const knowledge = await runCharacterKnowledgeCheck(t.db, IDS.project, {
      subjectRecordId: IDS.dossier,
      sceneId: zero("Chapter 1").id,
      draftId: rewrite.zeroDraft.id,
    });
    expect(knowledge.passagesChecked.length).toBeGreaterThan(0);
    expect(knowledge.coveredByEvidence).toEqual([]);
    const authorKnowledge = await runCharacterKnowledgeCheck(t.db, IDS.project, {
      subjectRecordId: IDS.dossier,
      sceneId: author("Chapter 1").id,
      draftId: rewrite.authorDraft.id,
    });
    expect(authorKnowledge.passagesChecked).toEqual([]);
    expect(authorKnowledge.evidenceKind).toBe("author_rewrite");
    expect(authorKnowledge.gaps.map((gap) => gap.factId)).toContain(fact.id);

    const ctx = context(rewrite.zeroDraft.id);
    const sequence = JSON.parse(
      (await executeAssistantTool(t.db, ctx, "chapter_event_sequence", JSON.stringify({ manuscriptRecordId: zero("Chapter 3").id }))).output,
    ) as { conflictsWithRecordedSequence: boolean; revealedInChapter: unknown[]; unknownTime: unknown[]; coverage: { eventCount: number } };
    expect(sequence.revealedInChapter).toEqual([]);
    expect(sequence.unknownTime).toEqual([]);
    expect(sequence.conflictsWithRecordedSequence).toBe(false);
    expect(sequence.coverage.eventCount).toBe(0);
    const before = JSON.parse(
      (await executeAssistantTool(t.db, ctx, "events_before_scene", JSON.stringify({ manuscriptRecordId: zero("Chapter 2").id }))).output,
    ) as { occurringBefore: unknown[]; note?: string; notes?: string[] };
    expect(before.occurringBefore).toEqual([]);
    expect(JSON.stringify(before)).toContain("does not mean every character");

    const conv = await createConversation(t.db, IDS.project);
    const requests: ProviderRequest[] = [];
    const provider: AssistantProvider = {
      stream() {
        throw new Error("discussion with tools uses complete");
      },
      async structured() {
        throw new Error("proposals are not part of this check");
      },
      async complete(request): Promise<ProviderRound> {
        requests.push(request);
        if (request.toolChoice === "none") {
          return {
            kind: "message",
            text: "No event order is recorded. The accepted fact has no pinned passage. Chapter 3 has no plan beat.",
            status: "complete",
            usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
          };
        }
        return {
          kind: "tool_calls",
          calls: [
            { callId: "facts", name: "list_accepted_facts", arguments: JSON.stringify({ subjectRecordId: IDS.dossier }) },
            { callId: "sequence", name: "chapter_event_sequence", arguments: JSON.stringify({ manuscriptRecordId: zero("Chapter 3").id }) },
          ],
        };
      },
    };
    const turn = await prepareTurn(t.db, { configured: true, model: "test-model", limits }, {
      kind: "ask",
      projectId: IDS.project,
      conversationId: conv.id,
      question: "What is established before chapter 3, and what should the rewrite plan cover?",
      selection: { references: [], manuscript: null, includeMessageIds: [] },
      retrievalScope: "book",
    });
    expect(turn.request.tools).toBeDefined();
    await runTurn(t.db, provider, turn, new AbortController().signal);
    expect(requests[1]?.toolChoice).toBe("none");
    const outputs = (requests[1]?.toolItems ?? []).flatMap((item) =>
      item.type === "function_call_output" ? [JSON.parse(item.output) as Record<string, unknown>] : [],
    );
    const facts = outputs[0] as { facts: Array<{ missingPassageEvidence: boolean; evidenceKind: string }> };
    expect(facts.facts[0]?.missingPassageEvidence).toBe(true);
    expect(facts.facts[0]?.evidenceKind).toBe("zero_draft");
    expect(JSON.stringify(outputs[1])).toContain("conflictsWithRecordedSequence\":false");
    const chapterAfter = await t.db.record.findUniqueOrThrow({ where: { id: zero("Chapter 1").id }, select: { body: true } });
    expect(chapterAfter.body).toBe(CHAPTER_PROSE);
  });
});

function context(draftId: string | null): RetrievalContext {
  return {
    projectId: IDS.project,
    scope: "book",
    focusRecordId: IDS.chapter,
    draftId,
    excludeRecordIds: new Set(),
    maxResultChars: 80_000,
    meta: emptyRetrievalMeta("book"),
  };
}
