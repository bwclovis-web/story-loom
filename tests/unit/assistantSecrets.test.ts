import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { API_KEY_ENV, MODEL_ENV, readAssistantConfig } from "@/assistant/config";

const KEY = "sk-test-settings-key-000000";

describe("assistant secrets from Settings", () => {
  let dir: string;
  let previousSecrets: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "storyloom-secrets-"));
    previousSecrets = process.env.WORDLY_SECRETS_FILE;
    process.env.WORDLY_SECRETS_FILE = path.join(dir, "assistant-secrets.json");
  });

  afterEach(() => {
    if (previousSecrets === undefined) delete process.env.WORDLY_SECRETS_FILE;
    else process.env.WORDLY_SECRETS_FILE = previousSecrets;
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads empty secrets when the file is missing", async () => {
    const { loadAssistantSecrets, resolveAssistantEnv } = await import("@/server/assistantSecrets");
    expect(loadAssistantSecrets()).toEqual({ apiKey: null, model: null, baseUrl: null });
    expect(resolveAssistantEnv({})[API_KEY_ENV]).toBeUndefined();
  });

  it("saves a key without writing it into status objects", async () => {
    const { saveAssistantSecrets, loadAssistantSecrets, assistantSecretsStatus, resolveAssistantEnv } =
      await import("@/server/assistantSecrets");
    saveAssistantSecrets({ apiKey: KEY, model: "example-model-1", baseUrl: null });
    expect(loadAssistantSecrets().apiKey).toBe(KEY);
    const status = assistantSecretsStatus();
    expect(status.keySaved).toBe(true);
    expect(status.model).toBe("example-model-1");
    expect(JSON.stringify(status)).not.toContain(KEY);
    const file = readFileSync(process.env.WORDLY_SECRETS_FILE!, "utf8");
    expect(file).toContain(KEY);

    const env = resolveAssistantEnv({ [MODEL_ENV]: "from-dotenv" });
    expect(env[API_KEY_ENV]).toBe(KEY);
    expect(env[MODEL_ENV]).toBe("example-model-1");
    const config = readAssistantConfig(env);
    expect(config.status.configured).toBe(true);
    expect(JSON.stringify(config.status)).not.toContain(KEY);
  });

  it("lets Settings override .env and falls back when cleared", async () => {
    const { saveAssistantSecrets, resolveAssistantEnv } = await import("@/server/assistantSecrets");
    const base = { [API_KEY_ENV]: "sk-from-dotenv-aaaa", [MODEL_ENV]: "dotenv-model" };
    saveAssistantSecrets({ apiKey: KEY, model: "settings-model", baseUrl: "http://127.0.0.1:11434/v1" });
    expect(resolveAssistantEnv(base)[API_KEY_ENV]).toBe(KEY);
    expect(resolveAssistantEnv(base)[MODEL_ENV]).toBe("settings-model");
    expect(resolveAssistantEnv(base).WORDLY_OPENAI_BASE_URL).toBe("http://127.0.0.1:11434/v1");
    saveAssistantSecrets({ apiKey: null, model: null, baseUrl: null });
    expect(resolveAssistantEnv(base)[API_KEY_ENV]).toBe("sk-from-dotenv-aaaa");
    expect(resolveAssistantEnv(base)[MODEL_ENV]).toBe("dotenv-model");
    expect(resolveAssistantEnv(base).WORDLY_OPENAI_BASE_URL).toBeUndefined();
  });
});
