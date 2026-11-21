import { describe, expect, it } from "vitest";
import { isProjectLandingPath, isWeaveLibraryPath } from "@/ui/navigation";
import { weaveLibraryEntries, type WeaveLibraryGrid } from "@/ui/weaveLibrary";

function grid(partial: Partial<WeaveLibraryGrid> & Pick<WeaveLibraryGrid, "id" | "viewKind">): WeaveLibraryGrid {
  return {
    title: partial.title ?? partial.id,
    viewLabel:
      partial.viewLabel ??
      (partial.viewKind === "original"
        ? "Original plan"
        : partial.viewKind === "zero_draft_map"
          ? "Zero-draft story map"
          : "Author rewrite plan"),
    beatCount: partial.beatCount ?? 0,
    ...partial,
  };
}

describe("weave library", () => {
  it("treats only the landing routes as the library", () => {
    expect(isWeaveLibraryPath(["plan"])).toBe(true);
    expect(isWeaveLibraryPath(["plan", "weave"])).toBe(true);
    expect(isWeaveLibraryPath(["plan", "weave", "wvg_1"])).toBe(false);
    expect(isWeaveLibraryPath(["plan", "weave", "templates"])).toBe(false);
    expect(isWeaveLibraryPath(["analyze"])).toBe(false);
    expect(isWeaveLibraryPath(["write"])).toBe(false);
    expect(isProjectLandingPath(["write"])).toBe(true);
    expect(isProjectLandingPath(["world"])).toBe(true);
    expect(isProjectLandingPath(["assistant"])).toBe(true);
    expect(isProjectLandingPath(["plan"])).toBe(true);
    expect(isProjectLandingPath(["world", "new"])).toBe(true);
    expect(isProjectLandingPath(["world", "maps"])).toBe(false);
    expect(isProjectLandingPath(["assistant", "proposals", "x"])).toBe(false);
  });

  it("lists every saved grid in scope order and a setup row only when that scope is empty", () => {
    const entries = weaveLibraryEntries(
      [
        grid({ id: "later", viewKind: "original", title: "Later plan", beatCount: 4 }),
        grid({ id: "earlier", viewKind: "original", title: "Earlier plan", beatCount: 24 }),
        grid({ id: "rewrite", viewKind: "author_rewrite", title: "Rewrite desk", beatCount: 2 }),
      ],
      "",
    );
    expect(entries.map((entry) => (entry.kind === "grid" ? entry.grid.title : entry.viewLabel))).toEqual([
      "Later plan",
      "Earlier plan",
      "Zero-draft story map",
      "Rewrite desk",
    ]);
    expect(entries[2]).toMatchObject({ kind: "missing", viewKind: "zero_draft_map" });
  });

  it("filters titles and scope labels and does not offer a missing scope that already has grids", () => {
    const grids = [
      grid({ id: "a", viewKind: "original", title: "Harbour", beatCount: 3 }),
      grid({ id: "b", viewKind: "original", title: "Market", beatCount: 1 }),
    ];
    expect(weaveLibraryEntries(grids, "market").map((entry) => (entry.kind === "grid" ? entry.grid.id : entry.viewKind))).toEqual([
      "b",
    ]);
    expect(weaveLibraryEntries(grids, "original").every((entry) => entry.kind === "grid")).toBe(true);
    expect(weaveLibraryEntries(grids, "zero").map((entry) => entry.kind)).toEqual(["missing"]);
    expect(weaveLibraryEntries(grids, "no-such-grid")).toEqual([]);
  });
});
