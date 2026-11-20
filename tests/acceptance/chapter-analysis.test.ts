import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProviderError, type AssistantProvider } from "@/assistant/provider";
import type { AnalysisDraftSuggestion } from "@/analyze/chapterAnalysisOutput";
import {
  applyChapterAnalysis,
  enrichAnalysisSuggestions,
  getChapterAnalysis,
  manuscriptCountsByDraft,
  prepareChapterAnalysis,
  runChapterAnalysis,
  type ChapterAnalysisRunView,
} from "@/server/services/chapterAnalysisService";
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
    expect(dropped.suggestions).toHaveLength(0);

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
});
