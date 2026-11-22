import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { createSyncBundle } from "@/server/syncBundleService";

export async function GET(_request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const db = getDb();
  try {
    const bundle = await createSyncBundle(db, workspaceId);
    const filename = `${workspaceId}.wordly-sync-bundle.json`;
    return new NextResponse(JSON.stringify(bundle, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 404 });
  }
}