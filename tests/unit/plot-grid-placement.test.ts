import { describe, expect, it } from "vitest";
import { otherDraftRowByRecord, plotRowForManuscript } from "@/ui/plotGridPlacement";

describe("plot grid rewrite placement", () => {
  const author = new Set(["author-1", "author-2", "author-3"]);
  const links = [
    { fromRecordId: "author-1", toRecordId: "zero-1" },
    { fromRecordId: "author-2", toRecordId: "zero-2" },
    { fromRecordId: "author-3", toRecordId: "zero-3" },
  ];

  it("shows a zero-draft beat on the author row without treating it as unplaced", () => {
    const map = otherDraftRowByRecord(author, links);
    expect(plotRowForManuscript("zero-1", author, map)).toBe("author-1");
    expect(plotRowForManuscript("zero-2", author, map)).toBe("author-2");
    expect(plotRowForManuscript("author-1", author, map)).toBe("author-1");
    expect(plotRowForManuscript("loose", author, map)).toBeNull();
    expect(plotRowForManuscript(null, author, map)).toBeNull();
  });

  it("does not alias a beat whose own row is already visible", () => {
    const both = new Set(["author-1", "zero-1"]);
    const map = otherDraftRowByRecord(both, links);
    expect(map.has("zero-1")).toBe(false);
    expect(map.has("author-1")).toBe(false);
  });
});
