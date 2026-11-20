import { getDb } from "@/server/db";
import { getProjectCoverData, isCoverTableMissing } from "@/server/services/coverService";

export const dynamic = "force-dynamic";

const EXTENSIONS = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" } as const;

/*
 * Serves the cover stored for a project. The content type is the one detected
 * from the bytes when the cover was saved. The home page puts the content
 * hash in the URL, so a replaced cover is a different address.
 */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  try {
    const cover = await getProjectCoverData(getDb(), projectId);
    if (!cover) return new Response("Cover not found", { status: 404 });
    const etag = `"${cover.contentHash}"`;
    const headers = {
      "Content-Type": cover.mimeType,
      "Content-Disposition": `inline; filename="cover.${EXTENSIONS[cover.mimeType]}"`,
      "Cache-Control": "private, max-age=31536000, immutable",
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(Buffer.from(cover.data), { headers });
  } catch (error) {
    if (isCoverTableMissing(error)) return new Response("Cover not found", { status: 404 });
    throw error;
  }
}
