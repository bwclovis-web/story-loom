import { describe, expect, it } from "vitest";
import { markdownToPlain, worldHubReadingExcerpt } from "@/world/worldHubExcerpt";

describe("worldHubReadingExcerpt", () => {
  it("prefers fields.summary over body", () => {
    expect(
      worldHubReadingExcerpt({ summary: "Author summary." }, "# Heading\n\nBody text that is longer."),
    ).toBe("Author summary.");
  });

  it("uses worldProfile.summary when present", () => {
    expect(
      worldHubReadingExcerpt({ worldProfile: { summary: "Living world blurb." } }, "Ignored body"),
    ).toBe("Living world blurb.");
  });

  it("strips Markdown from body when no summary", () => {
    expect(worldHubReadingExcerpt({}, "## Title\n\nA **bold** [link](https://x.test) and `code`.")).toBe(
      "Title A bold link and code.",
    );
  });

  it("returns the empty label when nothing usable exists", () => {
    expect(worldHubReadingExcerpt({}, "   ")).toBe("No description yet.");
    expect(worldHubReadingExcerpt({}, "", "Custom empty")).toBe("Custom empty");
  });

  it("clips long plain text deterministically", () => {
    const long = "word ".repeat(80).trim();
    const excerpt = worldHubReadingExcerpt({ summary: long }, "");
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(220);
    expect(excerpt).not.toMatch(/[*_`#]/);
  });
});

describe("markdownToPlain", () => {
  it("removes fenced code and HTML tags", () => {
    expect(markdownToPlain("Before\n```js\nconst x = 1;\n```\nAfter <em>ok</em>")).toBe("Before After ok");
  });
});
