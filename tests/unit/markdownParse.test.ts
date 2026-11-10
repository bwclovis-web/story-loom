import { describe, expect, it } from "vitest";
import { inlineText, parseInline, parseMarkdown, safeHref, type Block, type Inline } from "@/writing/markdownParse";

const blocks = (src: string) => parseMarkdown(src).blocks;
const kinds = (src: string) => blocks(src).map((b) => b.kind);
const first = <K extends Block["kind"]>(src: string, kind: K) => {
  const b = blocks(src).find((x) => x.kind === kind);
  if (!b) throw new Error(`no ${kind}`);
  return b as Extract<Block, { kind: K }>;
};

/** Compact rendering of inline nodes for assertions. */
function show(nodes: readonly Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.kind) {
        case "text":
          return n.text;
        case "break":
          return "<br>";
        case "code":
          return `<code>${n.text}</code>`;
        case "link":
          return `<a ${n.href}>${show(n.children)}</a>`;
        case "image":
          return `<img ${n.name} "${n.alt}">`;
        default:
          return `<${n.kind}>${show(n.children)}</${n.kind}>`;
      }
    })
    .join("");
}

describe("block structure", () => {
  it("reads headings, paragraphs and rules", () => {
    expect(kinds("# Seren\n\nArchivist.\n\n* * *\n\n## Role ##\nText")).toEqual(["heading", "paragraph", "rule", "heading", "paragraph"]);
    const doc = parseMarkdown("# Seren\n\n## Role ##");
    expect(doc.headings).toEqual([
      { level: 1, id: "doc-seren", text: "Seren" },
      { level: 2, id: "doc-role", text: "Role" },
    ]);
  });

  it("does not treat #word as a heading and makes duplicate heading IDs unique", () => {
    expect(kinds("#hashtag")).toEqual(["paragraph"]);
    expect(parseMarkdown("## Notes\n\n## Notes").headings.map((h) => h.id)).toEqual(["doc-notes", "doc-notes-2"]);
  });

  it("keeps single line breaks inside a paragraph", () => {
    const p = first("**Role:** harbor pilot.\n**Age:** 41.", "paragraph");
    expect(show(p.children)).toBe("<strong>Role:</strong> harbor pilot.<br><strong>Age:</strong> 41.");
  });

  it("reads bulleted, numbered and nested lists", () => {
    const list = first("- one\n- two\n  - nested\n- three", "list");
    expect(list.ordered).toBe(false);
    expect(list.tight).toBe(true);
    expect(list.items).toHaveLength(3);
    expect(list.items[1].map((b) => b.kind)).toEqual(["paragraph", "list"]);

    const ordered = first("3. c\n4. d", "list");
    expect(ordered).toMatchObject({ ordered: true, start: 3 });
    expect(ordered.items).toHaveLength(2);
  });

  it("marks lists with blank lines between items as loose and ends a list at an unindented paragraph", () => {
    expect(first("- a\n\n- b", "list").tight).toBe(false);
    expect(kinds("- a\n- b\n\nAfter the list.")).toEqual(["list", "paragraph"]);
  });

  it("reads block quotes, including lazy continuation lines", () => {
    const quote = first("> First line\ncontinues\n>\n> - item", "quote");
    expect(quote.children.map((b) => b.kind)).toEqual(["paragraph", "list"]);
  });

  it("keeps fenced code verbatim, including Markdown and HTML inside it", () => {
    const code = first("```\n# not a heading\n<b>x</b>\n```", "code");
    expect(code.text).toBe("# not a heading\n<b>x</b>");
  });

  it("reads tables with alignment, escaped pipes and short rows", () => {
    const table = first("| Name | Age |\n|:---|---:|\n| Mara | 30 |\n| a \\| b |", "table");
    expect(table.align).toEqual(["left", "right"]);
    expect(table.head.map(inlineText)).toEqual(["Name", "Age"]);
    expect(table.rows.map((r) => r.map(inlineText))).toEqual([
      ["Mara", "30"],
      ["a | b", ""],
    ]);
  });

  it("does not take a paragraph with pipes for a table without a delimiter row", () => {
    expect(kinds("either | or\nnot a table")).toEqual(["paragraph"]);
  });

  it("shows raw HTML as text, never as elements", () => {
    const p = first('<script>alert("x")</script> <b>bold</b>', "paragraph");
    expect(show(p.children)).toBe('<script>alert("x")</script> <b>bold</b>');
    expect(p.children.every((n) => n.kind === "text")).toBe(true);
  });
});

