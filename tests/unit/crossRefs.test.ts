import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCrossRefIndex,
  crossRefsFor,
  documentKey,
  documentName,
  fileMentions,
  filenameNumber,
  idDefinitions,
  idMentions,
  linkSegments,
  refIdsOf,
  resolveFile,
  resolveId,
  type XrefRecord,
} from "@/writing/crossRefs";
import { parseMarkdown } from "@/writing/markdownParse";
import { hasSectionStatus, listSections, outermostSections, sectionPath, statusTagOf } from "@/writing/sections";

const GUIDE_FILE = "Saltmarsh_Annals_Series_Guide_CURRENT.md";
const GUIDE = readFileSync(path.resolve(__dirname, "..", "fixtures", "markdown", GUIDE_FILE), "utf8");
const CRLF = GUIDE.replace(/\r?\n/g, "\r\n");

describe("section status tags", () => {
  it("reads bracket tags and dash tags word for word", () => {
    expect(statusTagOf("1. Governing Rules [APPROVED FRAMEWORK]")).toBe("APPROVED FRAMEWORK");
    expect(statusTagOf("SA-TIDE-001 — Tide Bells [APPROVED / OPEN]")).toBe("APPROVED / OPEN");
    expect(statusTagOf("Book One Arc [WORKING PROPOSAL; NOT FULLY APPROVED ARC]")).toBe("WORKING PROPOSAL; NOT FULLY APPROVED ARC");
    expect(statusTagOf("Later harbour scene — SELECTED; after the storm, before the fair")).toBe(
      "SELECTED; after the storm, before the fair",
    );
    expect(statusTagOf("SA-TIDE-002 — Salt Ledger — PROPOSED; pending author review")).toBe("PROPOSED; pending author review");
  });

  it("ignores dates, lowercase notes and plain headings", () => {
    expect(statusTagOf("3. Chapter Register [25 October 2026]")).toBeNull();
    expect(statusTagOf("Revision log — kept for history")).toBeNull();
    expect(statusTagOf("Harbour [see below]")).toBeNull();
    expect(statusTagOf("Plain heading")).toBeNull();
  });
});

describe("sections", () => {
  it("lists headings with parser anchors, nesting and status tags, skipping fenced code", () => {
    const sections = listSections(GUIDE);
    const anchors = parseMarkdown(GUIDE).headings.map((h) => h.id);
    expect(sections.map((s) => s.id)).toEqual(anchors);
    expect(sections.some((s) => s.title.includes("Not a heading"))).toBe(false);
    const rules = sections.find((s) => s.title.startsWith("1. Governing"))!;
    const bells = sections.find((s) => s.title.startsWith("1A."))!;
    expect(rules.statusTag).toBe("APPROVED FRAMEWORK");
    expect(bells.parentId).toBe(rules.id);
    expect(bells.statusTag).toBe("APPROVED / OPEN");
    expect(sectionPath(sections, bells.id).map((s) => s.level)).toEqual([1, 2, 3]);
    expect(hasSectionStatus(GUIDE)).toBe(true);
    expect(hasSectionStatus("# Notes\n\nNo tags here.\n")).toBe(false);
  });

  it("slices the exact saved text, including Windows line endings", () => {
    for (const body of [GUIDE, CRLF]) {
      const sections = listSections(body);
      const rules = sections.find((s) => s.title.startsWith("1. Governing"))!;
      const text = body.slice(rules.start, rules.end);
      expect(text.startsWith("## 1. Governing Rules")).toBe(true);
      expect(text).toContain("Exact count OPEN.");
      expect(text).toContain("every crossing.");
      expect(text).not.toContain("Book One Arc");
      const top = sections[0];
      expect(body.slice(top.start, top.end)).toBe(body);
    }
  });

  it("drops chosen sections that sit inside another chosen section", () => {
    const sections = listSections(GUIDE);
    const rules = sections.find((s) => s.title.startsWith("1. Governing"))!;
    const bells = sections.find((s) => s.title.startsWith("1A."))!;
    const arc = sections.find((s) => s.title.startsWith("2."))!;
    expect(outermostSections(sections, [bells.id, arc.id, rules.id]).map((s) => s.id)).toEqual([rules.id, arc.id]);
  });
});

