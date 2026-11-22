import "server-only";
import OpenAI from "openai";
import { API_KEY_ENV, MODEL_ENV, readAssistantConfig } from "@/assistant/config";
import { resolveAssistantEnv } from "./assistantSecrets";
import { toProviderError } from "./openai/openaiProvider";

export type ConnectionTestResult =
  | { ok: true; model: string; outputPreview: string }
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
      baseURL: "https://api.openai.com/v1",
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
    };
  } catch (error) {
    const mapped = toProviderError(error, signal);
    if (mapped.code === "auth") {
      return { ok: false, message: "OpenAI rejected the API key (401). Check the key on Settings and try again." };
    }
    if (mapped.code === "not_found") {
      return {
        ok: false,
        message: "OpenAI did not accept that model ID. Choose a Responses API text model your project can use.",
      };
    }
    if (mapped.code === "cancelled") {
      return { ok: false, message: "The test timed out. Check your network and try again." };
    }
    return { ok: false, message: "The connection test failed. Check the key, model, and network, then try again." };
  }
}
