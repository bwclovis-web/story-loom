import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownView } from "@/components/MarkdownView";
import { IMAGE_NAME_PATTERN, imageMarkdown, imageNameFor, imageNamesInText, sniffImage } from "@/images/imageFormat";
import { parseMarkdown } from "@/writing/markdownParse";
import { makeGifHeader, makeJpegHeader, makePng, makeWebpHeader } from "../imageFixtures";

describe("image type detection", () => {
  it("reads the real type and size from the bytes", () => {
    expect(sniffImage(makePng(7, 3))).toEqual({ mimeType: "image/png", width: 7, height: 3 });
    expect(sniffImage(makeJpegHeader(640, 480))).toEqual({ mimeType: "image/jpeg", width: 640, height: 480 });
    expect(sniffImage(makeGifHeader(12, 34))).toEqual({ mimeType: "image/gif", width: 12, height: 34 });
    expect(sniffImage(makeWebpHeader(300, 200))).toEqual({ mimeType: "image/webp", width: 300, height: 200 });
  });

  it("refuses anything else, whatever it is called", () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(sniffImage(svg)).toBeNull();
    expect(sniffImage(new TextEncoder().encode("%PDF-1.7 not an image"))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
    expect(sniffImage(makePng(1, 1).subarray(0, 12))).toBeNull();
  });
});

describe("image names", () => {
  it("are made from the file name, use the detected extension, and never repeat", () => {
    const taken = new Set<string>();
    const first = imageNameFor("Harbour Map (final).JPEG", "image/png", taken);
    expect(first).toBe("harbour-map-final.png");
    taken.add(first);
    expect(imageNameFor("harbour map final.png", "image/png", taken)).toBe("harbour-map-final-2.png");
    expect(imageNameFor("Ångström Café.webp", "image/webp", new Set())).toBe("angstrom-cafe.webp");
    expect(imageNameFor("....", "image/gif", new Set())).toBe("image.gif");
    for (const n of [first, imageNameFor("x".repeat(300), "image/jpeg", new Set())]) expect(n).toMatch(IMAGE_NAME_PATTERN);
  });

  it("are found in text in order, once each", () => {
    const text = "![A](image:a.png) and ![B](image:b.jpg)\n![again](image:a.png) ![web](https://example.com/x.png)";
    expect(imageNamesInText(text)).toEqual(["a.png", "b.jpg"]);
  });

  it("insert as Markdown that the reader shows as that image", () => {
    const md = imageMarkdown("lamp.png", "The [old] lamp\nlit");
    expect(md).toBe("![The  old  lamp lit](image:lamp.png)");
    expect(imageNamesInText(md)).toEqual(["lamp.png"]);
  });
});

describe("images in formatted text", () => {
  const render = (body: string) =>
    renderToStaticMarkup(
      createElement(MarkdownView, {
        doc: parseMarkdown(body),
        images: new Map([["map.png", { src: "/projects/p/images/img_1", width: 40, height: 20, altText: "Stored description", caption: "The map" }]]),
      }),
    );

  it("shows attached images with their caption, and only from this app", () => {
    const html = render("Before ![Harbour](image:map.png) after");
    expect(html).toContain('src="/projects/p/images/img_1"');
    expect(html).toContain('alt="Harbour"');
    expect(html).toContain("The map");
  });

  it("uses the stored description when the text gives none", () => {
    expect(render("![](image:map.png)")).toContain('alt="Stored description"');
  });

  it("says when an image is not attached, and never loads web images", () => {
    const html = render("![x](image:gone.png) ![y](https://example.com/tracker.png)");
    expect(html).toContain("Image not found");
    expect(html).toContain("image:gone.png");
    expect(html).not.toContain('src="https://example.com');
  });
});
