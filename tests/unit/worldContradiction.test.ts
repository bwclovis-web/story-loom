import { describe, expect, it } from "vitest";
import {
  classifyPassageStance,
  evaluatePassageAgainstWorldFact,
  findingsToPersist,
  splitPassageClaims,
  validateAiContradictionCandidate,
  type PassageClaim,
  type WorldFactSnapshot,
} from "@/domain/worldContradiction";

function fact(partial: Partial<WorldFactSnapshot> & Pick<WorldFactSnapshot, "fieldPath" | "value" | "formatted">): WorldFactSnapshot {
  return {
    worldRecordId: "rec_world",
    worldTitle: "Saltmarsh Station",
    worldAliases: ["the Station"],
    changeId: "wfh_1",
    worldRecordRevision: 2,
    subcategoryId: "cities_and_settlements",
    storyPointLabel: "after closure",
    ...partial,
  };
}

function claim(text: string, stance?: PassageClaim["stance"]): PassageClaim {
  return {
    text,
    start: 0,
    end: text.length,
    stance: stance ?? classifyPassageStance(text),
  };
}

describe("classifyPassageStance", () => {
  it("labels narration, dialogue, belief, and uncertainty", () => {
    expect(classifyPassageStance("She entered Saltmarsh Station through the east door.")).toBe("narration");
    expect(classifyPassageStance('"The east door was open," she said.')).toBe("dialogue");
    expect(classifyPassageStance("She believed the east door was open.")).toBe("belief");
    expect(classifyPassageStance("She hoped the east door was open.")).toBe("uncertainty");
  });
});

describe("evaluatePassageAgainstWorldFact", () => {
  it("flags assertive access conflict and skips non-assertive hope", () => {
    const closed = fact({
      fieldPath: "values.access",
      value: "closed",
      formatted: "closed",
    });
    const conflict = evaluatePassageAgainstWorldFact({
      passage: claim("She entered Saltmarsh Station through the east door."),
      fact: closed,
      manuscriptRecordId: "rec_ms",
      manuscriptRevision: 1,
    });
    expect(conflict.verdict).toBe("conflict");

    const hope = evaluatePassageAgainstWorldFact({
      passage: claim("She hoped the east door was open."),
      fact: closed,
      manuscriptRecordId: "rec_ms",
      manuscriptRevision: 1,
    });
    expect(hope.verdict).toBe("non_assertive");
  });

  it("guards town vs region population and stretch vs whole river length", () => {
    const townPop = fact({
      fieldPath: "values.populationEstimate",
      value: { amount: 0, qualifier: "exact" },
      formatted: "0 (exact)",
      subcategoryId: "cities_and_settlements",
      worldTitle: "Saltmarsh",
    });
    const region = evaluatePassageAgainstWorldFact({
      passage: claim("The surrounding region near Saltmarsh held forty permanent residents."),
      fact: townPop,
      manuscriptRecordId: "rec_ms",
      manuscriptRevision: 1,
    });
    expect(region.verdict).toBe("scope_mismatch");

    const river = fact({
      fieldPath: "values.length",
      value: { amount: 90, unit: "miles", qualifier: "about" },
      formatted: "about 90 miles",
      subcategoryId: "waterways",
      worldTitle: "Grayflood",
    });
    const stretch = evaluatePassageAgainstWorldFact({
      passage: claim("The navigable stretch of the Grayflood ran roughly 12 miles."),
      fact: river,
      manuscriptRecordId: "rec_ms",
      manuscriptRevision: 1,
    });
    expect(stretch.verdict).toBe("scope_mismatch");
  });

  it("treats documented zero as conflict and blank as insufficient", () => {
    const zero = fact({
      fieldPath: "values.populationEstimate",
      value: { amount: 0, qualifier: "exact" },
      formatted: "0 (exact)",
      worldTitle: "Saltmarsh",
    });
    const conflict = evaluatePassageAgainstWorldFact({
      passage: claim("Saltmarsh still had forty permanent residents."),
      fact: zero,
      manuscriptRecordId: "rec_ms",
      manuscriptRevision: 1,
    });
    expect(conflict.verdict).toBe("conflict");

    const blank = evaluatePassageAgainstWorldFact({
      passage: claim("Saltmarsh still had forty permanent residents."),
      fact: fact({
        fieldPath: "values.populationEstimate",
        value: null,
        formatted: "",
        worldTitle: "Saltmarsh",
      }),
      manuscriptRecordId: "rec_ms",
      manuscriptRevision: 1,
    });
    expect(blank.verdict).toBe("insufficient_evidence");
  });

  it("converts about-units and keeps about ambiguity bands", () => {
    const river = fact({
      fieldPath: "values.length",
      value: { amount: 90, unit: "miles", qualifier: "about" },
      formatted: "about 90 miles",
      worldTitle: "Grayflood",
      subcategoryId: "waterways",
    });
    const compatible = evaluatePassageAgainstWorldFact({
      passage: claim("The Grayflood ran roughly 145 km."),
      fact: river,
      manuscriptRecordId: "rec_ms",
      manuscriptRevision: 1,
    });
    expect(compatible.verdict).toBe("compatible");

    const ambiguous = evaluatePassageAgainstWorldFact({
      passage: claim("The Grayflood ran about 110 miles."),
      fact: river,
      manuscriptRecordId: "rec_ms",
      manuscriptRevision: 1,
    });
    expect(ambiguous.verdict).toBe("ambiguous");

    const conflict = evaluatePassageAgainstWorldFact({
      passage: claim("The Grayflood ran about 200 miles."),
      fact: river,
      manuscriptRecordId: "rec_ms",
      manuscriptRevision: 1,
    });
    expect(conflict.verdict).toBe("conflict");
  });

  it("enforces at_least and at_most bounds", () => {
    const atLeast = fact({
      fieldPath: "values.populationEstimate",
      value: { amount: 40, qualifier: "at_least" },
      formatted: "at least 40",
      worldTitle: "Saltmarsh",
    });
    expect(
      evaluatePassageAgainstWorldFact({
        passage: claim("Saltmarsh had twelve permanent residents."),
        fact: atLeast,
        manuscriptRecordId: "rec_ms",
        manuscriptRevision: 1,
      }).verdict,
    ).toBe("conflict");

    const atMost = fact({
      fieldPath: "values.populationEstimate",
      value: { amount: 10, qualifier: "at_most" },
      formatted: "at most 10",
      worldTitle: "Saltmarsh",
    });
    expect(
      evaluatePassageAgainstWorldFact({
        passage: claim("Saltmarsh had forty permanent residents."),
        fact: atMost,
        manuscriptRecordId: "rec_ms",
        manuscriptRevision: 1,
      }).verdict,
    ).toBe("conflict");
  });

  it("does not turn ritual prose or a glossed sample into a contradiction rule", () => {
    const steps = fact({
      fieldPath: "values.ritualSteps",
      value: ["Wash the body with river water", "Light the blue lantern", "Speak the dead person's harbor name"],
      formatted: "Wash the body with river water, Light the blue lantern, Speak the dead person's harbor name",
      worldTitle: "Lantern Vigil",
      subcategoryId: "rituals",
    });
    const stepEval = evaluatePassageAgainstWorldFact({
      passage: claim("Lantern Vigil buried the dead without a lantern."),
      fact: steps,
      manuscriptRecordId: "rec_ms",
      manuscriptRevision: 1,
    });
    expect(stepEval.verdict).toBe("insufficient_evidence");

    const samples = fact({
      fieldPath: "values.exampleLines",
      value: [
        { line: "Kael tor ven", gloss: "the tide turns" },
        { line: "Vael mir sen", gloss: "the lamp is low" },
      ],
      formatted: "Kael tor ven — the tide turns; Vael mir sen — the lamp is low",
      worldTitle: "Harbour Cant",
      subcategoryId: "dialects",
    });
    const sampleEval = evaluatePassageAgainstWorldFact({
      passage: claim('Harbour Cant speakers said "the tide never turns."'),
      fact: samples,
      manuscriptRecordId: "rec_ms",
      manuscriptRevision: 1,
    });
    expect(sampleEval.verdict).toBe("insufficient_evidence");
    expect(findingsToPersist([stepEval, sampleEval])).toEqual([]);
  });

  it("does not treat an omitted observable magic sign as a contradiction", () => {
    const signs = fact({
      fieldPath: "values.observableSigns",
      value: "one clear chime",
      formatted: "one clear chime",
      worldTitle: "Bellglass Ward",
      subcategoryId: "workings",
    });
    const omitted = evaluatePassageAgainstWorldFact({
      passage: claim("She checked the ward and walked on."),
      fact: signs,
      manuscriptRecordId: "rec_ms",
      manuscriptRevision: 1,
    });
    expect(omitted.verdict).toBe("insufficient_evidence");
    expect(findingsToPersist([omitted])).toEqual([]);
  });
});

