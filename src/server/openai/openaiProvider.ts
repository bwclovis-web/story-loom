import "server-only";
import OpenAI from "openai";
import type {
  Response as OpenAIResponse,
  ResponseCreateParams,
  ResponseCreateParamsNonStreaming,
  ResponseCreateParamsStreaming,
  ResponseStreamEvent,
} from "openai/resources/responses/responses";
import {
  ProviderError,
  type AssistantProvider,
  type OutputSchema,
  type ProviderEvent,
  type ProviderRequest,
  type ProviderUsage,
  type StructuredResult,
} from "@/assistant/provider";

/*
 * OpenAI Responses API adapter (official `openai` SDK).
 *
 * Request settings, documented in docs/assistant.md:
 * - store: false (no stored response for later retrieval; abuse-monitoring
 *   retention still applies on OpenAI's side).
 * - truncation: "disabled" so an oversized input fails instead of being cut.
 * - No previous_response_id: the app sends the selected history itself.
 * - maxRetries: 0 so a failed request is never repeated without the author.
 * - logLevel: "off" so the SDK never prints request details.
 * - Change proposals use Structured Outputs (text.format json_schema, strict)
 *   without streaming; refusals and incomplete responses are reported, never parsed.
 */

/** Streaming bodies resolve to an event stream, non-streaming bodies to a Response. */
export interface ResponsesClient {
  responses: {
    create(body: ResponseCreateParams, options: { signal: AbortSignal; timeout: number }): PromiseLike<unknown>;
  };
}

export function defaultClient(apiKey: string): ResponsesClient {
  // Every setting is explicit so the library never falls back to OPENAI_* variables shared by other apps.
  return new OpenAI({
    apiKey,
    adminAPIKey: null,
    organization: null,
    project: null,
    webhookSecret: null,
    baseURL: "https://api.openai.com/v1",
    maxRetries: 0,
    logLevel: "off",
  });
}

export function buildCreateParams(request: ProviderRequest): ResponseCreateParamsStreaming {
  return {
    model: request.model,
    instructions: request.instructions,
    input: request.input.map((m) => ({ role: m.role, content: m.content })),
    max_output_tokens: request.maxOutputTokens,
    store: false,
    truncation: "disabled",
    stream: true,
  };
}

export function buildStructuredParams(request: ProviderRequest, schema: OutputSchema): ResponseCreateParamsNonStreaming {
  const { stream: _stream, ...base } = buildCreateParams(request);
  return {
    ...base,
    stream: false,
    text: { format: { type: "json_schema", name: schema.name, schema: schema.schema, strict: true } },
  };
}

function usageOf(r: Pick<OpenAIResponse, "usage">): ProviderUsage | undefined {
  return r.usage
    ? { inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens, totalTokens: r.usage.total_tokens }
    : undefined;
}

export function readStructuredResponse(r: OpenAIResponse): StructuredResult {
  const meta = { responseId: r.id, usage: usageOf(r) };
  if (r.status === "incomplete") {
    return { ...meta, status: "incomplete", incompleteReason: r.incomplete_details?.reason ?? undefined };
  }
  if (r.status !== "completed") {
    throw new ProviderError(
      "provider_failed",
      `The model could not complete the response (${r.status ?? "unknown status"}${r.error ? `, ${r.error.code}` : ""}).`,
    );
  }
  let text = "";
  for (const item of r.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content) {
      if (part.type === "refusal") return { ...meta, status: "refused", refusal: part.refusal };
      if (part.type === "output_text") text += part.text;
    }
  }
  if (!text) throw new ProviderError("provider_failed", "The response contained no output.");
  return { ...meta, status: "complete", text };
}

const KEY_LIKE = /\b(sk|rk|ek)-[A-Za-z0-9_*\-.]{6,}/g;

function redact(text: string): string {
  return text.replace(KEY_LIKE, "[redacted key]").slice(0, 400);
}

