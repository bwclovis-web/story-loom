import { describe, expect, it } from "vitest";
import { parseWeaveBuildOutput, WEAVE_BUILD_OUTPUT_JSON_SCHEMA } from "@/weave/buildFromDraftOutput";

describe("Weave build-from-draft output", () => {
  it("parses a valid draft and keeps closed schema properties", () => {
    const draft = {
      summary: "Harbour arrival plan",
      threads: [{ key: "thread-main", title: "Main mystery" }],
      rows: [
        {
          key: "row-ch01",
          manuscriptRecordId: "rec_test_ch01_prose",
          summary: "Mara finds the wet ledger.",
          purposeGoal: "Confirm the ledger is real",
          purposeChange: "She can no longer pretend the quay is quiet",
          purposeForward: "She must ask the Guild",
          proposedBoundaries: [
            { key: "bound-1", title: "The pier boards", excerpt: "Mara Venn knew this because she had checked it" },
          ],
        },
      ],
      beats: [
        {
          key: "beat-ledger",
          title: "Wet ledger",
          body: "Discovery beat",
          threadKey: "thread-main",
          manuscriptRecordId: "rec_test_ch01_prose",
          decision: "keep",
          sourceExcerpt: "The ledger had been dry for three hundred years.",
        },
      ],
    };
    const parsed = parseWeaveBuildOutput(JSON.stringify(draft));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.draft.threads[0]?.title).toBe("Main mystery");
    expect(parsed.draft.rows[0]?.purposeGoal).toContain("ledger");
    expect(parsed.draft.beats[0]?.sourceExcerpt).toContain("ledger");
    expect(WEAVE_BUILD_OUTPUT_JSON_SCHEMA.additionalProperties).toBe(false);
  });

  it("rejects unknown manuscript fields and open objects", () => {
    const bad = parseWeaveBuildOutput(
      JSON.stringify({
        summary: "x",
        threads: [],
        rows: [],
        beats: [
          {
            key: "b1",
            title: "T",
            body: "",
            threadKey: "t",
            manuscriptRecordId: "rec_x",
            decision: "keep",
            sourceExcerpt: "hi",
            inventProse: "NO",
          },
        ],
      }),
    );
    expect(bad.ok).toBe(false);
  });
});
