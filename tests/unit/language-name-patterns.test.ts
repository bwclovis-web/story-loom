import { describe, expect, it } from "vitest";
import {
  generateLanguageNames,
  parseLanguageNamePatternSet,
  splitNameList,
} from "@/world/languageNamePatterns";

describe("language name patterns", () => {
  it("splits syllable and pattern lists", () => {
    expect(splitNameList("ka, ri\nfen")).toEqual(["ka", "ri", "fen"]);
  });

  it("parses language kind fields only", () => {
    expect(
      parseLanguageNamePatternSet({
        kind: "language",
        nameSyllables: "tor\nval",
        namePatterns: "{S}{s}",
      }),
    ).toEqual({ syllables: ["tor", "val"], patterns: ["{S}{s}"] });
    expect(parseLanguageNamePatternSet({ kind: "place", nameSyllables: "x", namePatterns: "{s}" })).toBeNull();
  });

  it("generates repeatable names for the same seed", () => {
    const set = { syllables: ["ka", "ri", "fen"], patterns: ["{S}{s}", "{s}'{s}"] };
    const a = generateLanguageNames(set, { count: 5, seed: "silver-archive" });
    const b = generateLanguageNames(set, { count: 5, seed: "silver-archive" });
    expect(a).toEqual(b);
    expect(a.length).toBe(5);
    expect(a.every((name) => name.length > 0)).toBe(true);
  });

  it("changes output when the seed changes", () => {
    const set = { syllables: ["ka", "ri"], patterns: ["{S}{s}"] };
    const a = generateLanguageNames(set, { count: 3, seed: "one" });
    const b = generateLanguageNames(set, { count: 3, seed: "two" });
    expect(a).not.toEqual(b);
  });
});