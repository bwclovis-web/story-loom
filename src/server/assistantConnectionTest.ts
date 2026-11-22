import "server-only";
import OpenAI from "openai";
import { MODEL_ENV, apiKeyEnvForProvider, readAssistantConfig } from "@/assistant/config";
import type { AssistantConfig } from "@/assistant/config";
import { resolveAssistantEnv } from "./assistantSecrets";
import { createAssistantProviderFromConfig } from "./assistantProviderFactory";
import { toProviderError } from "./openai/openaiProvider";

export type ConnectionTestResult =
  | { ok: true; provider: string; model: string; outputPreview: string; baseUrl: string }
  | { ok: false; message: string };

async function testOpenAiFamily(config: AssistantConfig, signal: AbortSignal): Promise<string> {
  const client = new OpenAI({
    apiKey: config.apiKey ?? "local-no-key",
    adminAPIKey: null,
    organization: null,
    project: null,
    webhookSecret: null,
    baseURL: config.status.baseUrl,
    maxRetries: 0,
    logLevel: "off",
  });
  const response = await client.responses.create(
    {
      model: config.status.model!,
      input: "Reply with the single word: connected.",
      max_output_tokens: 16,
      store: false,
      truncation: "disabled",
      stream: false,
    },
    { signal, timeout: 30_000 },
  );
  return typeof response.output_text === "string" ? response.output_text.trim() : "";
}

async function testViaProvider(config: AssistantConfig, signal: AbortSignal): Promise<string> {
  const provider = createAssistantProviderFromConfig(config);
  const model = config.status.model!;
  let text = "";
  for await (const event of provider.stream(
    {
      model,
      instructions: "Reply with the single word: connected.",
      input: [],
      maxOutputTokens: 16,
      timeoutMs: 30_000,
    },
    signal,
  )) {
    if (event.type === "delta") text += event.text;
  }
  return text.trim();
}

/**
 * One small paid request. Never logs the key or raw provider bodies.
 * Call only from an explicit author action on Settings.
 */
export async function testAssistantConnection(env = resolveAssistantEnv(process.env)): Promise<ConnectionTestResult> {
  const config = readAssistantConfig(env);
  const { status, apiKey } = config;
  const keyEnv = apiKeyEnvForProvider(status.provider);
  if (!status.configured || !apiKey || !status.model) {
    return {
      ok: false,
      message: status.problems[0] ?? `${keyEnv} and ${MODEL_ENV} must be set before testing.`,
    };
  }

  const signal = AbortSignal.timeout(30_000);
  try {
    const usesOpenAiSdk = status.provider === "openai" || status.provider === "openai_compatible";
    const text = usesOpenAiSdk ? await testOpenAiFamily(config, signal) : await testViaProvider(config, signal);
    return {
      ok: true,
      provider: status.provider,
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
          : "The provider rejected the API key (401). Check the key on Settings and try again.",
      };
    }
    if (mapped.code === "not_found") {
      return {
        ok: false,
        message: status.usingCustomBaseUrl
          ? "That model ID was not found on the endpoint. Check the model name your local server exposes."
          : "The provider did not accept that model ID. Choose a model your account can use.",
      };
    }
    if (mapped.code === "connection") {
      return {
        ok: false,
        message: status.usingCustomBaseUrl
          ? `Could not reach ${status.baseUrl}. Start the local server (Ollama, LM Studio, …) and confirm the URL ends with /v1.`
          : "Could not reach the provider. Check the internet connection and try again.",
      };
    }
    if (mapped.code === "cancelled") {
      return { ok: false, message: "The test timed out. Check your network and try again." };
    }
    return { ok: false, message: "The connection test failed. Check the key, model, endpoint, and network, then try again." };
  }
}