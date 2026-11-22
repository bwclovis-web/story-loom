import { z } from "zod";
import { getDb } from "@/server/db";
import { getAssistantConfig } from "@/server/assistantConfig";
import { finishRun, registerRun } from "@/server/assistantRuns";
import { createAssistantProviderFromConfig } from "@/server/assistantProviderFactory";
import { rejectCrossSite } from "@/server/sameOrigin";
import { runProposalTurn } from "@/server/services/assistantProposalService";
import { AssistantError, prepareTurn, runTurn, type AssistantErrorCode } from "@/server/services/assistantService";

export const dynamic = "force-dynamic";

const passage = z.object({ start: z.number().int().min(0), end: z.number().int().min(1) });
const body = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ask"),
    mode: z.enum(["chat", "proposal"]).default("chat"),
    conversationId: z.string().min(1).max(100),
    question: z.string().max(200_000),
    retrievalScope: z.enum(["chapter", "book", "series"]).optional(),
    enableTools: z.boolean().optional(),
    write: z
      .object({
        recordId: z.string().min(1).max(100),
        draftId: z.string().min(1).max(100).nullable().optional(),
        passage: passage.optional(),
        includeUnsavedProse: z.boolean(),
        unsavedBody: z.string().max(2_000_000).nullable().optional(),
      })
      .nullable()
      .optional(),
    selection: z.object({
      references: z
        .array(
          z.object({
            recordId: z.string().min(1).max(100),
            revision: z.number().int().min(1),
            sections: z.array(z.string().min(1).max(300)).min(1).max(1000).optional(),
          }),
        )
        .max(500),
      manuscript: z
        .object({ recordId: z.string().min(1).max(100), revision: z.number().int().min(1), passage: passage.optional() })
        .nullable(),
      includeMessageIds: z.array(z.string().min(1).max(100)).max(500),
      excludeRecordIds: z.array(z.string().min(1).max(100)).max(500).optional(),
    }),
    authorInstructionText: z.string().max(4000).nullable().optional(),
    promptPresetId: z.string().min(1).max(100).nullable().optional(),
  }),
  z.object({ kind: z.literal("retry"), conversationId: z.string().min(1).max(100), messageId: z.string().min(1).max(100) }),
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

  let turn;
  try {
    turn = await prepareTurn(getDb(), runtime, { ...parsed.data, projectId });
  } catch (error) {
    if (error instanceof AssistantError) {
      return errorResponse(error.code, error.message, HTTP_STATUS[error.code], error.size ? { size: error.size } : {});
    }
    console.error("[assistant] could not prepare a request:", error instanceof Error ? error.name : "unknown error");
    return errorResponse("SERVER_ERROR", "The request could not be prepared.", 500);
  }

  const provider = createAssistantProviderFromConfig(config);
  const run = registerRun(turn.assistantMessageId);
  const signal = AbortSignal.any([run.signal, request.signal]);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: object) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The browser went away; the outcome is still stored below.
        }
      };
      send({
        type: "started",
        mode: turn.mode,
        conversationId: turn.conversationId,
        userMessageId: turn.userMessageId,
        assistantMessageId: turn.assistantMessageId,
      });
      try {
        const result =
          turn.mode === "proposal"
            ? await runProposalTurn(getDb(), provider, turn, signal)
            : await runTurn(getDb(), provider, turn, signal, (text) => send({ type: "delta", text }));
        if (result.status === "failed") console.warn(`[assistant] answer ${turn.assistantMessageId} failed: ${result.errorCode}`);
        send({ type: "done", ...result });
      } catch (error) {
        console.error("[assistant] could not store an answer:", error instanceof Error ? error.name : "unknown error");
        send({ type: "done", status: "failed", errorCode: "storage", errorMessage: "The answer could not be saved." });
      } finally {
        finishRun(turn.assistantMessageId);
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
