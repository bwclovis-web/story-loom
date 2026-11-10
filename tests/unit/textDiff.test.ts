import { describe, expect, it } from "vitest";
import { hasTextChange, textDiff } from "@/changePackage/diff";

const rebuild = (parts: ReturnType<typeof textDiff>, side: "before" | "after") =>
  parts.filter((p) => (side === "before" ? !p.added : !p.removed)).map((p) => p.value).join("");

describe("textDiff", () => {
  const cases: [string, string][] = [
    ["Archivist. Thirty years old. Lost.", "Archivist. Thirty-four years old. Lost. Now keeps the night ledger."],
    ["Two  spaces\n\n    indented line\n", "Two spaces\n\n  indented line\nnew line"],
    ["Rain fell.", ""],
    ["", "A new text."],
    ["Same words", "Same  words"],
  ];

  it.each(cases)("rebuilds both sides exactly: %j → %j", (before, after) => {
    const parts = textDiff(before, after);
    expect(rebuild(parts, "before")).toBe(before);
    expect(rebuild(parts, "after")).toBe(after);
  });

  it("counts a whitespace-only edit as a text change", () => {
    expect(hasTextChange(textDiff("Same words", "Same  words"))).toBe(true);
    expect(hasTextChange(textDiff("Same words", "Same words"))).toBe(false);
  });

  it("rebuilds long texts with the line diff", () => {
    const before = Array.from({ length: 400 }, (_, i) => `Line ${i}: the lamplighters walk the eastern districts.`).join("\n");
    const after = before.replace("Line 200:", "Line 200 (changed):");
    const parts = textDiff(before, after);
    expect(rebuild(parts, "before")).toBe(before);
    expect(rebuild(parts, "after")).toBe(after);
  });
});
