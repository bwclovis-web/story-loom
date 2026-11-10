import { describe, expect, it } from "vitest";
import { tidyText } from "@/writing/tidy";

const plain = { typography: false };

describe("tidyText", () => {
  it("collapses blank lines, trims trailing spaces and keeps single line breaks", () => {
    const input = "\n\nThe ferry left.   \nNobody waved.\n\n\n\nThe gulls stayed.\t\n\n";
    const { text, report } = tidyText(input, plain);
    expect(text).toBe("The ferry left.\nNobody waved.\n\nThe gulls stayed.");
    expect(report.trailingSpaces).toBe(2);
    expect(report.blankLines).toBeGreaterThanOrEqual(4);
  });

  it("makes headings consistent and sets them apart", () => {
    const { text, report } = tidyText("#The Tidewater ##\nThe ferry left.\n##   Morning\nGulls.", plain);
    expect(text).toBe("# The Tidewater\n\nThe ferry left.\n\n## Morning\n\nGulls.");
    expect(report.headings).toBe(2);
    expect(report.spacing).toBe(3);
  });

  it("turns scene break markers into one form", () => {
    const { text, report } = tidyText("One.\n***\nTwo.\n\n#\n\nThree.\n\n- - -\n\nFour.\n\n* * *\n\nFive.", plain);
    expect(text).toBe("One.\n\n* * *\n\nTwo.\n\n* * *\n\nThree.\n\n* * *\n\nFour.\n\n* * *\n\nFive.");
    expect(report.sceneBreaks).toBe(3);
  });

  it("uses curly quotes, apostrophes, em dashes and ellipses", () => {
    const input = `"Don't," she said. 'Not yet...' He waited -- then laughed. "I was going to--" she stopped. Back in the '90s.`;
    const { text, report } = tidyText(input);
    expect(text).toBe(
      "\u201CDon\u2019t,\u201D she said. \u2018Not yet\u2026\u2019 He waited \u2014 then laughed. \u201CI was going to\u2014\u201D she stopped. Back in the \u201990s.",
    );
    expect(report.quotes).toBe(8);
    expect(report.dashes).toBe(2);
    expect(report.ellipses).toBe(1);
  });

  it("leaves code, link addresses, URLs, comments, tables and front matter alone", () => {
    const input = [
      "---",
      "title: \"Draft\"",
      "---",
      "",
      "See `it's -- raw` and [the 'map'](https://example.test/a--b) or https://example.test/x--y.",
      "<!-- note -- here -->",
      "",
      "| a | b |",
      "| --- | --- |",
      "",
      "```",
      "\"quoted\" -- kept   ",
      "",
      "",
      "```",
    ].join("\n");
    const { text } = tidyText(input);
    expect(text).toBe(
      [
        "---",
        "title: \"Draft\"",
        "---",
        "",
        "See `it's -- raw` and [the \u2018map\u2019](https://example.test/a--b) or https://example.test/x--y.",
        "<!-- note -- here -->",
        "",
        "| a | b |",
        "| --- | --- |",
        "",
        "```",
        "\"quoted\" -- kept   ",
        "",
        "",
        "```",
      ].join("\n"),
    );
  });

  it("is idempotent and reports no change for tidy text", () => {
    const messy = "#Title\n\n\n\"Hi\" -- she said...   \n***\nEnd.";
    const once = tidyText(messy).text;
    const twice = tidyText(once);
    expect(twice.text).toBe(once);
    expect(twice.changed).toBe(false);
  });

  it("normalises Windows line endings and a byte-order mark", () => {
    expect(tidyText("\uFEFFOne.\r\n\r\nTwo.\r\n", plain).text).toBe("One.\n\nTwo.");
  });
});
