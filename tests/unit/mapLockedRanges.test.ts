import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { mapLockedRangesThroughChange } from "@/components/writing/MarkdownEditor/MarkdownEditor";

describe("mapLockedRangesThroughChange", () => {
  it("does not throw when locked ranges sit past the start document length", () => {
    const start = EditorState.create({ doc: "a".repeat(100) });
    const tr = start.update({ changes: { from: 0, to: 100, insert: "b".repeat(80) } });
    const stale = [{ start: 90, end: 120 }];
    expect(() => mapLockedRangesThroughChange(stale, tr.changes, tr.state.doc.length)).not.toThrow();
    const mapped = mapLockedRangesThroughChange(stale, tr.changes, tr.state.doc.length);
    expect(mapped.every((range) => range.start >= 0 && range.end <= 80)).toBe(true);
    expect(mapped.every((range) => range.end > range.start)).toBe(true);
  });

  it("drops ranges that start entirely after the document", () => {
    const start = EditorState.create({ doc: "hello" });
    const tr = start.update({ changes: { from: 5, insert: "!" } });
    expect(mapLockedRangesThroughChange([{ start: 10, end: 14 }], tr.changes, tr.state.doc.length)).toEqual([]);
  });

  it("maps a valid locked range through a preceding insert", () => {
    const start = EditorState.create({ doc: "aaLOCKEDbb" });
    const tr = start.update({ changes: { from: 0, insert: "XX" } });
    const mapped = mapLockedRangesThroughChange([{ start: 2, end: 8 }], tr.changes, tr.state.doc.length);
    expect(mapped).toEqual([{ start: 4, end: 10 }]);
  });
});
