import { z } from "zod";
import { getDb } from "@/server/db";
import { cancelRun } from "@/server/assistantRuns";
import { rejectCrossSite } from "@/server/sameOrigin";

export const dynamic = "force-dynamic";

const body = z.object({ messageId: z.string().min(1).max(100) });

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
  if (!parsed?.success) return Response.json({ error: { code: "INVALID_REQUEST", message: "Missing message ID." } }, { status: 400 });

  const db = getDb();
  const message = await db.assistantMessage.findFirst({
    where: { id: parsed.data.messageId, role: "assistant", conversation: { projectId } },
  });
  if (!message) return Response.json({ error: { code: "NOT_FOUND", message: "That answer is not in this project." } }, { status: 404 });

  if (cancelRun(message.id)) return Response.json({ cancelled: true });
  if (message.status === "streaming") {
    await db.assistantMessage.update({
      where: { id: message.id },
      data: { status: "cancelled", errorCode: "cancelled", errorMessage: "Cancelled. The partial answer is kept.", completedAt: new Date() },
    });
    return Response.json({ cancelled: true });
  }
  return Response.json({ cancelled: false });
}