describe("inline formatting", () => {
  it("reads emphasis, strong, strikethrough and code", () => {
    expect(show(parseInline("*a* **b** ***c*** ~~d~~ `e*f*`"))).toBe(
      "<em>a</em> <strong>b</strong> <strong><em>c</em></strong> <del>d</del> <code>e*f*</code>",
    );
    expect(show(parseInline("__strong__ and _em_"))).toBe("<strong>strong</strong> and <em>em</em>");
    expect(show(parseInline("*a **b** c*"))).toBe("<em>a <strong>b</strong> c</em>");
  });

  it("leaves unmatched or spaced markers, intraword underscores and escapes alone", () => {
    expect(show(parseInline("2 * 3 * 4"))).toBe("2 * 3 * 4");
    expect(show(parseInline("snake_case_name"))).toBe("snake_case_name");
    expect(show(parseInline("\\*not em\\*"))).toBe("*not em*");
    expect(show(parseInline("**unclosed"))).toBe("**unclosed");
  });

  it("reads inline, reference, angle and bare links", () => {
    expect(show(parseInline("[Guild](https://example.test/guild)"))).toBe("<a https://example.test/guild>Guild</a>");
    expect(show(parseInline('[Guild](https://example.test/a_(b) "title")'))).toBe("<a https://example.test/a_(b)>Guild</a>");
    expect(show(parseInline("<https://example.test>"))).toBe("<a https://example.test>https://example.test</a>");
    expect(show(parseInline("See https://example.test/x."))).toBe("See <a https://example.test/x>https://example.test/x</a>.");
    const doc = parseMarkdown("See [the map][m].\n\n[m]: https://example.test/map");
    expect(doc.blocks).toHaveLength(1);
    expect(show((doc.blocks[0] as Extract<Block, { kind: "paragraph" }>).children)).toBe("See <a https://example.test/map>the map</a>.");
  });

  it("drops unsafe link targets but keeps the link text", () => {
    expect(show(parseInline("[click](javascript:alert(1))"))).toBe("click");
    expect(show(parseInline("[x](java\tscript:alert(1))"))).toBe("[x](java\tscript:alert(1))");
    expect(show(parseInline("[x](data:text/html;base64,AAAA)"))).toBe("x");
    expect(show(parseInline("[x](//evil.test)"))).toBe("x");
    expect(safeHref(" JAVASCRIPT:alert(1)")).toBeNull();
    expect(safeHref("vbscript:x")).toBeNull();
    expect(safeHref("mailto:a@example.test")).toBe("mailto:a@example.test");
    expect(safeHref("/projects/p/records/r")).toBe("/projects/p/records/r");
    expect(safeHref("#doc-role")).toBe("#doc-role");
  });

  it("shows images as links instead of loading them", () => {
    expect(show(parseInline("![Harbor map](https://example.test/map.png)"))).toBe("<a https://example.test/map.png>Image: Harbor map</a>");
    expect(show(parseInline("![x](javascript:alert(1))"))).toBe("x");
  });

  it("reads attached images by name, with plain-text alt", () => {
    expect(show(parseInline('See ![The *Lamp* map](image:lamp-map.png "title") here'))).toBe('See <img lamp-map.png "The Lamp map"> here');
    expect(show(parseInline("![](<image:a.jpg>)"))).toBe('<img a.jpg "">');
    expect(show(parseInline("[link](image:a.jpg)"))).toBe("link");
  });

  it("turns a trailing backslash or two spaces into a line break", () => {
    expect(show(parseInline("a\\\nb"))).toBe("a<br>b");
    expect(show(parseInline("a  \nb"))).toBe("a<br>b");
  });
});
