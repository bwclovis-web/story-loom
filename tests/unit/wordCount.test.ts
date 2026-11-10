import { describe, expect, it } from "vitest";
import { applyEdit, findMatches, replaceAllEdit } from "@/writing/findReplace";
import { countWords, formatWordCount } from "@/writing/wordCount";

describe("countWords", () => {
  it("counts plain prose", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("The ledger had been dry.")).toBe(5);
    expect(countWords("  spaced   out\n\nwords  ")).toBe(3);
  });

  it("ignores Markdown emphasis, headings, lists and quotes", () => {
    expect(countWords("# Chapter One")).toBe(2);
    expect(countWords("She was **very** _tired_ and *cold*.")).toBe(6);
    expect(countWords("- first item\n* second item\n1. third item\n> quoted line")).toBe(8);
  });

  it("does not count scene breaks", () => {
    expect(countWords("End of scene.\n\n***\n\n* * *\n\n---\n\n#\n\nNext scene.")).toBe(5);
  });

  it("counts link text but not link targets, images, HTML or comments", () => {
    expect(countWords("See [the guild hall](https://example.com/hall) now.")).toBe(5);
    expect(countWords("![a map of the city](map.png) Above.")).toBe(1);
    expect(countWords("Line<br>break <em>here</em> <!-- private note --> done")).toBe(4);
    expect(countWords("Visit https://example.com/a-b today")).toBe(2);
  });

  it("treats hyphenated words and apostrophes as one word", () => {
    expect(countWords("well-known mother-in-law")).toBe(2);
    expect(countWords("don't Mara’s o'clock 'tis dogs'")).toBe(5);
  });

  it("splits on dashes and spaced hyphens", () => {
    expect(countWords("yes—no")).toBe(2);
    expect(countWords("1990–2000")).toBe(2);
    expect(countWords("wait - stop")).toBe(2);
  });

  it("keeps numbers with separators together", () => {
    expect(countWords("3.14 1,000 10:30")).toBe(3);
  });

  it("stays accurate after a replacement edit", () => {
    const text = "Mara walked. Mara ran. **Mara** slept.";
    expect(countWords(text)).toBe(6);
    const edit = replaceAllEdit(text, findMatches(text, "Mara", { matchCase: true }), "Mara Venn")!;
    expect(countWords(applyEdit(text, edit))).toBe(9);
    const removed = replaceAllEdit(text, findMatches(text, " ran", { matchCase: true }), "")!;
    expect(countWords(applyEdit(text, removed))).toBe(5);
  });

  it("formats counts", () => {
    expect(formatWordCount(1)).toBe("1 word");
    expect(formatWordCount(12345)).toBe("12,345 words");
  });
});
