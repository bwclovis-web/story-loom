import { describe, expect, it } from "vitest";
import { buildManuscriptTree, chapterOf, filterManuscriptTree } from "@/ui/manuscriptTree";
import type { RecordNavEntry } from "@/ui/navigation";

let tick = 0;
function entry(
  id: string,
  type: RecordNavEntry["type"],
  title: string,
  parentRecordId: string | null = null,
  position: number | null = null,
): RecordNavEntry {
  tick += 1;
  return { id, type, title, parentRecordId, position, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, tick)).toISOString() };
}

// Invented fixture; listed out of creation order on purpose.
const ch1 = entry("rec_ch1", "manuscript_chapter", "The Lantern Market");
const ch2 = entry("rec_ch2", "manuscript_chapter", "Ash Road");
const sc1 = entry("rec_sc1", "manuscript_scene", "Arrival", "rec_ch1");
const sc2 = entry("rec_sc2", "manuscript_scene", "The Bargain", "rec_ch1");
const sc3 = entry("rec_sc3", "manuscript_scene", "Night Watch", "rec_ch2");
const lost = entry("rec_lost", "manuscript_scene", "Lost", "rec_gone");
const note = entry("rec_n1", "scene_note", "Check tides", "rec_sc2");
const dossier = entry("rec_ch", "character_dossier", "Mara Vell");
const records = [sc2, dossier, ch2, note, sc3, lost, sc1, ch1];

describe("manuscript tree", () => {
  it("orders chapters and scenes by creation and nests scenes under their chapter", () => {
    const tree = buildManuscriptTree(records);
    expect(tree.chapters.map((c) => [c.title, c.scenes.map((s) => s.title)])).toEqual([
      ["The Lantern Market", ["Arrival", "The Bargain"]],
      ["Ash Road", ["Night Watch"]],
    ]);
    expect(tree.unplaced.map((s) => s.id)).toEqual(["rec_lost"]);
  });

  it("puts positioned chapters and scenes first, then the rest in creation order", () => {
    const placed = [
      entry("rec_a", "manuscript_chapter", "A"),
      entry("rec_b", "manuscript_chapter", "B", null, 1),
      entry("rec_c", "manuscript_chapter", "C", null, 0),
      entry("rec_d", "manuscript_chapter", "D"),
      entry("rec_s1", "manuscript_scene", "S1", "rec_c"),
      entry("rec_s2", "manuscript_scene", "S2", "rec_c", 0),
    ];
    const tree = buildManuscriptTree(placed);
    expect(tree.chapters.map((c) => c.title)).toEqual(["C", "B", "A", "D"]);
    expect(tree.chapters[0].scenes.map((s) => s.title)).toEqual(["S2", "S1"]);
  });

  it("filters by chapter or scene title, case-insensitively", () => {
    const tree = buildManuscriptTree(records);
    const byScene = filterManuscriptTree(tree, "bargain");
    expect(byScene.chapters.map((c) => [c.id, c.scenes.map((s) => s.id)])).toEqual([["rec_ch1", ["rec_sc2"]]]);
    expect(byScene.matchCount).toBe(1);
    const byChapter = filterManuscriptTree(tree, "ASH");
    expect(byChapter.chapters[0].scenes.map((s) => s.id)).toEqual(["rec_sc3"]);
    expect(filterManuscriptTree(tree, "  ").chapters).toHaveLength(2);
    expect(filterManuscriptTree(tree, "zzz").chapters).toHaveLength(0);
  });

  it("finds the chapter to expand for a chapter, scene or note", () => {
    expect(chapterOf(records, "rec_ch2")).toBe("rec_ch2");
    expect(chapterOf(records, "rec_sc2")).toBe("rec_ch1");
    expect(chapterOf(records, "rec_n1")).toBe("rec_ch1");
    expect(chapterOf(records, "rec_ch")).toBeNull();
    expect(chapterOf(records, null)).toBeNull();
  });
});
