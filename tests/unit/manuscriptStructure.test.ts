import { describe, expect, it } from "vitest";
import {
  extractSelectionAsSceneBody,
  mergeManuscriptBodies,
  readManuscriptMeta,
  resolveExtractSelection,
  splitManuscriptBody,
  withManuscriptMeta,
} from "@/writing/manuscriptStructure";

describe("manuscript structure helpers", () => {
  it("splits only when both sides keep text", () => {
    expect(splitManuscriptBody("abcd", 0)).toBeNull();
    expect(splitManuscriptBody("abcd", 4)).toBeNull();
    expect(splitManuscriptBody("abcd", 2)).toEqual({ head: "ab", tail: "cd", tailOffset: 2 });
    expect(splitManuscriptBody("ab \n\n cd", 3)).toEqual({ head: "ab", tail: "cd", tailOffset: 6 });
    expect(splitManuscriptBody("   ab", 2)).toBeNull();
  });

  it("joins kept text, then the other text, and records where the second part starts", () => {
    expect(mergeManuscriptBodies("Keep.", "Drop.")).toEqual({ body: "Keep.\n\nDrop.", dropOffset: 7 });
    expect(mergeManuscriptBodies("Keep.", "  ")).toEqual({ body: "Keep.", dropOffset: 5 });
    expect(mergeManuscriptBodies("", "Drop.")).toEqual({ body: "Drop.", dropOffset: 0 });
  });

  it("extracts a middle selection into a scene and leaves a break at the cut", () => {
    expect(extractSelectionAsSceneBody("abcd", 1, 1)).toBeNull();
    expect(extractSelectionAsSceneBody("abcd", 0, 4)?.sceneBody).toBe("abcd");
    expect(extractSelectionAsSceneBody("abcd", 0, 4)?.chapterBody).toBe("***");
    expect(extractSelectionAsSceneBody("  \n\n  ", 0, 6)).toBeNull();
    const middle = extractSelectionAsSceneBody("Before.\n\nMiddle scene.\n\nAfter.", 9, 22);
    expect(middle).toMatchObject({
      sceneBody: "Middle scene.",
      chapterBody: "Before.\n\n***\n\nAfter.",
      breakIndex: 0,
    });
    const afterBreak = extractSelectionAsSceneBody("Open.\n\n***\n\nKeep this.\n\nClose.", 12, 22);
    expect(afterBreak?.sceneBody).toBe("Keep this.");
    expect(afterBreak?.breakIndex).toBe(1);
    expect(afterBreak?.chapterBody).toBe("Open.\n\n***\n\n***\n\nClose.");
  });

  it("resolves extract bounds from the captured selection when offsets drift", () => {
    const body = "Before.\n\nMiddle scene.\n\nAfter.";
    const passage = "Middle scene.";
    const resolved = resolveExtractSelection(body, 0, 3, passage);
    expect(resolved?.sceneBody).toBe(passage);
    expect(resolved?.chapterBody).toBe("Before.\n\n***\n\nAfter.");
    expect(resolveExtractSelection(body, 9, 22, passage)?.sceneBody).toBe(passage);
  });

  it("keeps unknown fields when planning fields change", () => {
    const fields = { pov: "Mara", mood: "dry", sceneStatus: "rough" };
    expect(readManuscriptMeta(fields)).toEqual({ pov: "Mara", sceneStatus: "rough", storyDateNote: "" });
    expect(withManuscriptMeta(fields, { pov: "", storyDateNote: "Year of salt", sceneStatus: "final" })).toEqual({
      mood: "dry",
      sceneStatus: "final",
      storyDateNote: "Year of salt",
    });
    expect(withManuscriptMeta(fields, { sceneStatus: "nope" as "rough" })).toEqual(fields);
    expect(withManuscriptMeta({ pov: "x".repeat(250) }, { pov: "y".repeat(250) }).pov).toHaveLength(200);
  });
});
