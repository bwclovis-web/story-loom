import { isManuscriptType, isRecordType } from "@/domain/recordTypes";
import { getDb } from "@/server/db";
import { NotFoundError } from "@/server/services/errors";
import { buildReferencesWikiZip } from "@/server/services/worldBibleExport";

export const dynamic = "force-dynamic";

/** Static HTML wiki zip: ?record=<id> plus optional ceiling=approved&spoilerBefore=<chapterOrSceneId> */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const query = new URL(request.url).searchParams;
  const db = getDb();
  try {
    const types = query.getAll("type").filter((type) => isRecordType(type) && !isManuscriptType(type));
    const ids = new Set(query.getAll("record"));
    if (types.length) {
      const rows = await db.record.findMany({ where: { projectId, type: { in: types }, trashedAt: null }, select: { id: true } });
      rows.forEach((row) => ids.add(row.id));
    }
    if (!ids.size) return new Response("Choose at least one document.", { status: 400 });
    const file = await buildReferencesWikiZip(db, projectId, [...ids], {
      approvedOnly: query.get("ceiling") === "approved",
      spoilerBeforeRecordId: query.get("spoilerBefore") || null,
    });
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