import { z } from "zod";
import { getDb } from "@/server/db";
import { cancelRun } from "@/server/assistantRuns";
import { rejectCrossSite } from "@/server/sameOrigin";
import { AssistantError } from "@/server/services/assistantService";
import { findProofreadRun, markProofreadCancelled } from "@/server/services/proofreadService";

export const dynamic = "force-dynamic";

const body = z.object({ runId: z.string().min(1).max(100) });

export async function POST(request: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const { projectId } = await ctx.params;

  let parsed;
  try {
    parsed = body.safeParse(await request.json());
  } catch {
    parsed = null;
  }
  if (!parsed?.success) return Response.json({ error: { code: "INVALID_REQUEST", message: "Missing run ID." } }, { status: 400 });

  const db = getDb();
  try {
    const run = await findProofreadRun(db, projectId, parsed.data.runId);
    if (cancelRun(run.id)) return Response.json({ cancelled: true });
    return Response.json({ cancelled: await markProofreadCancelled(db, run.id) });
  } catch (error) {
    if (error instanceof AssistantError) return Response.json({ error: { code: error.code, message: error.message } }, { status: 404 });
    throw error;
  }
}
