import "server-only";
import {
  ProviderError,
  type AssistantProvider,
  type OutputSchema,
  type ProviderEvent,
  type ProviderMessage,
  type ProviderRequest,
  type ProviderRound,
  type StructuredResult,
} from "@/assistant/provider";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const MAX_PARTS = 200;
const MAX_BODY_CHARS = 2_000_000;

function geminiRole(role: ProviderMessage["role"]): "user" | "model" {
  return role === "assistant" ? "model" : "user";
}

function assertRequestLimits(request: ProviderRequest): void {
  if (request.input.length > MAX_PARTS) {
    throw new ProviderError("bad_request", "Too many messages for this request.");
  }
  const chars = request.instructions.length + request.input.reduce((n, m) => n + m.content.length, 0);
  if (chars > MAX_BODY_CHARS) {
    throw new ProviderError("bad_request", "Input exceeds the provider limit.");
  }
}

function buildContents(request: ProviderRequest): unknown[] {
  const contents: unknown[] = [];
  if (request.instructions.trim()) {
    contents.push({ role: "user", parts: [{ text: request.instructions }] });
    contents.push({ role: "model", parts: [{ text: "Understood." }] });
  }
  for (const message of request.input) {
    contents.push({ role: geminiRole(message.role), parts: [{ text: message.content }] });
  }
  return contents;
}

function usageFromBody(body: Record<string, unknown>) {
  const usage = body.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } | undefined;
  if (!usage) return undefined;
  const inputTokens = usage.promptTokenCount ?? 0;
  const outputTokens = usage.candidatesTokenCount ?? 0;
  const totalTokens = usage.totalTokenCount ?? inputTokens + outputTokens;
  return { inputTokens, outputTokens, totalTokens };
}

function readTextFromCandidate(body: Record<string, unknown>): string {
  const candidates = body.candidates as { content?: { parts?: { text?: string }[] } }[] | undefined;
  const first = candidates?.[0]?.content?.parts ?? [];
  return first.map((p) => p.text ?? "").join("");
}

async function postGemini(
  apiKey: string,
  model: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
  timeoutMs: number,
  stream: boolean,
): Promise<Response> {
  const controller = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  const action = stream ? "streamGenerateContent" : "generateContent";
  const streamQuery = stream ? "&alt=sse" : "";
  const url = `${BASE_URL}/models/${encodeURIComponent(model)}:${action}?key=${encodeURIComponent(apiKey)}${streamQuery}`;
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: controller,
  });
}

function toProviderError(error: unknown, response: Response | null, signal: AbortSignal): ProviderError {
  if (error instanceof ProviderError) return error;
  if (signal.aborted) return new ProviderError("cancelled", "The request was cancelled.");
  if (response) {
    const status = response.status;
    if (status === 401 || status === 403) return new ProviderError("auth", "Gemini rejected the API key.", status);
    if (status === 404) return new ProviderError("not_found", "Gemini could not find the model (404).", status);
    if (status === 429) return new ProviderError("rate_limit", "Gemini rate limit reached (429).", status);
    if (status >= 500) return new ProviderError("server", `Gemini server error (${status}).`, status);
    if (status >= 400) return new ProviderError("bad_request", `Gemini refused the request (${status}).`, status);
  }
  if (error instanceof TypeError) return new ProviderError("connection", "Could not reach Gemini.");
  return new ProviderError("provider_failed", "The Gemini request failed unexpectedly.");
}

export function createGeminiProvider(apiKey: string): AssistantProvider {
  return {
    async *stream(request: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
      assertRequestLimits(request);
      const body: Record<string, unknown> = {
        contents: buildContents(request),
        generationConfig: { maxOutputTokens: request.maxOutputTokens },
      };
      let response: Response | null = null;
      try {
        response = await postGemini(apiKey, request.model, body, signal, request.timeoutMs, true);
        if (!response.ok || !response.body) throw toProviderError(null, response, signal);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let usage: ReturnType<typeof usageFromBody>;
        let finishReason: string | undefined;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let lineBreak = buffer.indexOf("\n");
          while (lineBreak >= 0) {
            const line = buffer.slice(0, lineBreak).trim();
            buffer = buffer.slice(lineBreak + 1);
            if (line.startsWith("data:")) {
              const data = line.slice(5).trim();
              if (!data) {
                lineBreak = buffer.indexOf("\n");
                continue;
              }
              let event: Record<string, unknown>;
              try {
                event = JSON.parse(data) as Record<string, unknown>;
              } catch {
                lineBreak = buffer.indexOf("\n");
                continue;
              }
              usage = usageFromBody(event) ?? usage;
              const candidates = event.candidates as { finishReason?: string; content?: { parts?: { text?: string }[] } }[] | undefined;
              const delta = candidates?.[0]?.content?.parts?.[0]?.text;
              if (delta) yield { type: "delta", text: delta };
              finishReason = candidates?.[0]?.finishReason ?? finishReason;
            }
            lineBreak = buffer.indexOf("\n");
          }
        }
        const incomplete = finishReason === "MAX_TOKENS";
        yield {
          type: "done",
          status: incomplete ? "incomplete" : "complete",
          incompleteReason: incomplete ? "max_output_tokens" : undefined,
          usage,
        };
      } catch (error) {
        throw toProviderError(error, response, signal);
      }
    },
    async structured(request: ProviderRequest, schema: OutputSchema, signal: AbortSignal): Promise<StructuredResult> {
      assertRequestLimits(request);
      const body: Record<string, unknown> = {
        contents: buildContents(request),
        generationConfig: {
          maxOutputTokens: request.maxOutputTokens,
          responseMimeType: "application/json",
          responseSchema: schema.schema,
        },
      };
      let response: Response | null = null;
      try {
        response = await postGemini(apiKey, request.model, body, signal, request.timeoutMs, false);
        if (!response.ok) throw toProviderError(null, response, signal);
        const json = (await response.json()) as Record<string, unknown>;
        const meta = { usage: usageFromBody(json) };
        const finish = (json.candidates as { finishReason?: string }[] | undefined)?.[0]?.finishReason;
        if (finish === "MAX_TOKENS") return { ...meta, status: "incomplete", incompleteReason: "max_output_tokens" };
        const text = readTextFromCandidate(json);
        if (!text.trim()) throw new ProviderError("provider_failed", "The response contained no output.");
        return { ...meta, status: "complete", text };
      } catch (error) {
        throw toProviderError(error, response, signal);
      }
    },
    async complete(request: ProviderRequest, signal: AbortSignal): Promise<ProviderRound> {
      assertRequestLimits(request);
      const body: Record<string, unknown> = {
        contents: buildContents(request),
        generationConfig: { maxOutputTokens: request.maxOutputTokens },
      };
      let response: Response | null = null;
      try {
        response = await postGemini(apiKey, request.model, body, signal, request.timeoutMs, false);
        if (!response.ok) throw toProviderError(null, response, signal);
        const json = (await response.json()) as Record<string, unknown>;
        const meta = { usage: usageFromBody(json) };
        const finish = (json.candidates as { finishReason?: string }[] | undefined)?.[0]?.finishReason;
        const text = readTextFromCandidate(json);
        if (finish === "MAX_TOKENS") {
          return { kind: "message", text, status: "incomplete", incompleteReason: "max_output_tokens", ...meta };
        }
        return { kind: "message", text, status: "complete", ...meta };
      } catch (error) {
        throw toProviderError(error, response, signal);
      }
    },
  };
}