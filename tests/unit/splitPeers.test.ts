import { describe, expect, it } from "vitest";
import { splitGroups, splitOptionsFromTree, suggestSplitPeer } from "@/writing/splitPeers";

const tree = {
  chapters: [{ id: "ch-a", title: "Arrival", scenes: [{ id: "sc-a", title: "Dock" }] }],
  unplaced: [{ id: "sc-b", title: "Loose" }],
};

describe("split peers", () => {
  const options = [
    ...splitOptionsFromTree("draft-zero", "Zero draft", tree),
    ...splitOptionsFromTree("draft-author", "Author manuscript", {
      chapters: [{ id: "ch-b", title: "Arrival", scenes: [] }],
      unplaced: [],
    }),
  ];

  it("lists chapters and scenes under a draft label", () => {
    expect(options.map((option) => [option.kind, option.title, option.draftLabel])).toEqual([
      ["chapter", "Arrival", "Zero draft"],
      ["scene", "Dock", "Zero draft"],
      ["scene", "Loose", "Zero draft"],
      ["chapter", "Arrival", "Author manuscript"],
    ]);
    expect(splitGroups(options).map((group) => group.draftLabel)).toEqual(["Zero draft", "Author manuscript"]);
  });

  it("prefers a rewrite source, then a different draft", () => {
    expect(suggestSplitPeer(options, "ch-b", ["sc-a"])).toBe("sc-a");
    expect(suggestSplitPeer(options, "ch-a", [])).toBe("ch-b");
    expect(suggestSplitPeer(options, "ch-a", ["missing"])).toBe("ch-b");
  });
});
