import "server-only";
import { readAssistantConfig, type AssistantConfig } from "@/assistant/config";

/** Reads OPENAI_* and ASSISTANT_* from the server environment on each call, so a restart picks up .env changes. */
export function getAssistantConfig(): AssistantConfig {
  return readAssistantConfig(process.env);
}
