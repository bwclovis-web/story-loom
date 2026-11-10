import { describe, expect, it } from "vitest";
import { orderAfterMove } from "@/domain/bookOrder";
import { EXCERPT_CONTEXT, searchText } from "@/writing/textSearch";

// Invented text.
const TEXT = "The ferry left at dawn.\nNobody waved from the ferry, not even the harbourmaster.";

describe("text search", () => {
  it("counts every literal match and ignores case unless asked", () => {
    expect(searchText(TEXT, "ferry", { matchCase: false, limit: 10 }).count).toBe(2);
    expect(searchText(TEXT, "Ferry", { matchCase: true, limit: 10 }).count).toBe(0);
    expect(searchText(TEXT, "f.rry", { matchCase: false, limit: 10 }).count).toBe(0);
    expect(searchText(TEXT, "", { matchCase: false, limit: 10 }).count).toBe(0);
  });

  it("keeps excerpts for the first matches only, with the match separated out", () => {
    const result = searchText(TEXT, "ferry", { matchCase: false, limit: 1 });
    expect(result.count).toBe(2);
    expect(result.excerpts).toHaveLength(1);
    const [e] = result.excerpts;
    expect(e.before + e.match + e.after).toContain("The ferry left at dawn. Nobody");
    expect(e.match).toBe("ferry");
    expect(e.cutBefore).toBe(false);
  });

  it("cuts long text near a word boundary and says so", () => {
    const long = `${"word ".repeat(40)}needle ${"word ".repeat(40)}`;
    const [e] = searchText(long, "needle", { matchCase: false, limit: 3 }).excerpts;
    expect(e.cutBefore).toBe(true);
    expect(e.cutAfter).toBe(true);
    expect(e.before.length).toBeLessThanOrEqual(EXCERPT_CONTEXT);
    expect(e.before.startsWith("word")).toBe(true);
    expect(e.after.trim().endsWith("word")).toBe(true);
  });
});

describe("book order moves", () => {
  it("places the moved ID at the clamped index among the others", () => {
    expect(orderAfterMove(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
    expect(orderAfterMove(["a", "b", "c"], "a", 1)).toEqual(["b", "a", "c"]);
    expect(orderAfterMove(["a", "b"], "x", 99)).toEqual(["a", "b", "x"]);
    expect(orderAfterMove(["a", "b"], "b", -5)).toEqual(["b", "a"]);
  });
});
