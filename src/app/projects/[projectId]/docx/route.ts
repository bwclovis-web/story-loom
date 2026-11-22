import { isManuscriptType, isRecordType } from "@/domain/recordTypes";
import { getDb } from "@/server/db";
import { resolveExportDraftId } from "@/server/draftSelection";
import { getDraftDefaults, listManuscriptDrafts } from "@/server/services/draftService";
import { buildManuscriptDocx } from "@/server/services/docxExportService";
import { NotFoundError } from "@/server/services/errors";
import { buildReferencesDocx } from "@/server/services/worldBibleExport";

export const dynamic = "force-dynamic";

/** Manuscript DOCX: ?sceneTitles=1&draft=<draftId> */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const query = new URL(request.url).searchParams;
  const db = getDb();
  try {
    if (query.get("kind") === "references") {
      const ids = await referenceIds(db, projectId, query);
      if (!ids.length) return new Response("Choose at least one document.", { status: 400 });
      const file = await buildReferencesDocx(db, projectId, ids);
      return new Response(new Uint8Array(file.bytes), {
        headers: {
          "Content-Type": file.contentType,
          "Content-Disposition": `attachment; filename="${file.filename}"`,
          "Content-Length": String(file.bytes.length),
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    const [drafts, defaults] = await Promise.all([listManuscriptDrafts(db, projectId), getDraftDefaults(db, projectId)]);
    const hasDrafts = drafts.length > 0;
    const draftId = resolveExportDraftId(drafts, defaults, query.get("draft"));
    if (hasDrafts && !draftId) {
      return new Response("Choose a manuscript draft for the DOCX.", { status: 400 });
    }
    const beta = query.get("beta") === "1";
    const file = await buildManuscriptDocx(db, projectId, {
      sceneTitles: query.get("sceneTitles") === "1",
      hasDrafts,
      draftId,
      betaReader: beta
        ? {
            lineNumbers: query.get("lineNumbers") === "1",
            glossaryAppendix: query.get("glossary") === "1",
            watermark: query.get("watermark")?.trim() || undefined,
          }
        : undefined,
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

async function referenceIds(db: ReturnType<typeof getDb>, projectId: string, query: URLSearchParams): Promise<string[]> {
  const types = query.getAll("type").filter((type) => isRecordType(type) && !isManuscriptType(type));
  const ids = new Set(query.getAll("record"));
  if (types.length) {
    const rows = await db.record.findMany({ where: { projectId, type: { in: types }, trashedAt: null }, select: { id: true } });
    rows.forEach((row) => ids.add(row.id));
  }
  return [...ids];
}