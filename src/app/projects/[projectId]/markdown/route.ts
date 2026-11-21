import { isManuscriptType, isRecordType } from "@/domain/recordTypes";
import { getDb } from "@/server/db";
import { NotFoundError } from "@/server/services/errors";
import { buildReferencesMarkdownBundle } from "@/server/services/worldBibleExport";

export const dynamic = "force-dynamic";

/** World bible Markdown bundle: ?kind=references&record=<id> */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const query = new URL(request.url).searchParams;
  if (query.get("kind") !== "references") {
    return new Response("Markdown export is for selected reference documents. Use kind=references.", { status: 400 });
  }
  const db = getDb();
  try {
    const types = query.getAll("type").filter((type) => isRecordType(type) && !isManuscriptType(type));
    const ids = new Set(query.getAll("record"));
    if (types.length) {
      const rows = await db.record.findMany({ where: { projectId, type: { in: types }, trashedAt: null }, select: { id: true } });
      rows.forEach((row) => ids.add(row.id));
    }
    if (!ids.size) return new Response("Choose at least one document.", { status: 400 });
    const file = await buildReferencesMarkdownBundle(db, projectId, [...ids]);
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
