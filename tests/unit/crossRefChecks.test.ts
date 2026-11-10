import { describe, expect, it } from "vitest";
import {
  aliasesOf,
  buildCrossRefIndex,
  crossRefReport,
  crossRefsFor,
  nameFormsOf,
  nameFromTitle,
  resolveId,
  type XrefRecord,
} from "@/writing/crossRefs";

const rec = (r: Partial<XrefRecord> & Pick<XrefRecord, "id" | "title" | "type">): XrefRecord => ({
  body: "",
  fields: {},
  filenames: [],
  status: "approved",
  ...r,
});

describe("names of characters and places", () => {
  it("takes the name part of a title", () => {
    expect(nameFromTitle("Seren \u2014 Character Dossier")).toBe("Seren");
    expect(nameFromTitle("Oren Pike: early notes")).toBe("Oren Pike");
    expect(nameFromTitle("Brindle Quay (harbour)")).toBe("Brindle Quay");
    expect(nameFromTitle("magic system")).toBeNull();
  });

  it("adds the name without The, aliases, and a character's first and last words", () => {
    expect(nameFormsOf(rec({ id: "g", title: "The Salt Guild", type: "worldbuilding" })).full).toEqual(["The Salt Guild", "Salt Guild"]);
    expect(nameFormsOf(rec({ id: "m", title: "Captain Mara Venn", type: "character_dossier", fields: { aliases: ["Mags", " "] } }))).toEqual({
      full: ["Captain Mara Venn", "Mags"],
      parts: ["Venn"],
    });
    expect(nameFormsOf(rec({ id: "d", title: "Tide tables", type: "canon_decision" }))).toEqual({ full: [], parts: [] });
    expect(aliasesOf({ aliases: "Wren" })).toEqual(["Wren"]);
  });
});

describe("cross-reference checks", () => {
  const records: XrefRecord[] = [
    rec({ id: "mara", title: "Mara Venn", type: "character_dossier", body: "# SA-CHAR-001 Mara\n" }),
    rec({ id: "mark", title: "Mara Holt", type: "character_dossier", fields: { aliases: ["Holt the Elder"] } }),
    rec({ id: "guild", title: "The Salt Guild", type: "worldbuilding", status: "draft", body: "# SA-WORLD-002 Guild\n" }),
    rec({ id: "oldmap", title: "Harbour Map", type: "worldbuilding", status: "superseded", supersededBy: "map", body: "# SA-WORLD-003 Map\n" }),
    rec({ id: "map", title: "Harbour Map v2", type: "worldbuilding", body: "# SA-WORLD-003 Map\n" }),
    rec({ id: "dup", title: "Second Register", type: "reference_note", body: "# SA-CHAR-001 Also Mara\n" }),
    rec({
      id: "ch1",
      title: "Chapter One",
      type: "manuscript_chapter",
      body: "Mara Venn met Venn's crew. Mara waved. The Salt Guild, the Salt Guild, Holt the Elder. Venning is not a name.\nSee SA-WORLD-003, SA-WORLD-002, SA-CHAR-404 and Lost_Notes_v2.md.",
    }),
    rec({ id: "old", title: "Old Chapter", type: "manuscript_chapter", status: "superseded", body: "SA-CHAR-777 and Gone_v1.md" }),
  ];
  const index = buildCrossRefIndex(records);

  it("prefers a current definition over a superseded one and points to the replacement", () => {
    expect(resolveId(index, "SA-WORLD-003")?.recordId).toBe("map");
    const old = index.ids.get("SA-WORLD-003")!.find((t) => t.recordId === "oldmap");
    expect(old?.replacedBy).toEqual({ recordId: "map", title: "Harbour Map v2" });
  });

  it("finds names in chapter text, longest form first, and skips shared first names", () => {
    const refs = crossRefsFor(index, "ch1");
    expect(refs.names.map((n) => [n.recordId, n.count, n.forms])).toEqual([
      ["mara", 2, ["Mara Venn", "Venn"]],
      ["guild", 2, ["The Salt Guild", "Salt Guild"]],
      ["mark", 1, ["Holt the Elder"]],
    ]);
    expect(crossRefsFor(index, "mara").namedIn).toEqual([{ recordId: "ch1", title: "Chapter One", type: "manuscript_chapter", count: 2 }]);
    expect(crossRefsFor(index, "mara").nameForms).toEqual(["Mara Venn", "Venn"]);
  });

  it("carries the target's status on mentions", () => {
    const refs = crossRefsFor(index, "ch1");
    expect(refs.ids.find((m) => m.id === "SA-WORLD-002")?.target?.status).toBe("draft");
  });

  it("reports undefined IDs, missing files, conflicts, flagged mentions and names, leaving superseded sources out", () => {
    const report = crossRefReport(index);
    expect(report.undefinedIds).toEqual([{ id: "SA-CHAR-404", mentionedBy: [{ recordId: "ch1", title: "Chapter One", type: "manuscript_chapter" }] }]);
    expect(report.missingFiles.map((f) => f.filename)).toEqual(["Lost_Notes_v2.md"]);
    expect(report.conflicts.map((c) => [c.id, c.places.map((p) => p.recordId).sort()])).toEqual([["SA-CHAR-001", ["dup", "mara"]]]);
    expect(report.flaggedMentions.map((m) => [m.from.recordId, m.token, m.target.status])).toEqual([["ch1", "SA-WORLD-002", "draft"]]);
    expect(report.supersededSkipped).toBe(2);
    expect(report.names.map((n) => [n.recordId, n.chapters, n.mentions])).toEqual([
      ["mara", 1, 2],
      ["guild", 1, 2],
      ["mark", 1, 1],
      ["map", 0, 0],
    ]);
  });

  it("does not count a register row beside the defining document as a conflict", () => {
    const idx = buildCrossRefIndex([
      rec({ id: "doc", title: "Doc", type: "reference_note", body: "# SA-X-001 Thing\n" }),
      rec({ id: "reg", title: "Register", type: "reference_note", body: "| ID | Name |\n| --- | --- |\n| SA-X-001 | Thing |\n" }),
    ]);
    expect(crossRefReport(idx).conflicts).toEqual([]);
  });
});