describe("document keys", () => {
  it("ignores versions, status words, dates and a number prefix", () => {
    const key = "saltmarsh annals series guide";
    expect(documentKey("Saltmarsh_Annals_Series_Guide_CURRENT.md")).toBe(key);
    expect(documentKey("Saltmarsh_Annals_Series_Guide_APPROVED_WORKING_v1.9.md")).toBe(key);
    expect(documentKey("C:\\notes\\07-Saltmarsh_Annals_Series_Guide_v2.md")).toBe(key);
    expect(documentKey("Saltmarsh Annals Series Guide 2026-10-25.markdown")).toBe(key);
    expect(documentKey("18-Saltmarsh_Chapter_One_AUTHOR_REVISED_EDITED.md")).toBe("saltmarsh chapter one");
  });

  it("keeps words that are part of the name", () => {
    expect(documentKey("Harbour_Guide_PART_TWO_v1.md")).toBe("harbour guide part two");
    expect(documentKey("Open_Sea_Notes.md")).toBe("open sea notes");
    expect(documentKey("Final_Ferry.md")).toBe("final ferry");
  });

  it("keeps the spelling for a readable name and reads the number prefix", () => {
    expect(documentName("18-Saltmarsh_Chapter_One_AUTHOR_REVISED_EDITED.md")).toBe("Saltmarsh Chapter One");
    expect(filenameNumber("18-Saltmarsh_Chapter_One.md")).toBe(18);
    expect(filenameNumber("C:\\drafts\\007 Prologue.md")).toBe(7);
    expect(filenameNumber("Chapter_18.md")).toBeNull();
    expect(filenameNumber("12.md")).toBe(12);
    expect(filenameNumber("1234567-Long.md")).toBeNull();
  });
});

describe("mentions and definitions", () => {
  it("finds filenames and IDs mentioned in text", () => {
    expect([...fileMentions(GUIDE).keys()]).toEqual(["ferry town daily life", "oren pike dossier"]);
    expect(idMentions("See SA-TIDE-001, SA-B1-C01 and NOT-AN-ID. Also UTF-8 and SA-TIDE-001.")).toEqual([
      "SA-TIDE-001",
      "SA-B1-C01",
      "UTF-8",
    ]);
  });

  it("finds IDs defined in headings, bold items and register rows", () => {
    const defs = idDefinitions(CRLF);
    const by = (id: string) => defs.filter((d) => d.id === id);
    expect(by("SA-TIDE-001")).toEqual([
      expect.objectContaining({ kind: "heading", statusTag: "APPROVED / OPEN", label: "1A. SA-TIDE-001 — Tide Bells [APPROVED / OPEN]" }),
    ]);
    expect(by("SA-TIDE-002")[0].statusTag).toBe("PROPOSED; pending author review");
    expect(by("SA-STYLE-001")).toEqual([expect.objectContaining({ kind: "item", statusTag: "SERIES CANON" })]);
    expect(by("SA-STYLE-002")[0]).toMatchObject({ kind: "item", label: "SA-STYLE-002 — Weather as mood [PROPOSED]" });
    expect(by("SA-WORLD-004")[0]).toMatchObject({ kind: "item", statusTag: "SERIES CANON" });
    const row = by("SA-B1-C01")[0];
    expect(row).toMatchObject({ kind: "row", label: "The Low Tide", statusTag: null });
    expect(row.anchor).toBe(listSections(CRLF).find((s) => s.title.startsWith("3."))!.id);
    expect(by("SA-B1-C02")).toHaveLength(1);
  });

  it("reads author-given IDs from fields", () => {
    expect(refIdsOf({ refIds: " SA-B1-C01 " })).toEqual(["SA-B1-C01"]);
    expect(refIdsOf({ refIds: ["SA-B1-C01", "SA-B1-C01", 3, ""] })).toEqual(["SA-B1-C01"]);
    expect(refIdsOf({})).toEqual([]);
  });
});

