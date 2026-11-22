import "server-only";
import type { ProviderMessage } from "@/assistant/prompt";
import {
  ProviderError,
  type AssistantProvider,
  type OutputSchema,
  type ProviderEvent,
  type ProviderRequest,
  type ProviderRound,
  type ProviderToolItem,
  type StructuredResult,
} from "@/assistant/provider";

const ANTHROPIC_VERSION = "2023-06-01";
const BASE_URL = "https://api.anthropic.com/v1";
const MAX_MESSAGES = 200;
const MAX_SYSTEM_CHARS = 500_000;
const MAX_BODY_CHARS = 2_000_000;

function mapRole(role: ProviderMessage["role"]): "user" | "assistant" {
  return role === "assistant" ? "assistant" : "user";
}

function toolBlocks(items: ProviderToolItem[] | undefined): unknown[] {
  if (!items?.length) return [];
  const blocks: unknown[] = [];
  for (const item of items) {
    if (item.type === "function_call") {
      blocks.push({ type: "tool_use", id: item.call_id, name: item.name, input: tryParseJson(item.arguments) });
    } else {
      blocks.push({ type: "tool_result", tool_use_id: item.call_id, content: item.output });
    }
  }
  return blocks;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

function assertRequestLimits(request: ProviderRequest): void {
  if (request.input.length > MAX_MESSAGES) {
    throw new ProviderError("bad_request", "Too many messages for this request.");
  }
  if (request.instructions.length > MAX_SYSTEM_CHARS) {
    throw new ProviderError("bad_request", "Instructions exceed the provider limit.");
  }
  const chars = request.input.reduce((n, m) => n + m.content.length, 0);
  if (chars > MAX_BODY_CHARS) {
    throw new ProviderError("bad_request", "Input exceeds the provider limit.");
  }
}

function buildMessages(request: ProviderRequest): { system: string; messages: unknown[] } {
  const messages: unknown[] = [];
  for (const message of request.input) {
    messages.push({ role: mapRole(message.role), content: [{ type: "text", text: message.content }] });
  }
  const tools = toolBlocks(request.toolItems);
  if (tools.length) {
    const last = messages[messages.length - 1];
    if (last && typeof last === "object" && last !== null && "content" in last) {
      (last as { content: unknown[] }).content.push(...tools);
    }
  }
  return { system: request.instructions, messages };
}

function usageFromBody(body: Record<string, unknown>) {
  const usage = body.usage as { input_tokens?: number; output_tokens?: number } | undefined;
  if (!usage) return undefined;
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}

function readTextBlocks(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let text = "";
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    if ((block as { type?: string }).type === "text" && typeof (block as { text?: string }).text === "string") {
      text += (block as { text: string }).text;
    }
  }
  return text;
}

function readToolCalls(content: unknown) {
  if (!Array.isArray(content)) return [];
  const calls = [];
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    if ((block as { type?: string }).type !== "tool_use") continue;
    const id = (block as { id?: string }).id ?? "";
    const name = (block as { name?: string }).name ?? "";
    const input = (block as { input?: unknown }).input;
    calls.push({ callId: id, name, arguments: JSON.stringify(input ?? {}) });
  }
  return calls;
}

async function postAnthropic(
  apiKey: string,
  path: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<Response> {
  const controller = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  return fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
    signal: controller,
  });
}

function toProviderError(error: unknown, response: Response | null, signal: AbortSignal): ProviderError {
  if (error instanceof ProviderError) return error;
  if (signal.aborted) return new ProviderError("cancelled", "The request was cancelled.");
  if (response) {
    const status = response.status;
    if (status === 401) return new ProviderError("auth", "Anthropic rejected the API key (401).", status);
    if (status === 403) return new ProviderError("permission", "This API key is not allowed to make this request (403).", status);
    if (status === 404) return new ProviderError("not_found", "Anthropic could not find the model (404).", status);
    if (status === 429) return new ProviderError("rate_limit", "Anthropic rate limit reached (429).", status);
    if (status >= 500) return new ProviderError("server", `Anthropic server error (${status}).`, status);
    if (status >= 400) return new ProviderError("bad_request", `Anthropic refused the request (${status}).`, status);
  }
  if (error instanceof TypeError) return new ProviderError("connection", "Could not reach Anthropic.");
  return new ProviderError("provider_failed", "The Anthropic request failed unexpectedly.");
}

