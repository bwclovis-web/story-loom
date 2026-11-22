import { describe, expect, it } from "vitest";
import { chapterWithoutScenes, composeChapterWithScenes } from "@/writing/nestedSceneTail";

describe("composeChapterWithScenes", () => {
  it("places each scene after the next scene break, not after the chapter", () => {
    const chapter = "Open.\n---\nMiddle.\n---\nEnd.";
    const composed = composeChapterWithScenes(chapter, [{ body: "First scene." }, { body: "Second scene." }]);
    expect(composed.doc).toBe("Open.\n---\n\nFirst scene.\n\nMiddle.\n---\n\nSecond scene.\n\nEnd.");
    expect(chapterWithoutScenes(composed.doc, composed.locked)).toBe(chapter);
    expect(composed.doc.endsWith("Second scene.\n\nEnd.")).toBe(true);
  });

  it("stacks extra scenes on the last break", () => {
    const chapter = "Open.\n---\nEnd.";
    const composed = composeChapterWithScenes(chapter, [{ body: "One." }, { body: "Two." }]);
    expect(composed.doc).toBe("Open.\n---\n\nOne.\n\n\nTwo.\n\nEnd.");
    expect(chapterWithoutScenes(composed.doc, composed.locked)).toBe(chapter);
  });

  it("follows the chapter when it has no scene break", () => {
    const composed = composeChapterWithScenes("Only the chapter.", [{ body: "After." }]);
    expect(composed.doc).toBe("Only the chapter.\n\nAfter.");
    expect(chapterWithoutScenes(composed.doc, composed.locked)).toBe("Only the chapter.");
  });
});
