import "server-only";
import { PDF_IMAGE_TYPES, type ImageMimeType } from "@/images/imageFormat";
import type { PdfImage } from "@/server/pdf/pdfRender";
import { imageDataByIds, imagesByRecord } from "./imageService";
import type { DbOrTx } from "../db";

export type ExportInlineImage = PdfImage;

/** Loads image metadata and embeddable bytes, keyed by record id then image name. */
export async function loadManuscriptExportImages(
  db: DbOrTx,
  projectId: string,
  recordIds: string[],
): Promise<Map<string, Map<string, ExportInlineImage>>> {
  const byRecord = await imagesByRecord(db, projectId, recordIds);
  const embeddable = [...byRecord.values()].flat().filter((img) => PDF_IMAGE_TYPES.includes(img.mimeType));
  const data = await imageDataByIds(
    db,
    projectId,
    embeddable.map((img) => img.id),
  );
  const result = new Map<string, Map<string, ExportInlineImage>>();
  for (const [recordId, images] of byRecord) {
    result.set(
      recordId,
      new Map(
        images.map((img) => [
          img.name,
          {
            name: img.name,
            mimeType: img.mimeType,
            width: img.width,
            height: img.height,
            caption: img.caption,
            data: data.get(img.id),
          },
        ]),
      ),
    );
  }
  return result;
}

export function docxImageType(mimeType: ImageMimeType): "png" | "jpg" | null {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  return null;
}

/** Scale to fit roughly within a 6×9 text column (in pixels at 96 dpi). */
export function scaledImagePx(width: number, height: number, maxWidth = 420, maxHeight = 560): { width: number; height: number } {
  const scale = Math.min(1, maxWidth / width, maxHeight / height, 0.85);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}