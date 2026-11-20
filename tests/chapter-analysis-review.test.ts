import { describe, expect, it } from "vitest";
import { estimateTokens, DEFAULT_ANALYSIS_OUTPUT_TOKENS } from "@/assistant/config";
import { ANALYSIS_KINDS } from "@/analyze/chapterAnalysisOutput";
import { actionExplanation, chronologyGap, describeWrites, resolveQuotation, summarizeRun } from "@/analyze/chapterAnalysisReview";
import type { AnalysisSuggestion } from "@/analyze/chapterAnalysisOutput";

describe("chapter analysis review rules", () => {
  const body = "Alpha rang the bell. Later, she understood. Alpha rang the bell.";

  it("resolves one quotation and refuses a silent first match among several", () => {
    const once = "Later, she understood.";
    expect(resolveQuotation(body, once, 1).ok).toBe(true);
    expect(resolveQuotation(body, once, 2).ok).toBe(false);
    const repeated = "Alpha rang the bell.";
    const second = resolveQuotation(body, repeated, 2);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.start).toBe(body.lastIndexOf(repeated));
    expect(resolveQuotation(body, repeated, 9).ok).toBe(false);
    expect(resolveQuotation(body, "not in the chapter", 1).ok).toBe(false);
  });

  it("does not treat an order word as a relationship between unnamed events", () => {
    expect(chronologyGap("Later, she understood.", "The drying", "The morning check")).toMatch(/both events/);
    expect(chronologyGap("The morning check comes before the drying.", "The drying", "The morning check")).toBeNull();
  });

  it("sizes the analysis allowance from a representative response, not the chat cap", () => {
    const excerpt = "The archivist copied the dry ledger into the margin and initialed the date.";
    expect(excerpt.length).toBeGreaterThanOrEqual(70);
    const suggestions = ANALYSIS_KINDS.flatMap((kind) =>
      [1, 2, 3].map((index) => ({
        kind,
        excerpt: `${excerpt} Example ${index} of ${kind}, kept long enough to stand for a real quotation.`,
        title: `Suggested ${kind} ${index}`,
        note: "A short proposed reading of that quotation for the author to accept or skip.",
        uncertain: true,
        uncertainty: "The sentence may be dialogue rather than an established fact.",
        occurrence: 1,
        explicitOrder: kind === "chronology",
        earlierTitle: "The drying",
        laterTitle: "The morning check",
      })),
    );
    expect(suggestions).toHaveLength(24);
    const tokens = estimateTokens(JSON.stringify({ suggestions }).length);
    expect(tokens).toBeGreaterThan(2_000);
    expect(tokens).toBeLessThanOrEqual(DEFAULT_ANALYSIS_OUTPUT_TOKENS);
  });

  it("summarizes a run without turning accepts into an accuracy score", () => {
    const summary = summarizeRun(
      [
        {
          key: "s1",
          kind: "event",
          title: "One",
          note: "",
          uncertain: false,
          uncertainty: "",
          passage: null,
          quoteValid: true,
          explicitOrder: false,
          earlierTitle: "",
          laterTitle: "",
          dependsOnKeys: [],
          match: { status: "none", candidates: [] },
        },
      ],
      { s1: { action: "skip" } },
      {},
      [],
      null,
    );
    expect(summary.skipped).toBe(1);
    expect(summary.applied).toBe(0);
    expect(JSON.stringify(summary)).not.toMatch(/percent|accuracy/i);
  });

  it("explains the write for each action and leaves a rating out of that write", () => {
    expect(actionExplanation("location", "reuse")).toMatch(/Link to a record already in your project/);
    expect(actionExplanation("location", "reuse")).toMatch(/does not create another place/);
    expect(actionExplanation("reference_evidence", "create")).toMatch(/pending fact/);
    expect(actionExplanation("reference_evidence", "create")).toMatch(/does not create a reference record/);
    expect(actionExplanation("event", "create")).toMatch(/story event/);
    expect(actionExplanation("event", "create")).not.toMatch(/New reference records start as draft/);
    expect(actionExplanation("plot_beat", "edit")).toMatch(/manuscript text is not edited/);
    expect(actionExplanation("character_learning", "skip")).toMatch(/Leave this suggestion out/);

    const suggestion: AnalysisSuggestion = {
      key: "s1",
      kind: "location",
      title: "The lane",
      note: "",
      uncertain: false,
      uncertainty: "",
      passage: null,
      quoteValid: true,
      explicitOrder: false,
      earlierTitle: "",
      laterTitle: "",
      dependsOnKeys: [],
      match: { status: "unique", candidates: [] },
    };
    const writes = describeWrites([suggestion], {});
    expect(writes.records).toHaveLength(0);
    expect(writes.links).toHaveLength(0);
    expect(describeWrites([suggestion], { s1: { action: "reuse" } }).links).toHaveLength(1);
  });
});