export function toProviderError(error: unknown, signal: AbortSignal): ProviderError {
  if (error instanceof ProviderError) return error;
  if (signal.aborted || error instanceof OpenAI.APIUserAbortError) {
    return new ProviderError("cancelled", "The request was cancelled.");
  }
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return new ProviderError("timeout", "OpenAI did not answer in time. Try again, or ask about less material.");
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return new ProviderError("connection", "Could not reach OpenAI. Check the internet connection and try again.");
  }
  if (error instanceof OpenAI.APIError) {
    const status = typeof error.status === "number" ? error.status : undefined;
    const requestId = error.requestID ?? undefined;
    if (error instanceof OpenAI.AuthenticationError) {
      return new ProviderError("auth", "OpenAI rejected the API key (401). Check WORDLY_OPENAI_API_KEY and restart the app.", status, requestId);
    }
    if (error instanceof OpenAI.PermissionDeniedError) {
      return new ProviderError("permission", "This API key is not allowed to make this request (403). Check the key's project and model access.", status, requestId);
    }
    if (error instanceof OpenAI.NotFoundError) {
      return new ProviderError("not_found", "OpenAI could not find the model (404). Check OPENAI_MODEL against the models your project can use.", status, requestId);
    }
    if (error instanceof OpenAI.RateLimitError) {
      return new ProviderError("rate_limit", "OpenAI rate limit or quota reached (429). Wait and retry, or check usage and billing in the OpenAI dashboard.", status, requestId);
    }
    if (error instanceof OpenAI.BadRequestError || error instanceof OpenAI.UnprocessableEntityError) {
      return new ProviderError("bad_request", `OpenAI refused the request (${status}): ${redact(error.message)}`, status, requestId);
    }
    if (status !== undefined && status >= 500) {
      return new ProviderError("server", `OpenAI had a server error (${status}). Try again later.`, status, requestId);
    }
    return new ProviderError("provider_failed", `OpenAI returned an error${status ? ` (${status})` : ""}.`, status, requestId);
  }
  return new ProviderError("provider_failed", "The assistant request failed unexpectedly.");
}

export function createOpenAIProvider(apiKey: string, makeClient: (key: string) => ResponsesClient = defaultClient): AssistantProvider {
  return {
    async *stream(request: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
      try {
        const client = makeClient(apiKey);
        const events = (await client.responses.create(buildCreateParams(request), {
          signal,
          timeout: request.timeoutMs,
        })) as AsyncIterable<ResponseStreamEvent>;
        for await (const event of events) {
          switch (event.type) {
            case "response.output_text.delta":
            case "response.refusal.delta":
              yield { type: "delta", text: event.delta };
              break;
            case "response.completed":
            case "response.incomplete": {
              const r = event.response;
              yield {
                type: "done",
                status: event.type === "response.completed" ? "complete" : "incomplete",
                incompleteReason: r.incomplete_details?.reason ?? undefined,
                responseId: r.id,
                usage: r.usage
                  ? { inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens, totalTokens: r.usage.total_tokens }
                  : undefined,
              };
              return;
            }
            case "response.failed":
              throw new ProviderError(
                "provider_failed",
                `The model could not complete the response${event.response.error ? ` (${event.response.error.code})` : ""}.`,
              );
            case "error":
              throw new ProviderError("provider_failed", `OpenAI reported a streaming error${event.code ? ` (${event.code})` : ""}.`);
          }
        }
        throw new ProviderError("provider_failed", "The response ended before it was complete.");
      } catch (error) {
        throw toProviderError(error, signal);
      }
    },
    async structured(request: ProviderRequest, schema: OutputSchema, signal: AbortSignal): Promise<StructuredResult> {
      try {
        if (signal.aborted) throw new ProviderError("cancelled", "The request was cancelled.");
        const client = makeClient(apiKey);
        const response = (await client.responses.create(buildStructuredParams(request, schema), {
          signal,
          timeout: request.timeoutMs,
        })) as OpenAIResponse;
        return readStructuredResponse(response);
      } catch (error) {
        throw toProviderError(error, signal);
      }
    },
  };
}
