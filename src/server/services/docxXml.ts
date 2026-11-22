import JSZip from "jszip";

/** Decode WordprocessingML entities used in document text. */
export function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function stripXmlTags(xml: string): string {
  return decodeXmlEntities(
    xml
      .replace(/<w:tab\b[^/]*\/>/gi, "\t")
      .replace(/<w:br\b[^/]*\/>/gi, "\n")
      .replace(/<w:cr\b[^/]*\/>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  );
}

/** Collect text from `w:t` runs inside a fragment, optionally including ins/del. */
export function collectWtText(fragment: string, mode: "final" | "original" | "all"): string {
  const parts: string[] = [];
  const tokenRe = /<(w:ins|w:del|w:t)\b([^>]*)>([\s\S]*?)<\/\1>|<(w:tab|w:br|w:cr)\b[^/]*\/>/gi;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(fragment))) {
    const tag = (m[1] ?? m[4] ?? "").toLowerCase();
    if (tag === "w:tab") {
      parts.push("\t");
      continue;
    }
    if (tag === "w:br" || tag === "w:cr") {
      parts.push("\n");
      continue;
    }
    if (tag === "w:ins") {
      if (mode === "original") continue;
      parts.push(collectWtText(m[3], mode));
      continue;
    }
    if (tag === "w:del") {
      if (mode === "final") continue;
      parts.push(collectWtText(m[3], mode === "all" ? "all" : "original"));
      continue;
    }
    if (tag === "w:t") {
      parts.push(decodeXmlEntities(m[3]));
    }
  }
  return parts.join("");
}

export async function loadDocxZip(bytes: ArrayBuffer | Uint8Array | Buffer): Promise<JSZip> {
  const zip = await JSZip.loadAsync(bytes);
  if (!zip.file("word/document.xml")) {
    throw new Error("That file is not a readable Word document (.docx).");
  }
  return zip;
}

export async function readZipText(zip: JSZip, path: string): Promise<string | null> {
  const file = zip.file(path);
  if (!file) return null;
  return file.async("string");
}

export function paragraphStyleId(paragraphXml: string): string | null {
  const m = paragraphXml.match(/<w:pStyle\b[^>]*\bw:val="([^"]+)"/i);
  return m ? m[1] : null;
}

export function isHeadingStyle(styleId: string | null, outlineLevel: number | null): number | null {
  if (outlineLevel !== null && outlineLevel >= 0 && outlineLevel <= 8) return outlineLevel + 1;
  if (!styleId) return null;
  const heading = styleId.match(/^heading\s*(\d+)$/i) || styleId.match(/^h(\d+)$/i);
  if (heading) return Math.min(6, Math.max(1, Number(heading[1])));
  if (/^title$/i.test(styleId)) return 1;
  return null;
}

export function outlineLevel(paragraphXml: string): number | null {
  const m = paragraphXml.match(/<w:outlineLvl\b[^>]*\bw:val="(\d+)"/i);
  return m ? Number(m[1]) : null;
}

export function splitParagraphs(documentXml: string): string[] {
  const body = documentXml.match(/<w:body\b[^>]*>([\s\S]*)<\/w:body>/i)?.[1] ?? documentXml;
  return [...body.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/gi)].map((m) => m[0]);
}

export interface DocxComment {
  id: string;
  author: string;
  body: string;
}

export async function parseCommentsXml(zip: JSZip): Promise<Map<string, DocxComment>> {
  const xml = await readZipText(zip, "word/comments.xml");
  const map = new Map<string, DocxComment>();
  if (!xml) return map;
  for (const m of xml.matchAll(/<w:comment\b([^>]*)>([\s\S]*?)<\/w:comment>/gi)) {
    const attrs = m[1];
    const id = attrs.match(/\bw:id="([^"]+)"/i)?.[1];
    if (!id) continue;
    const author = attrs.match(/\bw:author="([^"]*)"/i)?.[1] ?? "Editor";
    const body = collectWtText(m[2], "final").replace(/\s+/g, " ").trim();
    map.set(id, { id, author: decodeXmlEntities(author), body });
  }
  return map;
}
