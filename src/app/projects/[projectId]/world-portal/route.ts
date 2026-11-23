import { getDb } from "@/server/db";
import { NotFoundError } from "@/server/services/errors";
import {
  buildWorldPortalZip,
  isWorldPortalMode,
} from "@/server/services/worldPortalExport";
import {
  parseWorldBibleExportQuery,
  worldBibleSelectionHasScope,
} from "@/server/services/worldBibleExportQuery";

export const dynamic = "force-dynamic";

/**
 * Static World Portal ZIP (wiki + relationships + maps catalogue).
 * `mode=publicSafe` (default) or `mode=private`. Optional world-bible selection query.
 */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const query = new URL(request.url).searchParams;
  const db = getDb();
  try {
    const modeRaw = query.get("mode") ?? "publicSafe";
    if (!isWorldPortalMode(modeRaw)) {
      return new Response("mode must be publicSafe or private.", { status: 400 });
    }
    const { selection } = parseWorldBibleExportQuery(query);
    const scoped = worldBibleSelectionHasScope(selection) ? selection : {};
    const file = await buildWorldPortalZip(db, projectId, { mode: modeRaw, selection: scoped });
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        "Content-Length": String(file.bytes.length),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) return new Response(error.message, { status: 404 });
    throw error;
  }
}
