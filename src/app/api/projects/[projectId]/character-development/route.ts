import { z } from "zod";
import { getDb } from "@/server/db";
import { getAssistantConfig } from "@/server/assistantConfig";
import { createOpenAIProvider } from "@/server/openai/openaiProvider";
import { rejectCrossSite } from "@/server/sameOrigin";
import { AssistantError, type AssistantErrorCode } from "@/server/services/assistantService";
import {
  proposeCharacterProfile,
  reviewCharacterConsistency,
  loadCharacterDevelopment,
} from "@/server/services/characterDevelopmentService";

export const dynamic = "force-dynamic";

const body = z.object({
  mode: z.enum(["extract", "review"]),
  recordId: z.string().min(1).max(100),
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

/**
 * Read-only character suggestions. The route never writes a dossier,
 * a revision, or manuscript prose. The author accepts suggestions in the
 * dossier form, which saves through the normal record update.
 */
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
  if (!config.status.configured || !config.apiKey || !config.status.model) {
    return errorResponse("NOT_CONFIGURED", "Add an assistant key on Settings before asking for character suggestions.", 503);
  }

  try {
    const loaded = await loadCharacterDevelopment(getDb(), projectId, parsed.data.recordId);
    if (loaded.record.projectId !== projectId) {
      return errorResponse("INVALID_REQUEST", "Edit this character from the book that holds the dossier.", 400);
    }
    const provider = createOpenAIProvider(config.apiKey);
    const runtime = { ...config.status, model: config.status.model };
    const signal = request.signal;
    if (parsed.data.mode === "extract") {
      const suggestions = await proposeCharacterProfile(
        provider,
        runtime,
        { title: loaded.record.title, body: loaded.record.body, profile: loaded.profile },
        signal,
      );
      return Response.json({ suggestions });
    }
    const passages = loaded.profile.arcs.flatMap((arc) =>
      arc.milestones
        .filter((milestone) => milestone.passageExcerpt)
        .map((milestone) => ({ label: `${arc.title}: ${milestone.title}`, excerpt: milestone.passageExcerpt })),
    );
    const observations = await reviewCharacterConsistency(
      provider,
      runtime,
      { title: loaded.record.title, body: loaded.record.body, profile: loaded.profile, passages },
      signal,
    );
    return Response.json({ observations });
  } catch (error) {
    if (error instanceof AssistantError) return errorResponse(error.code, error.message, HTTP_STATUS[error.code]);
    console.error("[character-development] suggestion failed:", error instanceof Error ? error.name : "unknown error");
    return errorResponse("SERVER_ERROR", "The suggestion could not be prepared. Nothing was saved.", 500);
  }
}
