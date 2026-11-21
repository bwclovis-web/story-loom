import { describe, expect, it } from "vitest";
import {
  applyEdit,
  applySelectedReplacements,
  findMatches,
  findRegexMatches,
  invertEdit,
  matchAt,
  nextMatch,
  previousMatch,
  regexPreviewError,
  replaceAllEdit,
  replaceOneEdit,
} from "@/writing/findReplace";

const TEXT = "The *salt* road. Salt on the **salt** flats.\n\n***\n\nSALT again.";

describe("findMatches", () => {
  it("matches literally, ignoring case by default", () => {
    expect(findMatches(TEXT, "salt", { matchCase: false })).toHaveLength(4);
    expect(findMatches(TEXT, "salt", { matchCase: true })).toHaveLength(2);
    expect(findMatches(TEXT, "", { matchCase: false })).toEqual([]);
  });

  it("treats pattern characters as plain text", () => {
    expect(findMatches("a.b axb (c) [d]* e+f", ".", { matchCase: true })).toEqual([{ start: 1, end: 2 }]);
    expect(findMatches("a.b axb (c) [d]* e+f", "[d]*", { matchCase: true })).toHaveLength(1);
    expect(findMatches("price $5 or $5.00", "$5", { matchCase: true })).toHaveLength(2);
    expect(findMatches(TEXT, "***", { matchCase: true })).toHaveLength(1);
  });

  it("does not overlap matches", () => {
    expect(findMatches("aaaa", "aa", { matchCase: true })).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  it("refuses an unsafe regular expression and finds a simple one", () => {
    expect(regexPreviewError("(a+)+")).toBe("nested");
    expect(regexPreviewError("[")).toBe("invalid");
    expect(findRegexMatches("salt and salt", "s.lt", { matchCase: false }).matches).toHaveLength(2);
    const replaced = applySelectedReplacements("cat", findRegexMatches("cat", "c(.)t", { matchCase: true }).matches, "$1");
    expect(replaced).toBe("$1");
  });

  it("wholeWord skips matches inside longer words", () => {
    expect(findMatches("salted salt", "salt", { matchCase: false, wholeWord: true })).toEqual([{ start: 7, end: 11 }]);
  });
});

describe("next and previous", () => {
  const matches = findMatches(TEXT, "salt", { matchCase: false });

  it("moves forward from the caret and wraps", () => {
    expect(nextMatch(matches, 0, 0)).toBe(0);
    expect(nextMatch(matches, matches[0].start, matches[0].end)).toBe(1);
    const last = matches[matches.length - 1];
    expect(nextMatch(matches, last.start, last.end)).toBe(0);
    expect(matchAt(matches, matches[2].start, matches[2].end)).toBe(2);
  });

  it("moves backward and wraps", () => {
    expect(previousMatch(matches, matches[1].start)).toBe(0);
    expect(previousMatch(matches, 0)).toBe(matches.length - 1);
  });
});

describe("replacement", () => {
  it("replace one changes only the chosen match and keeps formatting", () => {
    const matches = findMatches(TEXT, "salt", { matchCase: true });
    const out = applyEdit(TEXT, replaceOneEdit(matches[0], "pepper"));
    expect(out).toBe("The *pepper* road. Salt on the **salt** flats.\n\n***\n\nSALT again.");
  });

  it("replace all keeps emphasis markers, paragraphs and scene breaks", () => {
    const matches = findMatches(TEXT, "salt", { matchCase: false });
    const out = applyEdit(TEXT, replaceAllEdit(TEXT, matches, "ash")!);
    expect(out).toBe("The *ash* road. ash on the **ash** flats.\n\n***\n\nash again.");
  });

  it("replace all is one edit that inverts back to the original", () => {
    const matches = findMatches(TEXT, "salt", { matchCase: false });
    const edit = replaceAllEdit(TEXT, matches, "")!;
    const replaced = applyEdit(TEXT, edit);
    expect(replaced).not.toContain("alt");
    expect(applyEdit(replaced, invertEdit(TEXT, edit))).toBe(TEXT);
  });

  it("returns no edit when nothing matches", () => {
    expect(replaceAllEdit(TEXT, [], "x")).toBeNull();
  });

  it("applySelectedReplacements changes only the chosen spans", () => {
    const matches = findMatches("one two one", "one", { matchCase: true });
    expect(applySelectedReplacements("one two one", [matches[1]!], "x")).toBe("one two x");
  });
});
