import { z } from "zod";
import { getDb } from "@/server/db";
import { getAssistantConfig } from "@/server/assistantConfig";
import { finishRun, registerRun } from "@/server/assistantRuns";
import { createOpenAIProvider } from "@/server/openai/openaiProvider";
import { rejectCrossSite } from "@/server/sameOrigin";
import { AssistantError, type AssistantErrorCode } from "@/server/services/assistantService";
import { prepareChapterAnalysis, runChapterAnalysis } from "@/server/services/chapterAnalysisService";

export const dynamic = "force-dynamic";

const body = z.object({
  chapterRecordId: z.string().min(1).max(100),
  pinnedRevision: z.number().int().min(1),
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

function errorResponse(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
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
  if (!parsed.success) return errorResponse("INVALID_REQUEST", "Choose a chapter and a revision.", 400);

  const config = getAssistantConfig();
  const runtime = { configured: config.status.configured, model: config.status.model, limits: config.status.limits };

  let prep;
  try {
    prep = await prepareChapterAnalysis(getDb(), runtime, { projectId, ...parsed.data });
  } catch (error) {
    const assistant =
      error instanceof AssistantError
        ? error
        : error instanceof Error && error.name === "AssistantError" && "code" in error
          ? (error as AssistantError)
          : null;
    if (assistant && assistant.code in HTTP_STATUS) {
      return errorResponse(assistant.code, assistant.message, HTTP_STATUS[assistant.code as AssistantErrorCode]);
    }
    if (error instanceof Error && error.name === "MutationRejectedError") {
      return errorResponse("INVALID_REQUEST", error.message, 400);
    }
    const detail = error instanceof Error ? error.name : "unknown error";
    console.error("[chapter-analysis] could not prepare a request:", detail);
    return errorResponse("SERVER_ERROR", "The request could not be prepared.", 500);
  }

  const provider = createOpenAIProvider(config.apiKey ?? "");
  const run = registerRun(prep.runId);
  const signal = AbortSignal.any([run.signal, request.signal]);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: object) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // browser gone
        }
      };
      send({ type: "started", runId: prep.runId, requestChars: prep.requestChars });
      try {
        const result = await runChapterAnalysis(getDb(), provider, prep, signal);
        if (result.status === "failed") console.warn(`[chapter-analysis] run ${prep.runId} failed: ${result.errorCode}`);
        send({ type: "done", result });
      } catch (error) {
        console.error("[chapter-analysis] could not store a run:", error instanceof Error ? error.name : "unknown error");
        send({ type: "error", message: "The chapter analysis could not be saved." });
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
    },
  });
}
