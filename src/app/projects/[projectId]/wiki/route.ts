import { getDb } from "@/server/db";
import { NotFoundError } from "@/server/services/errors";
import { buildReferencesWikiZip } from "@/server/services/worldBibleExport";
import {
  parseWorldBibleExportQuery,
  worldBibleSelectionHasScope,
} from "@/server/services/worldBibleExportQuery";

export const dynamic = "force-dynamic";

/** Static HTML wiki zip with optional taxonomy/collection scope and point-scoped spoiler policy. */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const query = new URL(request.url).searchParams;
  const db = getDb();
  try {
    const { selection, policy } = parseWorldBibleExportQuery(query);
    if (!worldBibleSelectionHasScope(selection)) {
      return new Response("Choose at least one document, type, taxonomy filter, or collection.", {
        status: 400,
      });
    }
    const file = await buildReferencesWikiZip(db, projectId, selection, policy);
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
