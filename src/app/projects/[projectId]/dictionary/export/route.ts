import { buildDictionaryExport } from "@/spelling/dictionaryFile";
import { getDb } from "@/server/db";
import { DictionaryError, dictionaryForExport } from "@/server/services/dictionaryService";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const scope = new URL(request.url).searchParams.get("scope");
  if (scope !== "project" && scope !== "workspace") return new Response("Choose scope=project or scope=workspace", { status: 400 });
  try {
    const { label, entries } = await dictionaryForExport(getDb(), projectId, scope);
    const file = buildDictionaryExport(scope, label, entries);
    const stamp = file.exportedAt.slice(0, 10);
    return new Response(JSON.stringify(file, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${projectId}-${scope}-${stamp}.wordly-dictionary.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof DictionaryError) return new Response("Project not found", { status: 404 });
    throw error;
  }
}
