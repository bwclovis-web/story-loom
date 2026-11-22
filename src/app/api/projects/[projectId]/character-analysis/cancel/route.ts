import { z } from "zod";
import { getDb } from "@/server/db";
import { cancelRun } from "@/server/assistantRuns";
import { rejectCrossSite } from "@/server/sameOrigin";

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
  const run = await db.characterAnalysisRun.findFirst({
    where: { id: parsed.data.runId, projectId },
    select: { id: true, status: true },
  });
  if (!run) return Response.json({ error: { code: "NOT_FOUND", message: "That analysis is not in this project." } }, { status: 404 });

  if (cancelRun(run.id)) return Response.json({ cancelled: true });
  if (run.status === "running" || run.status === "preparing") {
    await db.characterAnalysisRun.update({
      where: { id: run.id },
      data: {
        status: "cancelled",
        errorCode: "cancelled",
        errorMessage: "Cancelled. Completed segments are kept so you can resume.",
        completedAt: new Date(),
      },
    });
    return Response.json({ cancelled: true });
  }
  return Response.json({ cancelled: false });
}
