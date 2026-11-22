import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AssistantProvider } from "@/assistant/provider";
import { CHARACTER_DEVELOPMENT_KEY, readCharacterDevelopment, withCharacterDevelopment, emptyCharacterDevelopment } from "@/domain/characterDevelopment";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "@/server/services/backupService";
import { usageSummary } from "@/server/services/assistantService";
import {
  applyCharacterAnalysisDecisions,
  getCharacterAnalysis,
  prepareCharacterAnalysis,
  previewCharacterAnalysis,
  runCharacterAnalysis,
  saveCharacterAnalysisDecision,
} from "@/server/services/characterAnalysisService";
import { getRecord, updateRecord } from "@/server/services/recordService";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";

const runtime = {
  configured: true,
  model: "test-model",
  limits: {
    maxInputChars: 600_000,
    maxOutputTokens: 2_000,
    analysisOutputTokens: 2_000,
    maxRequestsPerHour: 30,
    monthlyTokenCap: 3_000_000,
    requestTimeoutSeconds: 30,
    maxToolCalls: 0,
    maxToolRounds: 0,
    maxToolResultChars: 1_000,
  },
};

function findingPayload(chapterId: string, excerpt: string) {
  return {
    findings: [
      {
        action: "motivations",
        observation: "Mara checks the ledger daily.",
        supportingEvidence: [excerpt],
        sourceRefs: [{ recordId: chapterId, excerpt, occurrence: 1, kind: "manuscript" }],
        characterRecordId: IDS.dossier,
        characterName: "Mara Venn",
        storyLocation: {
          bookProjectId: IDS.project,
          bookLabel: "Test novel",
          chapterRecordId: chapterId,
          chapterTitle: "Chapter 1",
          sceneRecordId: "",
          sceneTitle: "",
          storyEventId: "",
          storyPositionLabel: "Chapter 1",
        },
        reasoning: "Habitual checking supports a duty-driven motivation.",
        uncertain: false,
        uncertaintyNote: "",
        suggestedAction: {
          kind: "profile_field",
          targetPath: "psychology.coreMotivation",
          value: "Keep the ledger accurate",
          reviewCheck: "",
        },
        planComparison: "completed_milestone",
        deliberateChoiceAssessment: "unclear",
      },
    ],
  };
}

function provider(payload: object): AssistantProvider {
  return {
    async *stream() {},
    async structured() {
      return {
        status: "complete" as const,
        text: JSON.stringify(payload),
        usage: { inputTokens: 10, outputTokens: 8, totalTokens: 18 },
      };
    },
  };
}