describe("validateAiContradictionCandidate", () => {
  it("rejects hallucinated quotes and out-of-scope facts", () => {
    const body = "She entered Saltmarsh Station through the east door.";
    const eligible = [
      fact({
        fieldPath: "values.access",
        value: "closed",
        formatted: "closed",
      }),
    ];
    expect(
      validateAiContradictionCandidate({
        body,
        candidate: {
          excerpt: "She flew over Saltmarsh Station on a dragon.",
          worldRecordId: "rec_world",
          fieldPath: "values.access",
        },
        eligibleFacts: eligible,
      }).ok,
    ).toBe(false);

    expect(
      validateAiContradictionCandidate({
        body,
        candidate: {
          excerpt: "She entered Saltmarsh Station through the east door.",
          worldRecordId: "rec_other",
          fieldPath: "values.access",
        },
        eligibleFacts: eligible,
      }).ok,
    ).toBe(false);

    const ok = validateAiContradictionCandidate({
      body,
      candidate: {
        excerpt: "She entered Saltmarsh Station through the east door.",
        worldRecordId: "rec_world",
        fieldPath: "values.access",
        changeId: "wfh_1",
      },
      eligibleFacts: eligible,
    });
    expect(ok.ok).toBe(true);
  });
});

describe("splitPassageClaims", () => {
  it("splits sentences without dropping stance", () => {
    const claims = splitPassageClaims("She hoped the east door was open. She entered Saltmarsh Station.");
    expect(claims).toHaveLength(2);
    expect(claims[0]?.stance).toBe("uncertainty");
    expect(claims[1]?.stance).toBe("narration");
  });
});
