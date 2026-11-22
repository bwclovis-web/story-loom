import "server-only";
import OpenAI from "openai";
import { API_KEY_ENV, MODEL_ENV, readAssistantConfig } from "@/assistant/config";
import { resolveAssistantEnv } from "./assistantSecrets";
import { toProviderError } from "./openai/openaiProvider";

export type ConnectionTestResult =
  | { ok: true; model: string; outputPreview: string; baseUrl: string }
  | { ok: false; message: string };

/**
 * One small paid Responses API request. Never logs the key or raw provider bodies.
 * Call only from an explicit author action on Settings.
 */
export async function testAssistantConnection(env = resolveAssistantEnv(process.env)): Promise<ConnectionTestResult> {
  const { status, apiKey } = readAssistantConfig(env);
  if (!status.configured || !apiKey || !status.model) {
    return {
      ok: false,
      message: status.problems[0] ?? `${API_KEY_ENV} and ${MODEL_ENV} must be set before testing.`,
    };
  }

  const signal = AbortSignal.timeout(30_000);
  try {
    const client = new OpenAI({
      apiKey,
      adminAPIKey: null,
      organization: null,
      project: null,
      webhookSecret: null,
      baseURL: status.baseUrl,
      maxRetries: 0,
      logLevel: "off",
    });
    const response = await client.responses.create(
      {
        model: status.model,
        input: "Reply with the single word: connected.",
        max_output_tokens: 16,
        store: false,
        truncation: "disabled",
        stream: false,
      },
      { signal, timeout: 30_000 },
    );
    const text = typeof response.output_text === "string" ? response.output_text.trim() : "";
    return {
      ok: true,
      model: status.model,
      outputPreview: text.slice(0, 80) || "(empty reply)",
      baseUrl: status.baseUrl,
    };
  } catch (error) {
    const mapped = toProviderError(error, signal);
    if (mapped.code === "auth") {
      return {
        ok: false,
        message: status.usingCustomBaseUrl
          ? "The endpoint rejected the API key (401). For a local server with no key, leave the key blank; otherwise check the key on Settings."
          : "OpenAI rejected the API key (401). Check the key on Settings and try again.",
      };
    }
    if (mapped.code === "not_found") {
      return {
        ok: false,
        message: status.usingCustomBaseUrl
          ? "That model ID was not found on the endpoint. Check the model name your local server exposes."
          : "OpenAI did not accept that model ID. Choose a Responses API text model your project can use.",
      };
    }
    if (mapped.code === "connection") {
      return {
        ok: false,
        message: status.usingCustomBaseUrl
          ? `Could not reach ${status.baseUrl}. Start the local server (Ollama, LM Studio, …) and confirm the URL ends with /v1.`
          : "Could not reach OpenAI. Check the internet connection and try again.",
      };
    }
    if (mapped.code === "cancelled") {
      return { ok: false, message: "The test timed out. Check your network and try again." };
    }
    return { ok: false, message: "The connection test failed. Check the key, model, endpoint, and network, then try again." };
  }
}
