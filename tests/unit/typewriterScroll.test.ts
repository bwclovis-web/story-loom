import { describe, expect, it } from "vitest";
import { typewriterScrollTop } from "@/writing/typewriterScroll";

describe("typewriterScrollTop", () => {
  it("scrolls down as the caret moves to later lines", () => {
    const base = {
      clientHeight: 400,
      scrollTop: 0,
      selectionStart: 0,
    };
    const lineHeight = 20;
    expect(typewriterScrollTop({ ...base, value: "one\n" }, lineHeight)).toBe(0);
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    const selectionStart = lines.length;
    expect(typewriterScrollTop({ ...base, value: `${lines}\n`, selectionStart }, lineHeight)).toBeGreaterThan(0);
  });
});