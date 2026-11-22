import { z } from "zod";
import { getDb } from "@/server/db";
import { getAssistantConfig } from "@/server/assistantConfig";
import { finishRun, registerRun } from "@/server/assistantRuns";
import { createAssistantProviderFromConfig } from "@/server/assistantProviderFactory";
import { rejectCrossSite } from "@/server/sameOrigin";
import { AssistantError, type AssistantErrorCode } from "@/server/services/assistantService";
import { prepareProofread, runProofread } from "@/server/services/proofreadService";

export const dynamic = "force-dynamic";

const body = z.object({
  mode: z.literal("proofread"),
  recordId: z.string().min(1).max(100),
  revision: z.number().int().min(1),
  range: z.object({ start: z.number().int().min(0), end: z.number().int().min(1) }).nullable(),
  excludeDictionaryWords: z.array(z.string().min(1).max(80)).max(200).optional(),
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
    const { recordId, revision, range, excludeDictionaryWords } = parsed.data;
    prep = await prepareProofread(getDb(), runtime, { projectId, recordId, revision, range, excludeDictionaryWords });
  } catch (error) {
    if (error instanceof AssistantError) {
      return errorResponse(error.code, error.message, HTTP_STATUS[error.code], error.size ? { size: error.size } : {});
    }
    console.error("[proofread] could not prepare a request:", error instanceof Error ? error.name : "unknown error");
    return errorResponse("SERVER_ERROR", "The request could not be prepared.", 500);
  }

  const provider = createAssistantProviderFromConfig(config);
  const run = registerRun(prep.runId);
  const signal = AbortSignal.any([run.signal, request.signal]);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: object) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The browser went away; the outcome is still stored.
        }
      };
      send({ type: "started", runId: prep.runId });
      try {
        const result = await runProofread(getDb(), provider, prep, signal);
        if (result.status === "failed") console.warn(`[proofread] run ${prep.runId} failed: ${result.errorCode}`);
        send({ type: "done", result });
      } catch (error) {
        console.error("[proofread] could not store a run:", error instanceof Error ? error.name : "unknown error");
        send({ type: "error", message: "The proofreading result could not be saved." });
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

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
