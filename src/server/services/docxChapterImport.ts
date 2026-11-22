import "server-only";
import type { ChapterFile } from "./chapterImportService";
import { parseDocx, splitDocxIntoChapters } from "./docxParse";

/**
 * Turn one or more .docx buffers into ChapterFile rows for previewChapterImport /
 * applyChapterImport. Heading 1 splits chapters; Heading 2 and *** stay as scene
 * breaks in the chapter body (imports still never create scene records).
 */
export async function docxBuffersToChapterFiles(
  files: readonly { filename: string; bytes: ArrayBuffer | Uint8Array | Buffer }[],
): Promise<ChapterFile[]> {
  const out: ChapterFile[] = [];
  let chapterOrdinal = 0;
  for (const file of files) {
    const parsed = await parseDocx(file.bytes);
    const base = file.filename.replace(/^.*[\\/]/, "").replace(/\.docx$/i, "") || "Chapter";
    const slices = splitDocxIntoChapters(parsed, base);
    for (const slice of slices) {
      chapterOrdinal += 1;
      const padded = String(chapterOrdinal).padStart(2, "0");
      out.push({
        filename: `${padded}-${slice.filenameStem}.docx.md`,
        content: slice.body.startsWith("#") ? slice.body : `# ${slice.title}\n\n${slice.body}`,
      });
    }
  }
  return out;
}
