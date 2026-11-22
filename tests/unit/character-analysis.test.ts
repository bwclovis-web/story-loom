import { describe, expect, it } from "vitest";
import {
  aggregateCharacterFindings,
  parseCharacterAnalysisOutput,
  segmentManuscriptUnits,
  verifyAndEnrichFindings,
  applyFindingDecision,
  emptyDecision,
  type CharacterAnalysisDraftFinding,
  type SourceCatalogEntry,
  type CharacterAnalysisFinding,
} from "@/domain/characterAnalysis";

const CHAPTER =
  "The ledger had been dry for three hundred years. Mara Venn knew this because she had checked it every morning.";

function draft(over: Partial<CharacterAnalysisDraftFinding> = {}): CharacterAnalysisDraftFinding {
  return {
    action: "motivations",
    observation: "Mara checks the ledger from habit.",
    supportingEvidence: ["she had checked it every morning"],
    sourceRefs: [{ recordId: "rec_ch1", excerpt: "she had checked it every morning", occurrence: 1, kind: "manuscript" }],
    characterRecordId: "rec_mara",
    characterName: "Mara Venn",
    storyLocation: {
      bookProjectId: "prj_1",
      bookLabel: "Book 1",
      chapterRecordId: "rec_ch1",
      chapterTitle: "Chapter 1",
      sceneRecordId: "",
      sceneTitle: "",
      storyEventId: "",
      storyPositionLabel: "Chapter 1",
    },
    reasoning: "Daily checking implies a habit tied to her role.",
    uncertain: false,
    uncertaintyNote: "",
    suggestedAction: {
      kind: "profile_field",
      targetPath: "psychology.coreMotivation",
      value: "Keep the ledger accurate",
      reviewCheck: "",
    },
    planComparison: null,
    deliberateChoiceAssessment: "unclear",
    ...over,
  };
}

describe("character analysis domain", () => {
  it("parses a valid structured response", () => {
    const parsed = parseCharacterAnalysisOutput(JSON.stringify({ findings: [draft()] }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.findings).toHaveLength(1);
  });

  it("rejects malformed JSON and missing findings", () => {
    expect(parseCharacterAnalysisOutput("{").ok).toBe(false);
    expect(parseCharacterAnalysisOutput(JSON.stringify({ observations: [] })).ok).toBe(false);
  });

  it("verifies quotations against the catalog and blocks fabrications", () => {
    const catalog = new Map<string, SourceCatalogEntry>([
      [
        "rec_ch1",
        {
          recordId: "rec_ch1",
          recordTitle: "Chapter 1",
          projectId: "prj_1",
          revisionNumber: 1,
          kind: "manuscript",
          body: CHAPTER,
        },
      ],
    ]);
    const ok = verifyAndEnrichFindings([draft()], catalog, new Set(["rec_mara"]), 0, () => "caf_1");
    expect(ok[0]?.sourceVerified).toBe(true);
    expect(ok[0]?.sourceRefs[0]?.passageStart).toBeGreaterThanOrEqual(0);

    const bad = verifyAndEnrichFindings(
      [draft({ sourceRefs: [{ recordId: "rec_ch1", excerpt: "invented quotation", occurrence: 1, kind: "manuscript" }] })],
      catalog,
      new Set(["rec_mara"]),
      0,
      () => "caf_2",
    );
    expect(bad[0]?.sourceVerified).toBe(false);
    expect(bad[0]?.blockedReason).toMatch(/not in the pinned revision/i);
  });

  it("blocks unknown source and character ids", () => {
    const catalog = new Map<string, SourceCatalogEntry>();
    const findings = verifyAndEnrichFindings([draft()], catalog, new Set(["rec_other"]), 0, () => "caf_3");
    expect(findings[0]?.sourceVerified).toBe(false);
  });

  it("aggregates and deduplicates findings across segments", () => {
    const base: CharacterAnalysisFinding = {
      id: "a",
      action: "motivations",
      observation: "Mara checks the ledger from habit.",
      supportingEvidence: ["she had checked it every morning"],
      sourceRefs: [
        {
          recordId: "rec_ch1",
          recordTitle: "Chapter 1",
          projectId: "prj_1",
          revisionNumber: 1,
          kind: "manuscript",
          passageStart: 10,
          passageEnd: 40,
          excerpt: "she had checked it every morning",
          occurrence: 1,
          verified: true,
        },
      ],
      characterRecordId: "rec_mara",
      characterName: "Mara",
      storyLocation: {
        bookProjectId: "prj_1",
        bookLabel: "Book 1",
        chapterRecordId: "rec_ch1",
        chapterTitle: "Chapter 1",
        sceneRecordId: null,
        sceneTitle: null,
        storyEventId: null,
        storyPositionLabel: "Chapter 1",
      },
      reasoning: "Habit",
      uncertain: false,
      uncertaintyNote: "",
      suggestedAction: { kind: "none", targetPath: "", value: "", reviewCheck: "" },
      planComparison: null,
      deliberateChoiceAssessment: "unclear",
      sourceVerified: true,
      segmentIndex: 0,
    };
    const duplicate = {
      ...base,
      id: "b",
      supportingEvidence: ["The ledger had been dry for three hundred years."],
      segmentIndex: 1,
      sourceRefs: [
        {
          ...base.sourceRefs[0]!,
          recordId: "rec_ch2",
          excerpt: "The ledger had been dry for three hundred years.",
        },
      ],
    };
    const merged = aggregateCharacterFindings([base, duplicate]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.supportingEvidence).toHaveLength(2);
    expect(merged[0]?.sourceRefs).toHaveLength(2);
  });

  it("segments large manuscript units without dropping offsets", () => {
    const long = `${"Paragraph one.\n\n".repeat(40)}${"Paragraph two.\n\n".repeat(40)}`;
    const segments = segmentManuscriptUnits([{ recordId: "rec_ch1", label: "Chapter 1", body: long, projectId: "prj_1" }], 200);
    expect(segments.length).toBeGreaterThan(1);
    expect(segments[0]?.passages[0]?.start).toBe(0);
    const last = segments[segments.length - 1]!;
    expect(last.passages[0]?.end).toBe(long.length);
  });

  it("records approval history when decisions change", () => {
    const next = applyFindingDecision(emptyDecision(), { action: "defer", reason: "Later" });
    expect(next.action).toBe("defer");
    expect(next.history).toHaveLength(1);
    expect(next.history[0]?.action).toBe("defer");
  });
});
