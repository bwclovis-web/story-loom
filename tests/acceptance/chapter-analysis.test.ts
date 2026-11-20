import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProviderError, type AssistantProvider, type StructuredResult } from "@/assistant/provider";
import { sha256 } from "@/domain/json";
import type { AnalysisDraftSuggestion } from "@/analyze/chapterAnalysisOutput";
import {
  applyChapterAnalysis,
  enrichAnalysisSuggestions,
  getChapterAnalysis,
  manuscriptCountsByDraft,
  prepareChapterAnalysis,
  previewChapterAnalysis,
  runChapterAnalysis,
  saveChapterAnalysisAssessments,
  type ChapterAnalysisRunView,
} from "@/server/services/chapterAnalysisService";
import { usageSummary } from "@/server/services/assistantService";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "@/server/services/backupService";
import { startAuthorRewrite } from "@/server/services/draftService";
import { acceptEstablishedFact, proposeExtractedFacts } from "@/server/services/establishedFactService";
import { MutationRejectedError } from "@/server/services/errors";
import { createRecord, getRecord, updateRecord } from "@/server/services/recordService";
import { createStoryEvent, orderStoryEvents } from "@/server/services/storyEventService";
import { CHAPTER_PROSE, createTestDb, IDS, seedProject, type TestDb } from "../helpers";

const OPENING = "The ledger had been dry for three hundred years.";
const KNEW = "Mara Venn knew this because she had checked it every morning.";
const FACT = "The ledger has been dry for three hundred years.";

const runtime = {
  configured: true,
  model: "test-model",
  limits: {
    maxInputChars: 600_000,
    maxOutputTokens: 2_000,
    maxRequestsPerHour: 30,
    monthlyTokenCap: 3_000_000,
    requestTimeoutSeconds: 30,
    maxToolCalls: 0,
    maxToolRounds: 0,
    maxToolResultChars: 1_000,
  },
};

function suggestion(over: Partial<AnalysisDraftSuggestion> & Pick<AnalysisDraftSuggestion, "kind" | "title" | "excerpt">): AnalysisDraftSuggestion {
  return {
    note: "",
    uncertain: false,
    uncertainty: "",
    explicitOrder: false,
    earlierTitle: "",
    laterTitle: "",
    occurrence: 1,
    ...over,
  };
}

function provider(suggestions: AnalysisDraftSuggestion[]): AssistantProvider {
  return {
    async *stream() {},
    async structured() {
      return {
        status: "complete" as const,
        text: JSON.stringify({ suggestions }),
        usage: { inputTokens: 4, outputTokens: 4, totalTokens: 8 },
      };
    },
  };
}

async function analyze(t: TestDb, chapterId: string, revision: number, suggestions: AnalysisDraftSuggestion[]) {
  const prep = await prepareChapterAnalysis(t.db, runtime, {
    projectId: IDS.project,
    chapterRecordId: chapterId,
    pinnedRevision: revision,
  });
  const run = await runChapterAnalysis(t.db, provider(suggestions), prep, new AbortController().signal);
  return run;
}

function decision(
  run: ChapterAnalysisRunView,
  title: string,
  action: "reuse" | "edit" | "create" | "skip",
  targetId?: string,
  kind?: string,
) {
  const item = run.proposal?.suggestions.find((entry) => entry.title === title && (!kind || entry.kind === kind));
  if (!item) throw new Error(`missing suggestion ${title}`);
  return { [item.key]: { action, ...(targetId ? { targetId } : {}) } };
}

