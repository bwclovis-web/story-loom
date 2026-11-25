import "server-only";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  API_KEY_ENVS,
  ASSISTANT_PROVIDERS,
  BASE_URL_ENV,
  MODEL_ENV,
  PROVIDER_ENV,
  type AssistantProviderId,
  apiKeyEnvForProvider,
  parseAssistantProvider,
} from "@/assistant/config";
import { parseJsonObject } from "@/domain/json";
import {
  desktopAssistantBridgePath,
  desktopInjectedApiKey,
  desktopPrecedenceActive,
  loadDesktopAssistantBridge,
} from "./desktopAssistantBridge";

/*
 * Author-owned assistant credentials saved from Settings. Never returned to
 * the browser. Precedence (highest first):
 *   1. Desktop OS keychain / safeStorage (injected as env by Electron)
 *   2. local/assistant-secrets.json (Settings on web or model/baseUrl on desktop)
 *   3. .env WORDLY_* only
 * Shared OPENAI_API_KEY is still ignored by readAssistantConfig.
 */

export type AssistantProviderKeys = Partial<Record<AssistantProviderId, string | null>>;

export interface AssistantSecrets {
  provider: AssistantProviderId | null;
  keys: AssistantProviderKeys;
  model: string | null;
  baseUrl: string | null;
}

export type AssistantKeySource = "desktop-keychain" | "settings-file" | "env" | "none";

type Env = Record<string, string | undefined>;

function emptySecrets(): AssistantSecrets {
  return { provider: null, keys: {}, model: null, baseUrl: null };
}

function parseProviderKeys(parsed: Record<string, unknown>): AssistantProviderKeys {
  const keys: AssistantProviderKeys = {};
  const raw = parsed.keys;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const id of ASSISTANT_PROVIDERS) {
      const value = (raw as Record<string, unknown>)[id];
      if (typeof value === "string" && value.trim()) keys[id] = value.trim();
    }
  }
  if (typeof parsed.apiKey === "string" && parsed.apiKey.trim()) {
    keys.openai = keys.openai ?? parsed.apiKey.trim();
  }
  return keys;
}

export function assistantSecretsPath(): string {
  const override = process.env.WORDLY_SECRETS_FILE?.trim();
  if (override) return path.resolve(/*turbopackIgnore: true*/ override);
  return path.join(path.resolve(/*turbopackIgnore: true*/ process.cwd(), "local"), "assistant-secrets.json");
}

export function loadAssistantSecretsFromFile(): AssistantSecrets {
  const file = assistantSecretsPath();
  if (!existsSync(/*turbopackIgnore: true*/ file)) return emptySecrets();
  try {
    const parsed = parseJsonObject(readFileSync(/*turbopackIgnore: true*/ file, "utf8"));
    const providerRaw = typeof parsed.provider === "string" ? parsed.provider : null;
    const provider = providerRaw ? parseAssistantProvider(providerRaw, []) : null;
    const model = typeof parsed.model === "string" && parsed.model.trim() ? parsed.model.trim() : null;
    const baseUrl = typeof parsed.baseUrl === "string" && parsed.baseUrl.trim() ? parsed.baseUrl.trim() : null;
    return { provider, keys: parseProviderKeys(parsed), model, baseUrl };
  } catch {
    return emptySecrets();
  }
}

export function activeProvider(secrets: AssistantSecrets, base: Env): AssistantProviderId {
  if (secrets.provider) return secrets.provider;
  return parseAssistantProvider(base[PROVIDER_ENV], []);
}

export function keyForProvider(secrets: AssistantSecrets, provider: AssistantProviderId): string | null {
  const direct = secrets.keys[provider];
  if (direct) return direct;
  if (provider === "openai" || provider === "openai_compatible") {
    return secrets.keys.openai ?? secrets.keys.openai_compatible ?? null;
  }
  return null;
}

/** Merged secrets using desktop > file > empty for each field (env applied in resolveAssistantEnv). */
export function loadAssistantSecrets(): AssistantSecrets {
  const file = loadAssistantSecretsFromFile();
  const provider = activeProvider(file, process.env);
  const keys = { ...file.keys };
  const desktopKey = desktopInjectedApiKey();
  if (desktopKey) {
    keys.openai = desktopKey;
  }
  const bridge = loadDesktopAssistantBridge();
  const model = (bridge?.model ?? file.model) || file.model;
  return { provider: file.provider, keys, model, baseUrl: file.baseUrl };
}

export function saveAssistantSecrets(next: AssistantSecrets): AssistantSecrets {
  const file = assistantSecretsPath();
  mkdirSync(path.dirname(file), { recursive: true });
  const provider = next.provider ?? activeProvider(next, process.env);
  const incoming = next.keys ?? {};
  const keys: Record<string, string | null> = {};
  for (const id of ASSISTANT_PROVIDERS) {
    let value = incoming[id] ?? null;
    if (desktopPrecedenceActive() && id === "openai" && provider === "openai") {
      value = null;
    }
    if (value) keys[id] = value;
  }
  const payload = {
    provider: next.provider,
    keys,
    model: next.model,
    baseUrl: next.baseUrl,
  };
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return next;
}

export function assistantKeySource(): AssistantKeySource {
  const provider = activeProvider(loadAssistantSecretsFromFile(), process.env);
  if (desktopInjectedApiKey() && loadDesktopAssistantBridge()?.keySource && provider === "openai") {
    return "desktop-keychain";
  }
  if (keyForProvider(loadAssistantSecretsFromFile(), provider)) return "settings-file";
  const keyEnv = apiKeyEnvForProvider(provider);
  if (process.env[keyEnv]?.trim()) return "env";
  return "none";
}

/** Status for Settings UI. Never includes the key. */
export function assistantSecretsStatus(secrets: AssistantSecrets = loadAssistantSecrets()): {
  provider: AssistantProviderId;
  keySaved: boolean;
  model: string | null;
  baseUrl: string | null;
  secretsPath: string;
  keySource: AssistantKeySource;
  desktopBridgePath: string;
  precedenceNote: string;
} {
  const bridge = loadDesktopAssistantBridge();
  const provider = activeProvider(secrets, process.env);
  return {
    provider,
    keySaved: Boolean(keyForProvider(secrets, provider) || desktopInjectedApiKey()),
    model: secrets.model,
    baseUrl: secrets.baseUrl,
    secretsPath: assistantSecretsPath(),
    keySource: assistantKeySource(),
    desktopBridgePath: desktopAssistantBridgePath(),
    precedenceNote: bridge?.precedenceNote ?? "desktop encrypted > assistant-secrets.json > .env WORDLY_* only",
  };
}

/**
 * Merge Settings secrets over a base env (.env / process.env). Desktop injection
 * and Settings file win only when a value is present; clearing Settings falls back.
 */
export function resolveAssistantEnv(base: Env = process.env): Env {
  const secrets = loadAssistantSecrets();
  const env: Env = { ...base };
  const provider = activeProvider(secrets, base);
  env[PROVIDER_ENV] = provider;
  const keyEnv = API_KEY_ENVS[provider];
  const savedKey = keyForProvider(secrets, provider);
  if (savedKey) env[keyEnv] = savedKey;
  else if (provider === "openai" && desktopInjectedApiKey()) env[keyEnv] = desktopInjectedApiKey()!;
  if (secrets.model) env[MODEL_ENV] = secrets.model;
  if (secrets.baseUrl) env[BASE_URL_ENV] = secrets.baseUrl;
  return env;
}