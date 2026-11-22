import "server-only";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { API_KEY_ENV, BASE_URL_ENV, MODEL_ENV } from "@/assistant/config";
import { parseJsonObject } from "@/domain/json";

/*
 * Author-owned assistant credentials saved from Settings. Never returned to
 * the browser. Settings values override .env for the same keys when present.
 * Shared OPENAI_API_KEY is still ignored by readAssistantConfig.
 */

export interface AssistantSecrets {
  /** Present only when the author saved a key. Never log or return this. */
  apiKey: string | null;
  /** Model ID from Settings; null when unset so .env can supply it. */
  model: string | null;
  /**
   * OpenAI-compatible base URL from Settings (e.g. http://127.0.0.1:11434/v1).
   * Null when unset so .env / default OpenAI cloud can supply it.
   */
  baseUrl: string | null;
}

type Env = Record<string, string | undefined>;

export function assistantSecretsPath(): string {
  const override = process.env.WORDLY_SECRETS_FILE?.trim();
  if (override) return path.resolve(/*turbopackIgnore: true*/ override);
  return path.join(path.resolve(/*turbopackIgnore: true*/ process.cwd(), "local"), "assistant-secrets.json");
}

function emptySecrets(): AssistantSecrets {
  return { apiKey: null, model: null, baseUrl: null };
}

export function loadAssistantSecrets(): AssistantSecrets {
  const file = assistantSecretsPath();
  if (!existsSync(file)) return emptySecrets();
  try {
    const parsed = parseJsonObject(readFileSync(file, "utf8"));
    const apiKey = typeof parsed.apiKey === "string" && parsed.apiKey.trim() ? parsed.apiKey.trim() : null;
    const model = typeof parsed.model === "string" && parsed.model.trim() ? parsed.model.trim() : null;
    const baseUrl = typeof parsed.baseUrl === "string" && parsed.baseUrl.trim() ? parsed.baseUrl.trim() : null;
    return { apiKey, model, baseUrl };
  } catch {
    return emptySecrets();
  }
}

export function saveAssistantSecrets(next: AssistantSecrets): AssistantSecrets {
  const file = assistantSecretsPath();
  mkdirSync(path.dirname(file), { recursive: true });
  const payload = {
    apiKey: next.apiKey,
    model: next.model,
    baseUrl: next.baseUrl,
  };
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return next;
}

/** Status for Settings UI. Never includes the key. */
export function assistantSecretsStatus(secrets: AssistantSecrets = loadAssistantSecrets()): {
  keySaved: boolean;
  model: string | null;
  baseUrl: string | null;
  secretsPath: string;
} {
  return {
    keySaved: Boolean(secrets.apiKey),
    model: secrets.model,
    baseUrl: secrets.baseUrl,
    secretsPath: assistantSecretsPath(),
  };
}

/**
 * Merge Settings secrets over a base env (.env / process.env). Settings win
 * only when a value is saved there; clearing Settings falls back to .env.
 */
export function resolveAssistantEnv(base: Env = process.env): Env {
  const secrets = loadAssistantSecrets();
  const env: Env = { ...base };
  if (secrets.apiKey) env[API_KEY_ENV] = secrets.apiKey;
  if (secrets.model) env[MODEL_ENV] = secrets.model;
  if (secrets.baseUrl) env[BASE_URL_ENV] = secrets.baseUrl;
  return env;
}
