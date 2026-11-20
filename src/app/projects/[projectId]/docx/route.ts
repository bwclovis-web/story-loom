import { getDb } from "@/server/db";
import { resolveExportDraftId } from "@/server/draftSelection";
import { getDraftDefaults, listManuscriptDrafts } from "@/server/services/draftService";
import { buildManuscriptDocx } from "@/server/services/docxExportService";
import { NotFoundError } from "@/server/services/errors";

export const dynamic = "force-dynamic";

/** Manuscript DOCX: ?sceneTitles=1&draft=<draftId> */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const query = new URL(request.url).searchParams;
  const db = getDb();
  try {
    const [drafts, defaults] = await Promise.all([listManuscriptDrafts(db, projectId), getDraftDefaults(db, projectId)]);
    const hasDrafts = drafts.length > 0;
    const draftId = resolveExportDraftId(drafts, defaults, query.get("draft"));
    if (hasDrafts && !draftId) {
      return new Response("Choose a manuscript draft for the DOCX.", { status: 400 });
    }
    const file = await buildManuscriptDocx(db, projectId, {
      sceneTitles: query.get("sceneTitles") === "1",
      hasDrafts,
      draftId,
    });
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
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