import { isManuscriptType, isRecordType } from "@/domain/recordTypes";
import { getDb } from "@/server/db";
import { resolveExportDraftId } from "@/server/draftSelection";
import { getDraftDefaults, listManuscriptDrafts } from "@/server/services/draftService";
import { NotFoundError } from "@/server/services/errors";
import { buildManuscriptPdf, buildReferencesPdf } from "@/server/services/pdfExportService";

export const dynamic = "force-dynamic";

/*
 * Downloads a PDF built from saved records:
 *   ?kind=references&record=<id>&record=<id>&type=<record type>
 *   ?kind=manuscript&sceneTitles=1&draft=<draftId>
 * Nothing is stored; every request builds the file again.
 */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const query = new URL(request.url).searchParams;
  const db = getDb();
  try {
    let file;
    if (query.get("kind") === "manuscript") {
      const [drafts, defaults] = await Promise.all([listManuscriptDrafts(db, projectId), getDraftDefaults(db, projectId)]);
      const hasDrafts = drafts.length > 0;
      const draftId = resolveExportDraftId(drafts, defaults, query.get("draft"));
      if (hasDrafts && !draftId) {
        return new Response("Choose a manuscript draft for the PDF.", { status: 400 });
      }
      file = await buildManuscriptPdf(db, projectId, {
        sceneTitles: query.get("sceneTitles") === "1",
        hasDrafts,
        draftId,
      });
    } else if (query.get("kind") === "references") {
      const types = query.getAll("type").filter((t) => isRecordType(t) && !isManuscriptType(t));
      const ids = new Set(query.getAll("record"));
      if (types.length) {
        const rows = await db.record.findMany({ where: { projectId, type: { in: types }, trashedAt: null }, select: { id: true } });
        rows.forEach((r) => ids.add(r.id));
      }
      if (!ids.size) return new Response("Choose at least one document for the PDF.", { status: 400 });
      file = await buildReferencesPdf(db, projectId, [...ids]);
    } else {
      return new Response("Unknown PDF kind. Use kind=references or kind=manuscript.", { status: 400 });
    }
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": "application/pdf",
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
