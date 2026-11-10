import { describe, expect, it } from "vitest";
import type { RecordNavEntry } from "@/ui/navigation";
import { categoryLabel, filterWorldTitles, isWorldType, WORLD_TYPES, worldCounts, worldHref } from "@/ui/world";

const entry = (id: string, title: string, type: RecordNavEntry["type"]): RecordNavEntry => ({
  id,
  title,
  type,
  parentRecordId: null,
  position: null,
  createdAt: "2026-01-01T00:00:00.000Z",
});

const records = [
  entry("rec_a", "Ines Corrow", "character_dossier"),
  entry("rec_b", "Tide Courts", "worldbuilding"),
  entry("rec_c", "Calendar question", "canon_decision"),
  entry("rec_d", "Loose notes", "reference_note"),
  entry("rec_e", "Chapter 1", "manuscript_chapter"),
  entry("rec_f", "Outline", "chapter_outline"),
];

describe("world categories", () => {
  it("are exactly the World document types, with no invented place or magic types", () => {
    expect(WORLD_TYPES).toEqual(["character_dossier", "worldbuilding", "canon_decision", "continuity_note", "reference_note"]);
    expect(WORLD_TYPES.map(categoryLabel)).toEqual(["Characters", "Worldbuilding", "Decisions", "Continuity notes", "Reference notes"]);
    expect(isWorldType("chapter_outline")).toBe(false);
    expect(isWorldType("places")).toBe(false);
    expect(isWorldType(null)).toBe(false);
  });

  it("counts only World records, including empty categories", () => {
    expect(worldCounts(records)).toEqual({
      all: 4,
      byType: { character_dossier: 1, worldbuilding: 1, canon_decision: 1, continuity_note: 0, reference_note: 1 },
    });
  });

  it("filters titles case-insensitively, within a category or across all World records", () => {
    expect(filterWorldTitles(records, "", null).map((r) => r.id)).toEqual(["rec_a", "rec_b", "rec_c", "rec_d"]);
    expect(filterWorldTitles(records, "", "worldbuilding").map((r) => r.id)).toEqual(["rec_b"]);
    expect(filterWorldTitles(records, "  CO ", null).map((r) => r.id)).toEqual(["rec_a", "rec_b"]);
    expect(filterWorldTitles(records, "chapter", null)).toEqual([]);
  });

  it("builds World page links", () => {
    expect(worldHref("prj_x")).toBe("/projects/prj_x/world");
    expect(worldHref("prj_x", { type: "canon_decision" })).toBe("/projects/prj_x/world?type=canon_decision");
    expect(worldHref("prj_x", { q: " salt & tide " })).toBe("/projects/prj_x/world?q=salt+%26+tide");
  });
});
