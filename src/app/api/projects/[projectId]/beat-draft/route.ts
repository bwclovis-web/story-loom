import { z } from "zod";
import { getDb } from "@/server/db";
import { getAssistantConfig } from "@/server/assistantConfig";
import { createAssistantProviderFromConfig } from "@/server/assistantProviderFactory";
import { finishRun, registerRun } from "@/server/assistantRuns";
import { rejectCrossSite } from "@/server/sameOrigin";
import { encodeSse, sseResponseHeaders } from "@/server/sseResponse";
import { AssistantError, type AssistantErrorCode } from "@/server/services/assistantService";
import { prepareBeatDraft, runBeatDraft } from "@/server/services/beatDraftAssistService";

export const dynamic = "force-dynamic";

const body = z.object({
  recordId: z.string().min(1).max(100),
  revision: z.number().int().min(1),
  beatId: z.string().min(1).max(100),
  scopeDraftId: z.string().max(100),
  authorInstructionText: z.string().max(4000).nullable().optional(),
  promptPresetId: z.string().min(1).max(100).nullable().optional(),
});

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

function errorResponse(code: string, message: string, status: number, extra: object = {}) {
  return Response.json({ error: { code, message, ...extra } }, { status });
}

export async function POST(request: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const { projectId } = await ctx.params;

  let parsed;
  try {
    parsed = body.safeParse(await request.json());
  } catch {
    return errorResponse("INVALID_REQUEST", "The request was not valid JSON.", 400);
  }
  if (!parsed.success) return errorResponse("INVALID_REQUEST", "The request was not in the expected shape.", 400);

  const config = getAssistantConfig();
  const runtime = { configured: config.status.configured, model: config.status.model, limits: config.status.limits };

  let prep;
  try {
    prep = await prepareBeatDraft(getDb(), runtime, { projectId, ...parsed.data });
  } catch (error) {
    if (error instanceof AssistantError) {
      return errorResponse(error.code, error.message, HTTP_STATUS[error.code], error.size ? { size: error.size } : {});
    }
    console.error("[beat-draft] prepare failed:", error instanceof Error ? error.name : "unknown");
    return errorResponse("SERVER_ERROR", "The request could not be prepared.", 500);
  }

  const provider = createAssistantProviderFromConfig(config);
  const run = registerRun(prep.runId);
  const signal = AbortSignal.any([run.signal, request.signal]);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encodeSse(event, data));
        } catch {
          // client disconnected
        }
      };
      send("started", { runId: prep.runId });
      try {
        const result = await runBeatDraft(getDb(), provider, prep, signal, (text) => send("delta", { text }));
        send("done", { result });
      } catch (error) {
        console.error("[beat-draft] run failed:", error instanceof Error ? error.name : "unknown");
        send("error", { message: "The result could not be saved." });
      } finally {
        finishRun(prep.runId);
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      run.abort();
    },
  });

  return new Response(stream, { headers: sseResponseHeaders() });
}