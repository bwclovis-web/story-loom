import { z } from "zod";
import { CHARACTER_ANALYSIS_ACTIONS, CHARACTER_ANALYSIS_SCOPE_KINDS } from "@/domain/characterAnalysis";
import { getDb } from "@/server/db";
import { getAssistantConfig } from "@/server/assistantConfig";
import { finishRun, registerRun } from "@/server/assistantRuns";
import { createAssistantProviderFromConfig } from "@/server/assistantProviderFactory";
import { rejectCrossSite } from "@/server/sameOrigin";
import { AssistantError, type AssistantErrorCode } from "@/server/services/assistantService";
import {
  getCharacterAnalysis,
  listCharacterAnalyses,
  prepareCharacterAnalysis,
  previewCharacterAnalysis,
  runCharacterAnalysis,
} from "@/server/services/characterAnalysisService";

export const dynamic = "force-dynamic";

const scopeSpec = z
  .object({
    sceneRecordId: z.string().min(1).max(100).nullable().optional(),
    chapterRecordId: z.string().min(1).max(100).nullable().optional(),
    chapterFromId: z.string().min(1).max(100).nullable().optional(),
    chapterToId: z.string().min(1).max(100).nullable().optional(),
    bookProjectIds: z.array(z.string().min(1).max(100)).max(50).optional(),
    draftId: z.string().min(1).max(100).nullable().optional(),
    narrativePoint: z
      .object({
        bookProjectId: z.string().min(1).max(100),
        storyEventId: z.string().min(1).max(100).nullable().optional(),
        chapterRecordId: z.string().min(1).max(100).nullable().optional(),
        sceneRecordId: z.string().min(1).max(100).nullable().optional(),
        sequence: z.number().int().nullable().optional(),
      })
      .nullable()
      .optional(),
  })
  .default({});

const body = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("preview"),
    characterRecordIds: z.array(z.string().min(1).max(100)).min(1).max(20),
    scopeKind: z.enum(CHARACTER_ANALYSIS_SCOPE_KINDS),
    scopeSpec: scopeSpec.optional(),
    actions: z.array(z.enum(CHARACTER_ANALYSIS_ACTIONS)).min(1).max(CHARACTER_ANALYSIS_ACTIONS.length).optional(),
  }),
  z.object({
    kind: z.literal("start"),
    characterRecordIds: z.array(z.string().min(1).max(100)).min(1).max(20),
    scopeKind: z.enum(CHARACTER_ANALYSIS_SCOPE_KINDS),
    scopeSpec: scopeSpec.optional(),
    actions: z.array(z.enum(CHARACTER_ANALYSIS_ACTIONS)).min(1).max(CHARACTER_ANALYSIS_ACTIONS.length).optional(),
    sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  z.object({
    kind: z.literal("resume"),
    runId: z.string().min(1).max(100),
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

function errorResponse(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

export async function GET(request: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const { projectId } = await ctx.params;
  const url = new URL(request.url);
  const runId = url.searchParams.get("runId");
  try {
    if (runId) {
      const run = await getCharacterAnalysis(getDb(), projectId, runId);
      return Response.json({ run });
    }
    const runs = await listCharacterAnalyses(getDb(), projectId);
    return Response.json({ runs });
  } catch (error) {
    if (error instanceof AssistantError) return errorResponse(error.code, error.message, HTTP_STATUS[error.code]);
    if (error instanceof Error && error.name === "NotFoundError") return errorResponse("NOT_FOUND", error.message, 404);
    return errorResponse("SERVER_ERROR", "The analysis list could not be loaded.", 500);
  }
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

  if (parsed.data.kind === "preview") {
    try {
      const preview = await previewCharacterAnalysis(getDb(), runtime, {
        projectId,
        characterRecordIds: parsed.data.characterRecordIds,
        scopeKind: parsed.data.scopeKind,
        scopeSpec: parsed.data.scopeSpec,
        actions: parsed.data.actions,
      });
      return Response.json({ preview });
    } catch (error) {
      if (error instanceof AssistantError) return errorResponse(error.code, error.message, HTTP_STATUS[error.code]);
      console.error("[character-analysis] preview failed:", error instanceof Error ? error.name : "unknown error");
      return errorResponse("SERVER_ERROR", "The preview could not be prepared.", 500);
    }
  }

  let prep;
  try {
    if (parsed.data.kind === "resume") {
      const existing = await getCharacterAnalysis(getDb(), projectId, parsed.data.runId);
      prep = await prepareCharacterAnalysis(getDb(), runtime, {
        projectId,
        characterRecordIds: existing.characterRecordIds,
        scopeKind: existing.scopeKind,
        scopeSpec: existing.scopeSpec,
        actions: existing.actions,
        resumeRunId: parsed.data.runId,
      });
    } else {
      prep = await prepareCharacterAnalysis(getDb(), runtime, {
        projectId,
        characterRecordIds: parsed.data.characterRecordIds,
        scopeKind: parsed.data.scopeKind,
        scopeSpec: parsed.data.scopeSpec,
        actions: parsed.data.actions,
        expectedSourceHash: parsed.data.sourceHash,
      });
    }
  } catch (error) {
    if (error instanceof AssistantError) return errorResponse(error.code, error.message, HTTP_STATUS[error.code]);
    if (error instanceof Error && error.name === "NotFoundError") return errorResponse("NOT_FOUND", error.message, 404);
    console.error("[character-analysis] prepare failed:", error instanceof Error ? error.name : "unknown error");
    return errorResponse("SERVER_ERROR", "The analysis could not be prepared.", 500);
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
          // browser gone
        }
      };
      try {
        await runCharacterAnalysis(getDb(), provider, prep, signal, (event) => send(event));
      } catch (error) {
        console.error("[character-analysis] run failed:", error instanceof Error ? error.name : "unknown error");
        send({ type: "error", message: "The character analysis could not be saved." });
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
