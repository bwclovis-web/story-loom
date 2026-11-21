import { describe, expect, it } from "vitest";
import { dialogueRatio, parseStyleRangeQuery, povCounts, runStyleCheck } from "@/writing/styleCheck";

describe("parseStyleRangeQuery", () => {
  it("reads style deep-link offsets", () => {
    expect(parseStyleRangeQuery({ styleStart: "10", styleEnd: "20" })).toEqual({ start: 10, end: 20 });
    expect(parseStyleRangeQuery({ styleStart: "-1", styleEnd: "5" })).toBeNull();
  });
});

describe("runStyleCheck", () => {
  it("flags filter words and echoes on markdown source", () => {
    const text = "She was very very quiet in the very old hall.";
    const issues = runStyleCheck(text);
    expect(issues.some((i) => i.kind === "filter" && text.slice(i.start, i.end).toLowerCase() === "very")).toBe(true);
    const echoes = issues.filter((i) => i.kind === "echo");
    expect(echoes.length).toBeGreaterThan(0);
    expect(new Set(echoes.map((i) => i.start)).size).toBe(echoes.length);
  });

  it("flags each echoed word position at most once", () => {
    const text = "the cat the cat the cat walked on.";
    const echoes = runStyleCheck(text, { echoMinLetters: 3 }).filter((i) => i.kind === "echo");
    expect(new Set(echoes.map((i) => i.start)).size).toBe(echoes.length);
    expect(echoes.length).toBe(4);
  });

  it("flags a passive construction and counts dialogue against narration", () => {
    const text = 'The door was opened. "Come in," she said.';
    expect(runStyleCheck(text).some((issue) => issue.kind === "passive")).toBe(true);
    const ratio = dialogueRatio(text);
    expect(ratio.dialogueWords).toBeGreaterThan(0);
    expect(ratio.narrationWords).toBeGreaterThan(0);
    expect(povCounts(text, ["she"])).toEqual([{ name: "she", count: 1 }]);
    expect(povCounts("Mara waited. Mara left.", ["Mara"])).toEqual([{ name: "Mara", count: 2 }]);
  });

  it("flags repeated character names within a word window", () => {
    const text = "Asha walked in. Asha sat. Asha waited.";
    const issues = runStyleCheck(text, { characterNames: ["Asha"], nameWordWindow: 20, nameRepeatCount: 3 });
    expect(issues.some((i) => i.kind === "name_repeat")).toBe(true);
  });

  it("flags long sentences by word count", () => {
    const words = Array.from({ length: 45 }, (_, i) => `alpha${i}`).join(" ");
    const text = `${words}.`;
    const issues = runStyleCheck(text, { longSentenceWords: 40 });
    expect(issues.some((i) => i.kind === "long_sentence")).toBe(true);
  });
});