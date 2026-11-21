import { describe, expect, it } from "vitest";
import {
  mergeManuscriptBodies,
  readManuscriptMeta,
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
