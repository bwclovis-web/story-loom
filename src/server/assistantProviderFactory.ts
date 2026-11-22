import "server-only";
import type { AssistantConfig, AssistantProviderId } from "@/assistant/config";
import type { AssistantProvider } from "@/assistant/provider";
import { createAnthropicProvider } from "./anthropic/anthropicProvider";
import { createGeminiProvider } from "./gemini/geminiProvider";
import { createOpenAIProvider, defaultClient } from "./openai/openaiProvider";

/** Build a provider from `getAssistantConfig()` so every route uses the same provider and endpoint. */
export function createAssistantProviderFromConfig(config: AssistantConfig): AssistantProvider {
  const { status, apiKey } = config;
  if (!status.configured) {
    return createOpenAIProvider(apiKey ?? "local-no-key", defaultClient, status.baseUrl);
  }
  const key = apiKey ?? "local-no-key";
  switch (status.provider) {
    case "anthropic":
      return createAnthropicProvider(key);
    case "gemini":
      return createGeminiProvider(key);
    case "openai_compatible":
    case "openai":
    default:
      return createOpenAIProvider(key, defaultClient, status.baseUrl);
  }
}

export function providerIdFromConfig(config: AssistantConfig): AssistantProviderId {
  return config.status.provider;
}