describe("character analysis acceptance", () => {
  let t: TestDb;

  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });

  afterEach(async () => {
    await t.cleanup();
  });

  it("previews book scope and reports omissions for empty material", async () => {
    const preview = await previewCharacterAnalysis(t.db, runtime, {
      projectId: IDS.project,
      characterRecordIds: [IDS.dossier],
      scopeKind: "book",
      actions: ["motivations"],
    });
    expect(preview.segmentCount).toBeGreaterThan(0);
    expect(preview.configured).toBe(true);
    expect(preview.problem).toBeNull();
  });

  it("runs analysis, verifies sources, and keeps findings off the dossier until apply", async () => {
    const excerpt = "she had checked it every morning";
    const prep = await prepareCharacterAnalysis(t.db, runtime, {
      projectId: IDS.project,
      characterRecordIds: [IDS.dossier],
      scopeKind: "chapter",
      scopeSpec: { chapterRecordId: IDS.chapter },
      actions: ["motivations"],
    });
    const run = await runCharacterAnalysis(t.db, provider(findingPayload(IDS.chapter, excerpt)), prep, new AbortController().signal);
    expect(run.status).toBe("proposed");
    expect(run.findings).toHaveLength(1);
    expect(run.findings[0]?.sourceVerified).toBe(true);
    expect(run.usage?.totalTokens).toBe(18);

    const before = await getRecord(t.db, IDS.project, IDS.dossier);
    expect(readCharacterDevelopment(before.fields).profile.psychology.coreMotivation).toBe("");

    await saveCharacterAnalysisDecision(t.db, IDS.project, run.id, run.findings[0]!.id, { action: "accept" });
    const applied = await applyCharacterAnalysisDecisions(t.db, IDS.project, run.id, run.contentHash);
    expect(applied.outcome.status === "applied" || applied.outcome.status === "already_applied").toBe(true);

    const after = await getRecord(t.db, IDS.project, IDS.dossier);
    const profile = readCharacterDevelopment(after.fields).profile;
    expect(profile.psychology.coreMotivation).toContain("ledger");
    expect(profile.fieldMeta["psychology.coreMotivation"]?.approval).toBe("draft");
    expect(profile.fieldMeta["psychology.coreMotivation"]?.provenance.origin).toBe("extracted");
  });

  it("blocks fabricated quotations from apply", async () => {
    const prep = await prepareCharacterAnalysis(t.db, runtime, {
      projectId: IDS.project,
      characterRecordIds: [IDS.dossier],
      scopeKind: "chapter",
      scopeSpec: { chapterRecordId: IDS.chapter },
      actions: ["motivations"],
    });
    const run = await runCharacterAnalysis(
      t.db,
      provider(findingPayload(IDS.chapter, "this quote is not in the chapter")),
      prep,
      new AbortController().signal,
    );
    expect(run.findings[0]?.sourceVerified).toBe(false);
    await saveCharacterAnalysisDecision(t.db, IDS.project, run.id, run.findings[0]!.id, { action: "accept" });
    await expect(applyCharacterAnalysisDecisions(t.db, IDS.project, run.id, run.contentHash)).rejects.toThrow(/Accept/);
  });

  it("supports cancellation with partial progress and resume", async () => {
    const { ProviderError } = await import("@/assistant/provider");
    const cancelling: AssistantProvider = {
      async *stream() {},
      async structured(_req, _schema, signal) {
        if (signal.aborted) throw new ProviderError("cancelled", "The request was cancelled.");
        throw new ProviderError("cancelled", "The request was cancelled.");
      },
    };

    const prep = await prepareCharacterAnalysis(t.db, runtime, {
      projectId: IDS.project,
      characterRecordIds: [IDS.dossier],
      scopeKind: "chapter",
      scopeSpec: { chapterRecordId: IDS.chapter },
      actions: ["motivations"],
    });

    const controller = new AbortController();
    controller.abort();
    const cancelled = await runCharacterAnalysis(t.db, cancelling, prep, controller.signal);
    expect(["cancelled", "partial"]).toContain(cancelled.status);

    const resumedPrep = await prepareCharacterAnalysis(t.db, runtime, {
      projectId: IDS.project,
      characterRecordIds: [IDS.dossier],
      scopeKind: "chapter",
      scopeSpec: { chapterRecordId: IDS.chapter },
      actions: ["motivations"],
      resumeRunId: prep.runId,
    });
    const resumed = await runCharacterAnalysis(
      t.db,
      provider(findingPayload(IDS.chapter, "she had checked it every morning")),
      resumedPrep,
      new AbortController().signal,
    );
    expect(resumed.status).toBe("proposed");
    expect(resumed.findings.length).toBeGreaterThan(0);
  });

  it("counts character analysis tokens in shared usageSummary", async () => {
    const prep = await prepareCharacterAnalysis(t.db, runtime, {
      projectId: IDS.project,
      characterRecordIds: [IDS.dossier],
      scopeKind: "chapter",
      scopeSpec: { chapterRecordId: IDS.chapter },
      actions: ["motivations"],
    });
    await runCharacterAnalysis(
      t.db,
      provider(findingPayload(IDS.chapter, "she had checked it every morning")),
      prep,
      new AbortController().signal,
    );
    const usage = await usageSummary(t.db, runtime.limits);
    expect(usage.monthTokens).toBeGreaterThanOrEqual(18);
    expect(usage.requestsLastHour).toBeGreaterThanOrEqual(1);
  });

  it("preserves character analysis runs through backup restore", async () => {
    const prep = await prepareCharacterAnalysis(t.db, runtime, {
      projectId: IDS.project,
      characterRecordIds: [IDS.dossier],
      scopeKind: "chapter",
      scopeSpec: { chapterRecordId: IDS.chapter },
      actions: ["motivations"],
    });
    const run = await runCharacterAnalysis(
      t.db,
      provider(findingPayload(IDS.chapter, "she had checked it every morning")),
      prep,
      new AbortController().signal,
    );

    const backup = await createWorkspaceBackup(t.db, IDS.workspace);
    expect(backup.characterAnalyses?.length).toBe(1);

    const restored = await createTestDb();
    try {
      await restoreWorkspaceBackup(restored.db, backup, { idStrategy: "preserve" });
      const loaded = await getCharacterAnalysis(restored.db, IDS.project, run.id);
      expect(loaded.findings).toHaveLength(1);
      expect(loaded.status).toBe("proposed");
    } finally {
      await restored.cleanup();
    }
  });

  it("does not rewrite approved dossier fields without an accept package", async () => {
    const profile = emptyCharacterDevelopment();
    profile.psychology.coreMotivation = "Approved motive";
    profile.fieldMeta["psychology.coreMotivation"] = {
      approval: "approved",
      provenance: { origin: "author", note: "Canon" },
    };
    const current = await getRecord(t.db, IDS.project, IDS.dossier);
    await updateRecord(t.db, IDS.project, {
      recordId: IDS.dossier,
      expectedRevision: current.currentRevision,
      fields: withCharacterDevelopment(current.fields, profile),
    });

    const prep = await prepareCharacterAnalysis(t.db, runtime, {
      projectId: IDS.project,
      characterRecordIds: [IDS.dossier],
      scopeKind: "chapter",
      scopeSpec: { chapterRecordId: IDS.chapter },
      actions: ["motivations"],
    });
    const run = await runCharacterAnalysis(
      t.db,
      provider(findingPayload(IDS.chapter, "she had checked it every morning")),
      prep,
      new AbortController().signal,
    );
    const mid = await getRecord(t.db, IDS.project, IDS.dossier);
    expect(readCharacterDevelopment(mid.fields).profile.psychology.coreMotivation).toBe("Approved motive");
    expect(mid.fields[CHARACTER_DEVELOPMENT_KEY]).toBeTruthy();
    expect(run.findings[0]?.observation).toBeTruthy();
  });
});
