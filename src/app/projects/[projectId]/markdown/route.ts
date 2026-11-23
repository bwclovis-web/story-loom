import { getDb } from "@/server/db";
import { NotFoundError } from "@/server/services/errors";
import { buildReferencesMarkdownBundle } from "@/server/services/worldBibleExport";
import {
  parseWorldBibleExportQuery,
  worldBibleSelectionHasScope,
} from "@/server/services/worldBibleExportQuery";

export const dynamic = "force-dynamic";

/** World bible Markdown bundle: ?kind=references plus record/type/collection/taxonomy and spoiler policy. */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const query = new URL(request.url).searchParams;
  if (query.get("kind") !== "references") {
    return new Response("Markdown export is for selected reference documents. Use kind=references.", {
      status: 400,
    });
  }
  const db = getDb();
  try {
    const { selection, policy } = parseWorldBibleExportQuery(query);
    if (!worldBibleSelectionHasScope(selection)) {
      return new Response("Choose at least one document, type, taxonomy filter, or collection.", {
        status: 400,
      });
    }
    const file = await buildReferencesMarkdownBundle(db, projectId, selection, policy);
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
