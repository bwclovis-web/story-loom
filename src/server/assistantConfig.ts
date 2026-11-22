import "server-only";
import { readAssistantConfig, type AssistantConfig } from "@/assistant/config";
import { resolveAssistantEnv } from "./assistantSecrets";

/**
 * Reads assistant settings on each call. Settings secrets (local file) override
 * .env for WORDLY_OPENAI_API_KEY and OPENAI_MODEL when present; clearing
 * Settings falls back to .env without a restart.
 */
export function getAssistantConfig(): AssistantConfig {
  return readAssistantConfig(resolveAssistantEnv(process.env));
}