describe("cross-reference index", () => {
  const records: XrefRecord[] = [
    { id: "guide", title: "Series Guide", type: "story_architecture", body: CRLF, fields: {}, filenames: [GUIDE_FILE] },
    {
      id: "ferry",
      title: "Ferry Town",
      type: "worldbuilding",
      body: "# Ferry Town\n\nBells per SA-TIDE-001. Guide: `Saltmarsh_Annals_Series_Guide_APPROVED_v1.8.md`. Missing SA-TIDE-999.\n",
      fields: {},
      filenames: ["Ferry_Town_Daily_Life_APPROVED_WORKING_v2.2.md", "Ferry_Town_Daily_Life_APPROVED_WORKING_v2.3.md"],
    },
    { id: "ch1", title: "The Low Tide", type: "manuscript_chapter", body: "Fog rolled in.", fields: { refIds: ["SA-B1-C01"] }, filenames: [] },
  ];
  const index = buildCrossRefIndex(records);

  it("resolves filenames to the imported document whatever the version", () => {
    expect(resolveFile(index, "Ferry_Town_Daily_Life_APPROVED_WORKING_v2.3.md")?.recordId).toBe("ferry");
    expect(resolveFile(index, "Ferry_Town_Daily_Life_v3.0.md")?.recordId).toBe("ferry");
    expect(resolveFile(index, "Oren_Pike_Dossier_DRAFT_v0.9.md")).toBeNull();
  });

  it("prefers an ID the author gave a record over a register row", () => {
    expect(resolveId(index, "SA-B1-C01")).toMatchObject({ recordId: "ch1", via: "refIds" });
    expect(resolveId(index, "SA-B1-C02")).toMatchObject({ recordId: "guide", via: "row" });
    expect(resolveId(index, "SA-TIDE-001")).toMatchObject({ recordId: "guide", via: "heading" });
  });

  it("lists mentions and mentioned-by for a record", () => {
    const guide = crossRefsFor(index, "guide");
    expect(guide.files.map((f) => [f.filename, f.target?.recordId ?? null])).toEqual([
      ["Ferry_Town_Daily_Life_APPROVED_WORKING_v2.3.md", "ferry"],
      ["Oren_Pike_Dossier_DRAFT_v0.9.md", null],
    ]);
    expect(guide.mentionedBy).toEqual([
      { recordId: "ferry", title: "Ferry Town", type: "worldbuilding", via: ["Saltmarsh_Annals_Series_Guide_APPROVED_v1.8.md", "SA-TIDE-001"] },
    ]);
    expect(guide.defined.map((d) => d.id)).toContain("SA-WORLD-004");

    const ferry = crossRefsFor(index, "ferry");
    expect(ferry.ids.map((m) => [m.id, m.target?.recordId ?? null])).toEqual([
      ["SA-TIDE-001", "guide"],
      ["SA-TIDE-999", null],
    ]);
    expect(ferry.mentionedBy.map((m) => m.recordId)).toEqual(["guide"]);

    const chapter = crossRefsFor(index, "ch1");
    expect(chapter.defined).toEqual([expect.objectContaining({ id: "SA-B1-C01", via: "refIds" })]);
  });

  it("hides unknown ID-like words whose prefix no document uses", () => {
    const other = buildCrossRefIndex([{ id: "x", title: "X", type: "worldbuilding", body: "Saved as UTF-8 by SA-TIDE-001.", fields: {}, filenames: [] }]);
    expect(crossRefsFor(other, "x").ids).toEqual([]);
  });

  it("splits text into links for known references only", () => {
    const parts = linkSegments("See SA-TIDE-001 and `x` SA-TIDE-999 in Ferry_Town_Daily_Life_v9.md.", index);
    expect(parts.map((p) => [p.text, p.target?.recordId ?? null])).toEqual([
      ["See ", null],
      ["SA-TIDE-001", "guide"],
      [" and `x` SA-TIDE-999 in ", null],
      ["Ferry_Town_Daily_Life_v9.md", "ferry"],
      [".", null],
    ]);
  });
});
