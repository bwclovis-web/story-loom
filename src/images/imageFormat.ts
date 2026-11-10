/*
 * Images attached to reference documents. The type and size come from the
 * file's own bytes, never from its name or the browser's claimed type, so a
 * renamed file cannot be served as something else. SVG is not accepted: it
 * can carry scripts.
 */

export const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

/** Formats the PDF export can embed. Others are listed by name in the PDF. */
export const PDF_IMAGE_TYPES: readonly ImageMimeType[] = ["image/png", "image/jpeg"];

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGES_PER_RECORD = 100;
export const MAX_CAPTION_CHARS = 500;
export const MAX_ALT_CHARS = 300;
export const IMAGE_ACCEPT = IMAGE_MIME_TYPES.join(",");

export const IMAGE_FORMAT_LABELS: Record<ImageMimeType, string> = {
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/gif": "GIF",
  "image/webp": "WebP",
};

const EXTENSIONS: Record<ImageMimeType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export function isImageMimeType(value: string): value is ImageMimeType {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

export interface ImageInfo {
  mimeType: ImageMimeType;
  width: number;
  height: number;
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

function png(b: Uint8Array): ImageInfo | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || !sig.every((v, i) => b[i] === v) || ascii(b, 12, 4) !== "IHDR") return null;
  return { mimeType: "image/png", width: u32be(b, 16), height: u32be(b, 20) };
}

function jpeg(b: Uint8Array): ImageInfo | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const length = u16be(b, i + 2);
    if (length < 2) return null;
    // Start-of-frame markers carry the size; C4 (huffman), C8 and CC are not frames.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { mimeType: "image/jpeg", height: u16be(b, i + 5), width: u16be(b, i + 7) };
    }
    i += 2 + length;
  }
  return null;
}

function gif(b: Uint8Array): ImageInfo | null {
  if (b.length < 10) return null;
  const sig = ascii(b, 0, 6);
  if (sig !== "GIF87a" && sig !== "GIF89a") return null;
  return { mimeType: "image/gif", width: u16le(b, 6), height: u16le(b, 8) };
}

function webp(b: Uint8Array): ImageInfo | null {
  if (b.length < 30 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") return null;
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8X") return { mimeType: "image/webp", width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  if (chunk === "VP8 " && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
    return { mimeType: "image/webp", width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (chunk === "VP8L" && b[20] === 0x2f) {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { mimeType: "image/webp", width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return null;
}

/** The image's real type and pixel size, or null when the bytes are not a supported image. */
export function sniffImage(bytes: Uint8Array): ImageInfo | null {
  const info = png(bytes) ?? jpeg(bytes) ?? gif(bytes) ?? webp(bytes);
  if (!info || info.width < 1 || info.height < 1) return null;
  return info;
}

export const IMAGE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/;

/**
 * The name the text uses for an image (`image:lamp-map.png`): lower case
 * letters, digits, dots, dashes and underscores, ending in the detected
 * format's extension, and unique within the record.
 */
export function imageNameFor(filename: string, mimeType: ImageMimeType, taken: ReadonlySet<string>): string {
  const base =
    filename
      .replace(/\.[^.]*$/, "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "image";
  const ext = EXTENSIONS[mimeType];
  let name = `${base}.${ext}`;
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}.${ext}`;
  return name;
}

const IMAGE_REF = /!\[[^\]\n]*\]\(\s*<?image:([^\s)>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;

/** Names of the images a text shows with `![alt](image:name)`, in order, without duplicates. */
export function imageNamesInText(text: string): string[] {
  const names: string[] = [];
  for (const m of text.matchAll(IMAGE_REF)) if (!names.includes(m[1])) names.push(m[1]);
  return names;
}

/** The Markdown that shows an image in a document's text. */
export function imageMarkdown(name: string, alt: string): string {
  const safeAlt = alt.replace(/[\[\]\n\r]/g, " ").trim();
  return `![${safeAlt}](image:${name})`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
