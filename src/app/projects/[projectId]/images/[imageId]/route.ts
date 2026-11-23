import { getDb } from "@/server/db";
import { isImagesTableMissing, resolveAvailableImage } from "@/server/services/imageService";

export const dynamic = "force-dynamic";

/*
 * Serves an image stored with a reference document. The content type is the
 * one detected from the bytes on upload. An image ID never changes content,
 * so the browser may cache it. Series-shared host records in sibling books of
 * the same workspace series are readable from the viewing project URL.
 */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string; imageId: string }> }) {
  const { projectId, imageId } = await params;
  try {
    const image = await resolveAvailableImage(getDb(), projectId, imageId);
    if (!image) return new Response("Image not found", { status: 404 });
    const etag = `"${image.contentHash}"`;
    const headers = {
      "Content-Type": image.mimeType,
      "Content-Disposition": `inline; filename="${image.name}"`,
      "Cache-Control": "private, max-age=31536000, immutable",
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(Buffer.from(image.data), { headers });
  } catch (error) {
    if (isImagesTableMissing(error)) return new Response("Image not found", { status: 404 });
    throw error;
  }
}
