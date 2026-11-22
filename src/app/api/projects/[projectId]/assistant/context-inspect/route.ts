import { z } from "zod";
import { getDb } from "@/server/db";
import { getAssistantConfig } from "@/server/assistantConfig";
import { rejectCrossSite } from "@/server/sameOrigin";
import { AssistantError, type AssistantErrorCode } from "@/server/services/assistantService";
import {
  inspectProofreadContext,
  inspectSelectionAssistContext,
} from "@/server/services/assistantContextInspect";
import { SELECTION_ASSIST_ACTIONS } from "@/selectionAssist/output";

export const dynamic = "force-dynamic";

const body = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("proofread"),
    recordId: z.string().min(1).max(100),
    revision: z.number().int().min(1),
    range: z.object({ start: z.number().int().min(0), end: z.number().int().min(1) }).nullable().optional(),
    excludeDictionaryWords: z.array(z.string().min(1).max(80)).max(200).optional(),
  }),
  z.object({
    kind: z.literal("selection_assist"),
    recordId: z.string().min(1).max(100),
    revision: z.number().int().min(1),
    range: z.object({ start: z.number().int().min(0), end: z.number().int().min(1) }),
    action: z.enum(SELECTION_ASSIST_ACTIONS),
    scopeDraftId: z.string().max(100),
    excludeRecordIds: z.array(z.string().min(1).max(100)).max(100).optional(),
    authorInstructionText: z.string().max(4000).nullable().optional(),
    promptPresetId: z.string().min(1).max(100).nullable().optional(),
  }),
]);

const HTTP_STATUS: Record<AssistantErrorCode, number> = {
  NOT_CONFIGURED: 503,
  NOT_FOUND: 404,
  INVALID_REQUEST: 400,
  STALE_SELECTION: 409,
  TOO_LARGE: 413,
  BUSY: 409,
  RATE_LIMITED: 429,
  USAGE_CAP: 429,
};

export async function POST(request: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const { projectId } = await ctx.params;

  let parsed;
  try {
    parsed = body.safeParse(await request.json());
  } catch {
    return Response.json({ error: { code: "INVALID_REQUEST", message: "The request was not valid JSON." } }, { status: 400 });
  }
  if (!parsed.success) {
    return Response.json({ error: { code: "INVALID_REQUEST", message: "The request was not in the expected shape." } }, { status: 400 });
  }

  const config = getAssistantConfig();
  const runtime = { configured: config.status.configured, model: config.status.model, limits: config.status.limits };

  try {
    const report =
      parsed.data.kind === "proofread"
        ? await inspectProofreadContext(getDb(), runtime, { projectId, ...parsed.data })
        : await inspectSelectionAssistContext(getDb(), runtime, { projectId, ...parsed.data });
    return Response.json({ report }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AssistantError) {
      return Response.json(
        { error: { code: error.code, message: error.message, ...(error.size ? { size: error.size } : {}) } },
        { status: HTTP_STATUS[error.code] },
      );
    }
    console.error("[context-inspect] failed:", error instanceof Error ? error.name : "unknown");
    return Response.json({ error: { code: "SERVER_ERROR", message: "The payload could not be inspected." } }, { status: 500 });
  }
}