describe("analyze chapter", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("counts legacy manuscript and refuses it, then analyzes only the zero draft", async () => {
    const before = await manuscriptCountsByDraft(t.db, IDS.project);
    expect(before.find((row) => row.kind === "legacy")).toMatchObject({ chapters: 1, scenes: 0 });
    await expect(
      prepareChapterAnalysis(t.db, runtime, { projectId: IDS.project, chapterRecordId: IDS.chapter, pinnedRevision: 1 }),
    ).rejects.toThrow(/Zero-draft/);

    const rewrite = await startAuthorRewrite(t.db, IDS.project);
    const after = await manuscriptCountsByDraft(t.db, IDS.project);
    expect(after.find((row) => row.kind === "zero_draft")).toMatchObject({ chapters: 1, id: rewrite.zeroDraft.id });
    expect(after.find((row) => row.kind === "author_manuscript")).toMatchObject({ chapters: 1 });
    expect(after.find((row) => row.kind === "legacy")).toMatchObject({ chapters: 0 });

    const author = await t.db.record.findFirstOrThrow({
      where: { projectId: IDS.project, draftId: rewrite.authorDraft.id, type: "manuscript_chapter" },
    });
    await expect(
      prepareChapterAnalysis(t.db, runtime, { projectId: IDS.project, chapterRecordId: author.id, pinnedRevision: 1 }),
    ).rejects.toThrow(/Zero-draft/);

    const run = await analyze(t, IDS.chapter, 1, [
      suggestion({ kind: "event", title: "The ledger dried", excerpt: OPENING, note: "It dried." }),
    ]);
    expect(run.sentMaterial).toContain(CHAPTER_PROSE);
    expect(run.sentMaterial).not.toContain("other chapter");
    expect(run.proposal?.suggestions).toHaveLength(1);
    const applied = await applyChapterAnalysis(t.db, IDS.project, run.id, run.contentHash, decision(run, "The ledger dried", "create"));
    expect(applied.status).toBe("applied");
    const event = await t.db.storyEvent.findFirstOrThrow({ where: { projectId: IDS.project } });
    expect(event.draftScope).toBe(rewrite.zeroDraft.id);
    expect(event.timeLabel).toBe("");
    expect(event.planned).toBe(false);
    const chapter = await getRecord(t.db, IDS.project, IDS.chapter);
    expect(chapter.body).toBe(CHAPTER_PROSE);
    expect(chapter.currentRevision).toBe(1);
  });

  it("refuses an invalid quote and writes nothing", async () => {
    await startAuthorRewrite(t.db, IDS.project);
    const before = await t.db.record.count();
    const run = await analyze(t, IDS.chapter, 1, [
      suggestion({ kind: "location", title: "The Dry Vault", excerpt: "This sentence was never written." }),
    ]);
    expect(run.proposal?.suggestions[0]?.quoteValid).toBe(false);
    expect(run.proposal?.suggestions[0]?.uncertain).toBe(true);
    await expect(
      applyChapterAnalysis(t.db, IDS.project, run.id, run.contentHash, decision(run, "The Dry Vault", "create")),
    ).rejects.toBeInstanceOf(MutationRejectedError);
    expect(await t.db.record.count()).toBe(before);
    expect(await t.db.sceneLocation.count()).toBe(0);
  });

  it("refuses a stale pin and keeps the proposal for review", async () => {
    await startAuthorRewrite(t.db, IDS.project);
    const run = await analyze(t, IDS.chapter, 1, [
      suggestion({ kind: "event", title: "The ledger dried", excerpt: OPENING }),
    ]);
    await updateRecord(t.db, IDS.project, {
      recordId: IDS.chapter,
      expectedRevision: 1,
      body: `${CHAPTER_PROSE} A later sentence.`,
      unlockProtected: true,
    });
    await expect(
      applyChapterAnalysis(t.db, IDS.project, run.id, run.contentHash, decision(run, "The ledger dried", "create")),
    ).rejects.toThrow(/changed after it was pinned/);
    expect(await t.db.storyEvent.count()).toBe(0);
    const reloaded = await getChapterAnalysis(t.db, IDS.project, run.id);
    expect(reloaded.proposal?.suggestions).toHaveLength(1);
    expect(reloaded.status).toBe("proposed");
  });

  it("applies a partial selection and does not duplicate it on retry", async () => {
    await startAuthorRewrite(t.db, IDS.project);
    const run = await analyze(t, IDS.chapter, 1, [
      suggestion({ kind: "location", title: "The Dry Vault", excerpt: OPENING }),
      suggestion({ kind: "event", title: "The ledger dried", excerpt: OPENING }),
      suggestion({
        kind: "character_presence",
        title: "Mara Venn",
        excerpt: KNEW,
      }),
    ]);
    const first = await applyChapterAnalysis(t.db, IDS.project, run.id, run.contentHash, {
      ...decision(run, "The Dry Vault", "create"),
      ...decision(run, "The ledger dried", "skip"),
      ...decision(run, "Mara Venn", "skip"),
    });
    expect(first.status).toBe("applied");
    expect(await t.db.storyEvent.count()).toBe(0);
    const place = await t.db.record.findFirstOrThrow({ where: { projectId: IDS.project, title: "The Dry Vault" } });
    expect(place.authorityStatus).toBe("draft");
    expect(place.type).toBe("worldbuilding");
    expect(await t.db.sceneLocation.count({ where: { locationRecordId: place.id, isPrimary: true } })).toBe(1);

    const again = await applyChapterAnalysis(t.db, IDS.project, run.id, run.contentHash, {
      ...decision(run, "The Dry Vault", "create"),
      ...decision(run, "The ledger dried", "skip"),
      ...decision(run, "Mara Venn", "skip"),
    });
    expect(again.status).toBe("already_applied");
    expect(await t.db.record.count({ where: { title: "The Dry Vault" } })).toBe(1);
    expect((await getRecord(t.db, IDS.project, IDS.chapter)).body).toBe(CHAPTER_PROSE);
  });

  it("requires a chosen record when two characters share a name", async () => {
    await startAuthorRewrite(t.db, IDS.project);
    const kane = await createRecord(t.db, IDS.project, {
      type: "character_dossier",
      title: "Ellis Kane",
      fields: { name: "Ellis Kane" },
      authorityStatus: "draft",
    });
    await createRecord(t.db, IDS.project, {
      type: "character_dossier",
      title: "Ellis Ward",
      fields: { name: "Ellis Ward" },
      authorityStatus: "draft",
    });
    const run = await analyze(t, IDS.chapter, 1, [suggestion({ kind: "character_presence", title: "Ellis", excerpt: KNEW })]);
    expect(run.proposal?.suggestions[0]?.match.status).toBe("ambiguous");
    await expect(
      applyChapterAnalysis(t.db, IDS.project, run.id, run.contentHash, decision(run, "Ellis", "reuse")),
    ).rejects.toThrow(/more than one record/);
    const applied = await applyChapterAnalysis(
      t.db,
      IDS.project,
      run.id,
      run.contentHash,
      decision(run, "Ellis", "reuse", kane.outcomes[0]?.recordId),
    );
    expect(applied.status).toBe("applied");
    expect(await t.db.record.count({ where: { title: { contains: "Ellis" } } })).toBe(2);
    const fact = await t.db.establishedFact.findFirstOrThrow({ where: { subjectRecordId: kane.outcomes[0]?.recordId } });
    expect(fact.status).toBe("pending");
    expect(fact.statement).toContain("Appears in");
    expect(fact.statement.toLowerCase()).not.toContain("knows");
  });

  it("links evidence to an accepted fact, keeps new facts pending, and separates revelation from knowledge", async () => {
    await startAuthorRewrite(t.db, IDS.project);
    const proposed = await proposeExtractedFacts(t.db, IDS.project, {
      subjectRecordId: IDS.dossier,
      evidenceKind: "zero_draft",
      statements: [FACT],
    });
    await acceptEstablishedFact(t.db, IDS.project, proposed[0]!.id);
    const run = await analyze(t, IDS.chapter, 1, [
      suggestion({ kind: "reference_evidence", title: FACT, excerpt: OPENING }),
      suggestion({ kind: "event", title: "The ledger dried", excerpt: OPENING }),
      suggestion({ kind: "reader_revelation", title: "The ledger dried", excerpt: KNEW, note: "The reader hears that it dried." }),
      suggestion({
        kind: "character_learning",
        title: "Mara Venn",
        excerpt: KNEW,
        note: "Mara learns the ledger has been dry for centuries.",
        uncertain: true,
        uncertainty: "The sentence says she knew, which may mean she already knew.",
      }),
      suggestion({ kind: "chronology", title: "Guessed order", excerpt: OPENING, explicitOrder: false, earlierTitle: "A", laterTitle: "B" }),
      suggestion({ kind: "plot_beat", title: "The dry ledger", excerpt: OPENING, note: "Planning only." }),
    ]);
    expect(run.proposal?.suggestions.some((item) => item.kind === "chronology")).toBe(false);
    const learning = run.proposal?.suggestions.find((item) => item.kind === "character_learning");
    expect(learning?.uncertain).toBe(true);
    expect(learning?.uncertainty).toContain("already knew");
    const evidence = run.proposal?.suggestions.find((item) => item.kind === "reference_evidence");
    expect(evidence?.match.status).toBe("unique");
    expect(evidence?.match.candidates[0]?.evidenceCount).toBe(0);

    await applyChapterAnalysis(t.db, IDS.project, run.id, run.contentHash, {
      ...decision(run, FACT, "reuse"),
      ...decision(run, "The ledger dried", "create", undefined, "event"),
      ...decision(run, "The ledger dried", "create", undefined, "reader_revelation"),
      ...decision(run, "The dry ledger", "create"),
      ...decision(run, "Mara Venn", "reuse"),
    });
    const fact = await t.db.establishedFact.findFirstOrThrow({ where: { id: proposed[0]!.id }, include: { evidence: true } });
    expect(fact.status).toBe("accepted");
    expect(fact.statement).toBe(FACT);
    expect(fact.evidence).toHaveLength(1);
    expect(fact.evidence[0]?.evidenceKind).toBe("zero_draft");
    expect(fact.evidence[0]?.passageExcerpt).toBe(OPENING);
    const learned = await t.db.establishedFact.findFirstOrThrow({ where: { statement: { contains: "learns the ledger" } } });
    expect(learned.status).toBe("pending");
    expect(await t.db.storyEventScene.count()).toBe(1);
    const beat = await t.db.weaveBeat.findFirstOrThrow({ where: { title: "The dry ledger" } });
    expect(beat.manuscriptRecordId).toBe(IDS.chapter);
    expect((await getRecord(t.db, IDS.project, IDS.chapter)).currentRevision).toBe(1);
  });

  it("drops chronology the text does not state and rolls back an order that would cycle", async () => {
    const rewrite = await startAuthorRewrite(t.db, IDS.project);
    const drying = await createStoryEvent(t.db, IDS.project, { title: "The drying", draftScope: rewrite.zeroDraft.id });
    const morning = await createStoryEvent(t.db, IDS.project, { title: "The morning check", draftScope: rewrite.zeroDraft.id });
    await orderStoryEvents(t.db, IDS.project, {
      eventId: drying.id,
      otherEventId: morning.id,
      direction: "before",
      expectedRevision: 0,
    });
    const ordered = `${CHAPTER_PROSE} The morning check comes before the drying.`;
    await updateRecord(t.db, IDS.project, { recordId: IDS.chapter, expectedRevision: 1, body: ordered, unlockProtected: true });
    const dropped = enrichAnalysisSuggestions(
      { id: IDS.chapter, title: "Chapter 1", pinnedRevision: 2 },
      ordered,
      [
        suggestion({ kind: "chronology", title: "Guessed", excerpt: OPENING, explicitOrder: false, earlierTitle: "The drying", laterTitle: "The morning check" }),
        suggestion({ kind: "chronology", title: "Unstated", excerpt: OPENING, explicitOrder: true, earlierTitle: "The drying", laterTitle: "The morning check" }),
      ],
      { records: [], facts: [], events: [], beats: [] },
    );
    expect(dropped.suggestions).toHaveLength(1);
    expect(dropped.suggestions[0]?.title).toBe("Unstated");
    expect(dropped.suggestions[0]?.quoteValid).toBe(false);
    expect(dropped.suggestions[0]?.passageVerified).toBe(true);

    const run = await analyze(t, IDS.chapter, 2, [
      suggestion({
        kind: "chronology",
        title: "Reversed",
        excerpt: "The morning check comes before the drying.",
        explicitOrder: true,
        earlierTitle: "The morning check",
        laterTitle: "The drying",
        note: "The sentence says the morning check comes before the drying.",
      }),
      suggestion({ kind: "event", title: "A new event", excerpt: KNEW }),
    ]);
    await expect(
      applyChapterAnalysis(t.db, IDS.project, run.id, run.contentHash, {
        ...decision(run, "Reversed", "create"),
        ...decision(run, "A new event", "create"),
      }),
    ).rejects.toThrow(/contradict/);
    expect(await t.db.storyEvent.count()).toBe(2);
    expect(await t.db.storyEventOrder.count()).toBe(1);
    expect((await getChapterAnalysis(t.db, IDS.project, run.id)).status).toBe("proposed");
  });

  it("keeps a cancelled run reviewable and round-trips an applied run through backup restore", async () => {
    await startAuthorRewrite(t.db, IDS.project);
    const prep = await prepareChapterAnalysis(t.db, runtime, { projectId: IDS.project, chapterRecordId: IDS.chapter, pinnedRevision: 1 });
    const cancelled = await runChapterAnalysis(
      t.db,
      {
        async *stream() {},
        async structured() {
          throw new ProviderError("cancelled", "The request was cancelled.");
        },
      },
      prep,
      new AbortController().signal,
    );
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.proposal).toBeNull();
    expect((await getChapterAnalysis(t.db, IDS.project, prep.runId)).errorMessage).toContain("Cancelled");

    const run = await analyze(t, IDS.chapter, 1, [
      suggestion({ kind: "event", title: "The ledger dried", excerpt: OPENING }),
    ]);
    await applyChapterAnalysis(t.db, IDS.project, run.id, run.contentHash, decision(run, "The ledger dried", "create"));
    const backup = await createWorkspaceBackup(t.db, IDS.workspace);
    expect(backup.chapterAnalyses).toHaveLength(2);

    const preserved = await createTestDb();
    const remapped = await createTestDb();
    try {
      const kept = await restoreWorkspaceBackup(preserved.db, JSON.stringify(backup), { idStrategy: "preserve" });
      expect(kept.ok).toBe(true);
      const again = await getChapterAnalysis(preserved.db, IDS.project, run.id);
      expect(again.proposal?.suggestions[0]?.passage?.excerpt).toBe(OPENING);
      expect(again.sentMaterial).toContain(CHAPTER_PROSE);
      expect(await preserved.db.storyEvent.count()).toBe(1);
      const chapter = await getRecord(preserved.db, IDS.project, IDS.chapter);
      expect(chapter.body).toBe(CHAPTER_PROSE);

      const copied = await restoreWorkspaceBackup(remapped.db, JSON.stringify(backup), { idStrategy: "remap" });
      expect(copied.ok).toBe(true);
      if (!copied.ok) return;
      const projectId = copied.projects[0]!.id;
      const restoredRun = await remapped.db.chapterAnalysisRun.findFirstOrThrow({ where: { projectId, status: "applied" } });
      const proposal = JSON.parse(restoredRun.proposalJson) as { chapterRecordId: string };
      expect(proposal.chapterRecordId).toBe(restoredRun.chapterRecordId);
      expect(proposal.chapterRecordId).not.toBe(IDS.chapter);
      expect(await remapped.db.storyEvent.count()).toBe(1);
    } finally {
      await preserved.cleanup();
      await remapped.cleanup();
    }
  });

  it("shows the exact request before sending and drops categories that were not asked for", async () => {
    await startAuthorRewrite(t.db, IDS.project);
    const before = await t.db.chapterAnalysisRun.count();
    const preview = await previewChapterAnalysis(t.db, runtime, {
      projectId: IDS.project,
      chapterRecordId: IDS.chapter,
      pinnedRevision: 1,
      categories: ["event"],
    });
    expect(await t.db.chapterAnalysisRun.count()).toBe(before);
    expect(preview.model).toBe("test-model");
    expect(preview.categories).toEqual(["event"]);
    expect(preview.userText).toContain("CATEGORIES TO PROPOSE");
    expect(preview.userText).toContain(CHAPTER_PROSE);
    expect(preview.userText).not.toContain("character_presence:");
    expect(preview.instructions).toContain("Later, she understood");
    expect(preview.outputTokenAllowance).toBe(8_000);
    expect(preview.inputChars).toBeGreaterThan(preview.userChars);
    expect(preview.problem).toBeNull();

    let sentTokens = 0;
    const prep = await prepareChapterAnalysis(t.db, runtime, {
      projectId: IDS.project,
      chapterRecordId: IDS.chapter,
      pinnedRevision: 1,
      categories: ["event"],
      expectedSourceHash: preview.sourceHash,
    });
    const run = await runChapterAnalysis(
      t.db,
      {
        async *stream() {},
        async structured(request) {
          sentTokens = request.maxOutputTokens;
          return {
            status: "complete" as const,
            text: JSON.stringify({
              suggestions: [
                suggestion({ kind: "location", title: "The Dry Vault", excerpt: OPENING }),
                suggestion({ kind: "event", title: "The ledger dried", excerpt: OPENING }),
              ],
            }),
            usage: { inputTokens: 3, outputTokens: 3, totalTokens: 6 },
          };
        },
      },
      prep,
      new AbortController().signal,
    );
    expect(sentTokens).toBe(8_000);
    expect(run.proposal?.suggestions.map((item) => item.kind)).toEqual(["event"]);
    expect(run.categories).toEqual(["event"]);
  });

  it("treats truncated, refused, and invalid output as unusable and counts reported usage", async () => {
    await startAuthorRewrite(t.db, IDS.project);
    const beforeRecords = await t.db.record.count();
    const prep = await prepareChapterAnalysis(t.db, runtime, { projectId: IDS.project, chapterRecordId: IDS.chapter, pinnedRevision: 1 });
    const truncated = await runChapterAnalysis(
      t.db,
      {
        async *stream() {},
        async structured() {
          return {
            status: "incomplete",
            incompleteReason: "max_output_tokens",
            responseId: "resp_cut_off",
            usage: { inputTokens: 11, outputTokens: 29, totalTokens: 40 },
          };
        },
      },
      prep,
      new AbortController().signal,
    );
    expect(truncated.status).toBe("failed");
    expect(truncated.proposal).toBeNull();
    expect(truncated.usage).toMatchObject({ totalTokens: 40, estimated: false });
    expect(truncated.diagnostics).toContain("resp_cut_off");
    expect(truncated.diagnostics).not.toContain(OPENING);
    expect(truncated.diagnostics).not.toContain("sk-");
    await expect(applyChapterAnalysis(t.db, IDS.project, truncated.id, truncated.contentHash, {})).rejects.toThrow(/no suggestions/);
    expect(await t.db.record.count()).toBe(beforeRecords);

    const refusedPrep = await prepareChapterAnalysis(t.db, runtime, { projectId: IDS.project, chapterRecordId: IDS.chapter, pinnedRevision: 1 });
    const refused = await runChapterAnalysis(
      t.db,
      {
        async *stream() {},
        async structured() {
          return { status: "refused", refusal: "no", usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 } } satisfies StructuredResult;
        },
      },
      refusedPrep,
      new AbortController().signal,
    );
    expect(refused.status).toBe("failed");
    expect(refused.proposal).toBeNull();
    expect(refused.errorMessage).toMatch(/declined/);
    expect(refused.usage?.totalTokens).toBe(3);

    const badPrep = await prepareChapterAnalysis(t.db, runtime, { projectId: IDS.project, chapterRecordId: IDS.chapter, pinnedRevision: 1 });
    const bad = await runChapterAnalysis(
      t.db,
      {
        async *stream() {},
        async structured() {
          return { status: "complete", text: "{\"suggestions\":[{\"kind\":\"event\"}]}" };
        },
      },
      badPrep,
      new AbortController().signal,
    );
    expect(bad.status).toBe("failed");
    expect(bad.proposal).toBeNull();
    expect(bad.usage).toBeNull();
    expect(await t.db.record.count()).toBe(beforeRecords);
    expect(await t.db.storyEvent.count()).toBe(0);

    const usage = await usageSummary(t.db, runtime.limits, new Date());
    expect(usage.monthTokens).toBeGreaterThanOrEqual(43);
    const tight = { ...runtime, limits: { ...runtime.limits, monthlyTokenCap: usage.monthTokens } };
    await expect(
      prepareChapterAnalysis(t.db, tight, { projectId: IDS.project, chapterRecordId: IDS.chapter, pinnedRevision: 1 }),
    ).rejects.toThrow(/token/);
    const hourly = { ...runtime, limits: { ...runtime.limits, maxRequestsPerHour: 1 } };
    await expect(
      prepareChapterAnalysis(t.db, hourly, { projectId: IDS.project, chapterRecordId: IDS.chapter, pinnedRevision: 1 }),
    ).rejects.toThrow(/hour/);
  });

  it("blocks a repeated quotation that does not say which copy, and does not treat a true quote as a true reading", async () => {
    await startAuthorRewrite(t.db, IDS.project);
    const line = "The bell rang once.";
    const twice = `${CHAPTER_PROSE} ${line} Then quiet. ${line}`;
    await updateRecord(t.db, IDS.project, { recordId: IDS.chapter, expectedRevision: 1, body: twice, unlockProtected: true });
    const ambiguous = enrichAnalysisSuggestions(
      { id: IDS.chapter, title: "Chapter 1", pinnedRevision: 2 },
      twice,
      [suggestion({ kind: "event", title: "The bell", excerpt: line, occurrence: 9 })],
      { records: [], facts: [], events: [], beats: [] },
    );
    expect(ambiguous.suggestions[0]?.quoteValid).toBe(false);
    expect(ambiguous.suggestions[0]?.blockedReason).toMatch(/appears 2 times/);
    const located = enrichAnalysisSuggestions(
      { id: IDS.chapter, title: "Chapter 1", pinnedRevision: 2 },
      twice,
      [suggestion({ kind: "event", title: "The bell", excerpt: line, occurrence: 2 })],
      { records: [], facts: [], events: [], beats: [] },
    );
    expect(located.suggestions[0]?.passage?.start).toBe(twice.lastIndexOf(line));

    const run = await analyze(t, IDS.chapter, 2, [
      suggestion({ kind: "event", title: "The bell", excerpt: line, occurrence: 9, note: "This reading is not supported." }),
    ]);
    await expect(applyChapterAnalysis(t.db, IDS.project, run.id, run.contentHash, decision(run, "The bell", "create"))).rejects.toThrow(/pinned/);
    expect(await t.db.storyEvent.count()).toBe(0);

    const wrong = await analyze(t, IDS.chapter, 2, [
      suggestion({ kind: "event", title: "The bell fell", excerpt: line, note: "The bell fell, which the sentence does not say." }),
    ]);
    const item = wrong.proposal?.suggestions[0];
    expect(item?.passageVerified).toBe(true);
    expect(item?.boundary).toMatch(/plan|happened|intention/);
    await saveChapterAnalysisAssessments(t.db, IDS.project, wrong.id, { [item!.key]: "unsupported" });
    expect(await t.db.storyEvent.count()).toBe(0);
    expect((await getChapterAnalysis(t.db, IDS.project, wrong.id)).assessments[item!.key]).toBe("unsupported");
  });

  it("keeps a mention, a revelation, and an intention from being upgraded", async () => {
    await startAuthorRewrite(t.db, IDS.project);
    const mentioned = `${CHAPTER_PROSE} They spoke of Mara Venn in the salt letter. She planned to open the vault tomorrow.`;
    await updateRecord(t.db, IDS.project, { recordId: IDS.chapter, expectedRevision: 1, body: mentioned, unlockProtected: true });
    const run = await analyze(t, IDS.chapter, 2, [
      suggestion({ kind: "character_presence", title: "Mara Venn", excerpt: "They spoke of Mara Venn in the salt letter." }),
      suggestion({ kind: "event", title: "The vault opening", excerpt: "She planned to open the vault tomorrow." }),
      suggestion({ kind: "reader_revelation", title: "The ledger dried", excerpt: OPENING, note: "The reader is told the ledger dried." }),
    ]);
    const mention = run.proposal?.suggestions.find((item) => item.kind === "character_presence");
    const intention = run.proposal?.suggestions.find((item) => item.kind === "event");
    expect(mention?.uncertain).toBe(true);
    expect(mention?.uncertainty).toMatch(/not physical presence/);
    expect(intention?.uncertain).toBe(true);
    expect(intention?.uncertainty).toMatch(/not an event that has happened/);
    expect(run.status).toBe("proposed");
    expect(await t.db.establishedFact.count()).toBe(0);
    expect(await t.db.storyEvent.count()).toBe(0);

    await createStoryEvent(t.db, IDS.project, { title: "The ledger dried" });
    const revealed = await analyze(t, IDS.chapter, 2, [
      suggestion({ kind: "reader_revelation", title: "The ledger dried", excerpt: OPENING }),
    ]);
    await applyChapterAnalysis(t.db, IDS.project, revealed.id, revealed.contentHash, decision(revealed, "The ledger dried", "reuse"));
    expect(await t.db.storyEventScene.count()).toBe(1);
    expect(await t.db.establishedFact.count()).toBe(0);
  });

  it("refuses an order word that does not relate the events, and a cycle added after the proposal", async () => {
    const rewrite = await startAuthorRewrite(t.db, IDS.project);
    const drying = await createStoryEvent(t.db, IDS.project, { title: "The drying", draftScope: rewrite.zeroDraft.id });
    const morning = await createStoryEvent(t.db, IDS.project, { title: "The morning check", draftScope: rewrite.zeroDraft.id });
    const loose = `${CHAPTER_PROSE} Later, she understood.`;
    await updateRecord(t.db, IDS.project, { recordId: IDS.chapter, expectedRevision: 1, body: loose, unlockProtected: true });
    const looseRun = await analyze(t, IDS.chapter, 2, [
      suggestion({
        kind: "chronology",
        title: "Understood later",
        excerpt: "Later, she understood.",
        explicitOrder: true,
        earlierTitle: "The drying",
        laterTitle: "The morning check",
      }),
    ]);
    expect(looseRun.proposal?.suggestions[0]?.quoteValid).toBe(false);
    await expect(
      applyChapterAnalysis(t.db, IDS.project, looseRun.id, looseRun.contentHash, decision(looseRun, "Understood later", "create")),
    ).rejects.toThrow(/quote|pinned/);
    expect(await t.db.storyEventOrder.count()).toBe(0);

    const ordered = `${CHAPTER_PROSE} The drying comes before the morning check.`;
    await updateRecord(t.db, IDS.project, { recordId: IDS.chapter, expectedRevision: 2, body: ordered, unlockProtected: true });
    const run = await analyze(t, IDS.chapter, 3, [
      suggestion({
        kind: "chronology",
        title: "Drying first",
        excerpt: "The drying comes before the morning check.",
        explicitOrder: true,
        earlierTitle: "The drying",
        laterTitle: "The morning check",
      }),
    ]);
    expect(run.proposal?.suggestions[0]?.quoteValid).toBe(true);
    await orderStoryEvents(t.db, IDS.project, {
      eventId: morning.id,
      otherEventId: drying.id,
      direction: "before",
      expectedRevision: 0,
    });
    await expect(
      applyChapterAnalysis(t.db, IDS.project, run.id, run.contentHash, decision(run, "Drying first", "create")),
    ).rejects.toThrow(/contradict/);
    expect(await t.db.storyEventOrder.count()).toBe(1);
    expect((await getChapterAnalysis(t.db, IDS.project, run.id)).status).toBe("proposed");
  });

  it("refuses a stale target, leaves a skipped dependency uncreated, and does not duplicate a later apply", async () => {
    await startAuthorRewrite(t.db, IDS.project);
    const mara = await getRecord(t.db, IDS.project, IDS.dossier);
    const run = await analyze(t, IDS.chapter, 1, [
      suggestion({ kind: "character_presence", title: "Mara Venn", excerpt: KNEW }),
      suggestion({ kind: "character_learning", title: "Mara Venn", excerpt: KNEW, note: "Mara learns the ledger is dry." }),
    ]);
    const learningKey = run.proposal?.suggestions.find((item) => item.kind === "character_learning")?.key;
    expect(run.proposal?.suggestions.find((item) => item.kind === "character_learning")?.dependsOnKeys.length).toBe(1);
    await expect(
      applyChapterAnalysis(t.db, IDS.project, run.id, run.contentHash, {
        ...decision(run, "Mara Venn", "skip", undefined, "character_presence"),
        ...decision(run, "Mara Venn", "reuse", undefined, "character_learning"),
      }),
    ).rejects.toThrow(/depends on/);
    expect(await t.db.establishedFact.count()).toBe(0);

    await updateRecord(t.db, IDS.project, {
      recordId: IDS.dossier,
      expectedRevision: mara.currentRevision,
      title: "Mara Venn, revised",
      unlockProtected: true,
    });
    await expect(
      applyChapterAnalysis(t.db, IDS.project, run.id, run.contentHash, decision(run, "Mara Venn", "reuse", undefined, "character_presence")),
    ).rejects.toThrow(/changed after this analysis/);
    expect(await t.db.establishedFact.count()).toBe(0);

    const fresh = await analyze(t, IDS.chapter, 1, [
      suggestion({ kind: "character_presence", title: "Mara Venn, revised", excerpt: KNEW }),
      suggestion({ kind: "event", title: "The ledger dried", excerpt: OPENING }),
    ]);
    const applied = await applyChapterAnalysis(t.db, IDS.project, fresh.id, fresh.contentHash, {
      ...decision(fresh, "Mara Venn, revised", "reuse"),
      ...decision(fresh, "The ledger dried", "skip"),
    });
    const stored = await getChapterAnalysis(t.db, IDS.project, fresh.id);
    const skipped = stored.proposal?.suggestions.find((item) => item.kind === "event")?.key;
    expect(stored.appliedKeys).not.toContain(skipped);
    expect(applied.status).toBe("applied");
    const again = await applyChapterAnalysis(t.db, IDS.project, fresh.id, fresh.contentHash, {
      ...decision(fresh, "Mara Venn, revised", "reuse"),
      ...decision(fresh, "The ledger dried", "create"),
    });
    expect(again.status).toBe("applied");
    expect(await t.db.storyEvent.count()).toBe(1);
    const third = await applyChapterAnalysis(t.db, IDS.project, fresh.id, fresh.contentHash, {
      ...decision(fresh, "Mara Venn, revised", "reuse"),
      ...decision(fresh, "The ledger dried", "create"),
    });
    expect(third.status).toBe("already_applied");
    expect(await t.db.storyEvent.count()).toBe(1);
    expect(learningKey).toBeTruthy();
  });

  it("still applies an older proposal and restores a backup that omits the new review fields", async () => {
    const rewrite = await startAuthorRewrite(t.db, IDS.project);
    const start = CHAPTER_PROSE.indexOf(OPENING);
    const proposal = {
      chapterRecordId: IDS.chapter,
      chapterTitle: "Chapter 1",
      pinnedRevision: 1,
      suggestions: [
        {
          key: "s1",
          kind: "event",
          title: "Legacy event",
          note: "",
          uncertain: false,
          uncertainty: "",
          passage: { start, end: start + OPENING.length, excerpt: OPENING },
          quoteValid: true,
          explicitOrder: false,
          earlierTitle: "",
          laterTitle: "",
          dependsOnKeys: [],
          match: { status: "none", candidates: [] },
        },
      ],
    };
    await t.db.chapterAnalysisRun.create({
      data: {
        id: "car_test_legacy_shape",
        workspaceId: IDS.workspace,
        projectId: IDS.project,
        chapterRecordId: IDS.chapter,
        draftId: rewrite.zeroDraft.id,
        pinnedRevision: 1,
        status: "proposed",
        sourceHash: sha256(`${IDS.chapter}\n1\n${CHAPTER_PROSE}`),
        contentHash: "legacyhash",
        proposalJson: JSON.stringify(proposal),
        sentMaterialJson: "older request",
        requestChars: 12,
        model: "test-model",
      },
    });
    const loaded = await getChapterAnalysis(t.db, IDS.project, "car_test_legacy_shape");
    expect(loaded.categories).toEqual([]);
    expect(loaded.proposal?.suggestions[0]?.passageVerified).toBeUndefined();
    await applyChapterAnalysis(t.db, IDS.project, loaded.id, "legacyhash", { s1: { action: "create" } });
    expect(await t.db.storyEvent.count({ where: { title: "Legacy event" } })).toBe(1);
    const older = await createWorkspaceBackup(t.db, IDS.workspace);
    const olderRow = older.chapterAnalyses?.find((row) => row.id === "car_test_legacy_shape");
    expect(olderRow?.categoriesJson).toBeUndefined();
    expect(olderRow?.assessmentsJson).toBeUndefined();

    const modern = await analyze(t, IDS.chapter, 1, [suggestion({ kind: "event", title: "The ledger dried", excerpt: OPENING })]);
    await saveChapterAnalysisAssessments(t.db, IDS.project, modern.id, { s1: "correct" });
    const backup = await createWorkspaceBackup(t.db, IDS.workspace);
    const analysis = backup.chapterAnalyses?.find((row) => row.id === modern.id);
    expect(analysis?.categoriesJson).toContain("event");
    expect(analysis?.assessmentsJson).toContain("correct");

    const restored = await createTestDb();
    const copied = await createTestDb();
    try {
      const result = await restoreWorkspaceBackup(restored.db, JSON.stringify(older), { idStrategy: "preserve" });
      expect(result.ok).toBe(true);
      const row = await restored.db.chapterAnalysisRun.findFirstOrThrow({ where: { id: "car_test_legacy_shape" } });
      expect(row.categoriesJson).toBe("[]");
      expect(row.assessmentsJson).toBe("{}");
      expect(row.outputTokenAllowance).toBe(0);
      const kept = await restoreWorkspaceBackup(copied.db, JSON.stringify(backup), { idStrategy: "preserve" });
      expect(kept.ok).toBe(true);
      const modernRow = await copied.db.chapterAnalysisRun.findFirstOrThrow({ where: { id: modern.id } });
      expect(modernRow.categoriesJson).toContain("event");
      expect(modernRow.assessmentsJson).toContain("correct");
    } finally {
      await restored.cleanup();
      await copied.cleanup();
    }
  });
});