export function createAnthropicProvider(apiKey: string): AssistantProvider {
  return {
    async *stream(request: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
      assertRequestLimits(request);
      const { system, messages } = buildMessages(request);
      const body: Record<string, unknown> = {
        model: request.model,
        max_tokens: request.maxOutputTokens,
        system,
        messages,
        stream: true,
      };
      let response: Response | null = null;
      try {
        response = await postAnthropic(apiKey, "/messages", body, signal, request.timeoutMs);
        if (!response.ok || !response.body) throw toProviderError(null, response, signal);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let responseId: string | undefined;
        let usage: ReturnType<typeof usageFromBody>;
        let stopReason: string | undefined;
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
              if (!data || data === "[DONE]") {
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
              const type = event.type;
              if (type === "message_start" && typeof event.message === "object" && event.message) {
                responseId = (event.message as { id?: string }).id;
                usage = usageFromBody(event.message as Record<string, unknown>);
              }
              if (type === "content_block_delta") {
                const delta = event.delta as { type?: string; text?: string } | undefined;
                if (delta?.type === "text_delta" && delta.text) yield { type: "delta", text: delta.text };
              }
              if (type === "message_delta") {
                stopReason = (event.delta as { stop_reason?: string } | undefined)?.stop_reason;
                const deltaUsage = (event.usage as { output_tokens?: number } | undefined) ?? undefined;
                if (deltaUsage && usage) usage = { ...usage, outputTokens: deltaUsage.output_tokens ?? usage.outputTokens, totalTokens: usage.inputTokens + (deltaUsage.output_tokens ?? usage.outputTokens) };
              }
            }
            lineBreak = buffer.indexOf("\n");
          }
        }
        const incomplete = stopReason === "max_tokens";
        yield {
          type: "done",
          status: incomplete ? "incomplete" : "complete",
          incompleteReason: incomplete ? "max_output_tokens" : undefined,
          responseId,
          usage,
        };
      } catch (error) {
        throw toProviderError(error, response, signal);
      }
    },
    async structured(request: ProviderRequest, schema: OutputSchema, signal: AbortSignal): Promise<StructuredResult> {
      assertRequestLimits(request);
      const { system, messages } = buildMessages(request);
      const body: Record<string, unknown> = {
        model: request.model,
        max_tokens: request.maxOutputTokens,
        system: `${system}\n\nReply with JSON only that matches this schema name: ${schema.name}. No markdown fences.`,
        messages,
        response_format: { type: "json_schema", json_schema: { name: schema.name, schema: schema.schema, strict: true } },
      };
      let response: Response | null = null;
      try {
        response = await postAnthropic(apiKey, "/messages", body, signal, request.timeoutMs);
        if (!response.ok) throw toProviderError(null, response, signal);
        const json = (await response.json()) as Record<string, unknown>;
        const meta = { responseId: typeof json.id === "string" ? json.id : undefined, usage: usageFromBody(json) };
        const stop = json.stop_reason;
        if (stop === "max_tokens") return { ...meta, status: "incomplete", incompleteReason: "max_output_tokens" };
        const text = readTextBlocks(json.content);
        if (!text.trim()) throw new ProviderError("provider_failed", "The response contained no output.");
        return { ...meta, status: "complete", text };
      } catch (error) {
        throw toProviderError(error, response, signal);
      }
    },
    async complete(request: ProviderRequest, signal: AbortSignal): Promise<ProviderRound> {
      assertRequestLimits(request);
      const { system, messages } = buildMessages(request);
      const body: Record<string, unknown> = {
        model: request.model,
        max_tokens: request.maxOutputTokens,
        system,
        messages,
      };
      let response: Response | null = null;
      try {
        response = await postAnthropic(apiKey, "/messages", body, signal, request.timeoutMs);
        if (!response.ok) throw toProviderError(null, response, signal);
        const json = (await response.json()) as Record<string, unknown>;
        const meta = { responseId: typeof json.id === "string" ? json.id : undefined, usage: usageFromBody(json) };
        const stop = json.stop_reason;
        const calls = readToolCalls(json.content);
        if (calls.length) return { kind: "tool_calls", calls, ...meta };
        const text = readTextBlocks(json.content);
        if (stop === "max_tokens") {
          return { kind: "message", text, status: "incomplete", incompleteReason: "max_output_tokens", ...meta };
        }
        return { kind: "message", text, status: "complete", ...meta };
      } catch (error) {
        throw toProviderError(error, response, signal);
      }
    },
  };
}