import { describe, expect, it } from "vitest";
import { applyEdit } from "@/writing/findReplace";
import {
  blockState,
  inlineState,
  insertLink,
  insertSceneBreak,
  linkAt,
  minimalEdit,
  setBlockStyle,
  toggleInline,
  toggleList,
  type FormatResult,
  type Selection,
} from "@/writing/markdownFormat";

/** Text with [ and ] marking the selection, e.g. "a [word] here". A single | marks a caret. */
function parse(marked: string): { text: string; sel: Selection } {
  const caret = marked.indexOf("|");
  if (caret >= 0) return { text: marked.replace("|", ""), sel: { start: caret, end: caret } };
  const start = marked.indexOf("[");
  const end = marked.indexOf("]") - 1;
  return { text: marked.replace("[", "").replace("]", ""), sel: { start, end } };
}

function show(text: string, sel: Selection): string {
  if (sel.start === sel.end) return text.slice(0, sel.start) + "|" + text.slice(sel.start);
  return text.slice(0, sel.start) + "[" + text.slice(sel.start, sel.end) + "]" + text.slice(sel.end);
}

function run(marked: string, fn: (text: string, sel: Selection) => FormatResult): string {
  const { text, sel } = parse(marked);
  const r = fn(text, sel);
  return show(applyEdit(text, r.edit), r.selection);
}

describe("bold and italic", () => {
  it("wraps the selection and keeps the words selected", () => {
    expect(run("Mara [crossed] the bridge.", (t, s) => toggleInline(t, s, "bold"))).toBe("Mara **[crossed]** the bridge.");
    expect(run("Mara [crossed] the bridge.", (t, s) => toggleInline(t, s, "italic"))).toBe("Mara *[crossed]* the bridge.");
  });

  it("leaves surrounding spaces outside the markers", () => {
    expect(run("Mara [crossed ]the bridge.", (t, s) => toggleInline(t, s, "bold"))).toBe("Mara **[crossed]** the bridge.");
  });

  it("removes markers around the selection, or included in it", () => {
    expect(run("Mara **[crossed]** the bridge.", (t, s) => toggleInline(t, s, "bold"))).toBe("Mara [crossed] the bridge.");
    expect(run("Mara [**crossed**] the bridge.", (t, s) => toggleInline(t, s, "bold"))).toBe("Mara [crossed] the bridge.");
    expect(run("Mara *[crossed]* the bridge.", (t, s) => toggleInline(t, s, "italic"))).toBe("Mara [crossed] the bridge.");
  });

  it("tells bold, italic and both apart", () => {
    expect(inlineState(...args("Mara **[crossed]** it"))).toEqual({ bold: true, italic: false });
    expect(inlineState(...args("Mara *[crossed]* it"))).toEqual({ bold: false, italic: true });
    expect(inlineState(...args("Mara ***[crossed]*** it"))).toEqual({ bold: true, italic: true });
    expect(inlineState(...args("Mara [crossed] it"))).toEqual({ bold: false, italic: false });
    expect(run("Mara ***[crossed]*** it", (t, s) => toggleInline(t, s, "italic"))).toBe("Mara **[crossed]** it");
  });

  it("inserts an empty pair at a caret, with the caret inside", () => {
    expect(run("Mara | the bridge.", (t, s) => toggleInline(t, s, "bold"))).toBe("Mara **|** the bridge.");
  });
});

function args(marked: string): [string, Selection] {
  const { text, sel } = parse(marked);
  return [text, sel];
}

describe("block styles", () => {
  it("sets and replaces heading levels, keeping the caret in the words", () => {
    expect(run("Intro\nThe Ferry|man\nEnd", (t, s) => setBlockStyle(t, s, "h2"))).toBe("Intro\n## The Ferry|man\nEnd");
    expect(run("# The Ferry|man", (t, s) => setBlockStyle(t, s, "h3"))).toBe("### The Ferry|man");
    expect(run("### The Ferry|man", (t, s) => setBlockStyle(t, s, "paragraph"))).toBe("The Ferry|man");
  });

  it("quotes every selected line and leaves blank lines alone", () => {
    expect(run("[one\n\ntwo]", (t, s) => setBlockStyle(t, s, "quote"))).toBe("> [one\n\n> two]");
  });

  it("reports the style of the first selected line", () => {
    expect(blockState(...args("## Tit|le")).style).toBe("h2");
    expect(blockState(...args("> qu|ote")).style).toBe("quote");
    expect(blockState(...args("pl|ain")).style).toBe("paragraph");
    expect(blockState(...args("#### dee|p")).style).toBe("other");
  });

  it("does not include the line after a selection that ends with a line break", () => {
    expect(run("[one\n]two", (t, s) => setBlockStyle(t, s, "h1"))).toBe("# [one\n]two");
  });
});

describe("lists", () => {
  it("numbers non-empty lines and toggles back off", () => {
    expect(run("[apples\npears\n\nplums]", (t, s) => toggleList(t, s, "number"))).toBe("1. [apples\n2. pears\n\n3. plums]");
    expect(run("[1. apples\n2. pears]", (t, s) => toggleList(t, s, "number"))).toBe("[apples\npears]");
  });

  it("switches list kinds", () => {
    expect(run("[- apples\n- pears]", (t, s) => toggleList(t, s, "number"))).toBe("1. [apples\n2. pears]");
    expect(blockState(...args("[- apples\n- pears]")).list).toBe("bullet");
    expect(blockState(...args("[- apples\npears]")).list).toBe(null);
  });

  it("moves a caret inside a removed marker to the line start", () => {
    expect(run("- |apples", (t, s) => toggleList(t, s, "bullet"))).toBe("|apples");
  });
});

describe("links", () => {
  it("links the selected words and selects them", () => {
    // The outer brackets are the Markdown link; the inner ones mark the selected label.
    expect(run("See [the map] here", (t, s) => insertLink(t, s, "https://example.test/map"))).toBe(
      "See [[the map]](https://example.test/map) here",
    );
  });

  it("updates the link the caret is in", () => {
    const { text, sel } = parse("See [the map](https://old.test) |here");
    expect(linkAt(text, { start: 6, end: 6 })).toEqual({ start: 4, end: 31, label: "the map", url: "https://old.test" });
    expect(linkAt(text, sel)).toBeNull();
    const r = insertLink(text, { start: 6, end: 6 }, "https://new.test");
    expect(applyEdit(text, r.edit)).toBe("See [the map](https://new.test) here");
  });

  it("falls back to the selected words when the label is left empty", () => {
    const r = insertLink("See the map", { start: 4, end: 11 }, "https://example.test", "  ");
    expect(applyEdit("See the map", r.edit)).toBe("See [the map](https://example.test)");
  });

  it("uses the address as the label when nothing is selected and escapes spaces", () => {
    const r = insertLink("Go ", { start: 3, end: 3 }, "https://example.test/a b");
    expect(applyEdit("Go ", r.edit)).toBe("Go [https://example.test/a b](https://example.test/a%20b)");
  });
});

describe("scene breaks", () => {
  it("puts the break on its own paragraph", () => {
    expect(run("End of one.|Start of two.", insertSceneBreak)).toBe("End of one.\n\n* * *\n\n|Start of two.");
    expect(run("End of one.\n\n|Start of two.", insertSceneBreak)).toBe("End of one.\n\n* * *\n\n|Start of two.");
  });
});

describe("minimalEdit", () => {
  it("trims the unchanged parts of an edit", () => {
    expect(minimalEdit("abc def", { start: 0, end: 7, text: "abc XYZ def" })).toEqual({ start: 4, end: 4, text: "XYZ " });
  });
});
