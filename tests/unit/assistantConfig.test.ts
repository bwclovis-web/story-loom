import type OpenAI from "openai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LIMIT_SPECS, readAssistantConfig } from "@/assistant/config";
import { defaultClient } from "@/server/openai/openaiProvider";
import { rejectCrossSite } from "@/server/sameOrigin";

const KEY = "sk-test-not-a-real-key-000000";

describe("assistant configuration", () => {
  it("is not configured without a key or model, and keeps the app usable", () => {
    const config = readAssistantConfig({});
    expect(config.status.configured).toBe(false);
    expect(config.apiKey).toBeNull();
    expect(config.status.problems).toEqual(
      expect.arrayContaining([expect.stringContaining("WORDLY_OPENAI_API_KEY"), expect.stringContaining("OPENAI_MODEL")]),
    );
    expect(config.status.limits.maxInputChars).toBe(LIMIT_SPECS.maxInputChars.defaultValue);
  });

  it("needs a model even with a key; no model is assumed", () => {
    const config = readAssistantConfig({ WORDLY_OPENAI_API_KEY: KEY });
    expect(config.status.configured).toBe(false);
    expect(config.status.model).toBeNull();
    expect(config.apiKey).toBeNull();
  });

  it("is configured with a key and a model, and the status never carries the key", () => {
    const config = readAssistantConfig({ WORDLY_OPENAI_API_KEY: KEY, OPENAI_MODEL: "example-model-1", ASSISTANT_MAX_INPUT_CHARS: "20000" });
    expect(config.status.configured).toBe(true);
    expect(config.status.model).toBe("example-model-1");
    expect(config.status.limits.maxInputChars).toBe(20000);
    expect(config.apiKey).toBe(KEY);
    expect(JSON.stringify(config.status)).not.toContain(KEY);
  });

  it("rejects out-of-range limits instead of guessing", () => {
    const config = readAssistantConfig({ WORDLY_OPENAI_API_KEY: KEY, OPENAI_MODEL: "m", ASSISTANT_MONTHLY_TOKEN_CAP: "-5" });
    expect(config.status.configured).toBe(false);
    expect(config.status.problems.join(" ")).toContain("ASSISTANT_MONTHLY_TOKEN_CAP");
  });

  it("refuses to run when a key is exposed through NEXT_PUBLIC_", () => {
    const config = readAssistantConfig({ WORDLY_OPENAI_API_KEY: KEY, OPENAI_MODEL: "m", NEXT_PUBLIC_OPENAI_API_KEY: KEY });
    expect(config.status.configured).toBe(false);
    expect(config.apiKey).toBeNull();
    expect(config.status.problems.join(" ")).toContain("NEXT_PUBLIC_OPENAI_API_KEY");
    expect(config.status.problems.join(" ")).not.toContain(KEY);
  });

  it("never uses the shared OPENAI_API_KEY, and says why the assistant is off", () => {
    const config = readAssistantConfig({ OPENAI_API_KEY: KEY, OPENAI_MODEL: "m" });
    expect(config.status.configured).toBe(false);
    expect(config.apiKey).toBeNull();
    const text = config.status.problems.join(" ");
    expect(text).toContain("WORDLY_OPENAI_API_KEY is not set");
    expect(text).toContain("shared with other apps");
    expect(text).not.toContain(KEY);
  });

  it("uses its own key when both are set", () => {
    const config = readAssistantConfig({ OPENAI_API_KEY: "sk-shared-other-app", WORDLY_OPENAI_API_KEY: KEY, OPENAI_MODEL: "m" });
    expect(config.status.configured).toBe(true);
    expect(config.apiKey).toBe(KEY);
  });

  it("stays off while OPENAI_CUSTOM_HEADERS would be added to requests", () => {
    const config = readAssistantConfig({ WORDLY_OPENAI_API_KEY: KEY, OPENAI_MODEL: "m", OPENAI_CUSTOM_HEADERS: "X-Other: 1" });
    expect(config.status.configured).toBe(false);
    expect(config.status.problems.join(" ")).toContain("OPENAI_CUSTOM_HEADERS");
  });
});

describe("OpenAI client settings", () => {
  const SHARED = {
    OPENAI_API_KEY: "sk-shared-other-app",
    OPENAI_BASE_URL: "https://proxy.other-app.example/v1",
    OPENAI_ORG_ID: "org-other-app",
    OPENAI_PROJECT_ID: "proj-other-app",
    OPENAI_ADMIN_KEY: "admin-other-app",
  };
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const [k, v] of Object.entries(SHARED)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
  });
  afterEach(() => {
    for (const k of Object.keys(SHARED)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("ignores every shared OPENAI_* setting", () => {
    const client = defaultClient(KEY) as unknown as OpenAI;
    expect(client.apiKey).toBe(KEY);
    expect(client.baseURL).toBe("https://api.openai.com/v1");
    expect(client.organization).toBeNull();
    expect(client.project).toBeNull();
    expect(client.adminAPIKey).toBeNull();
  });
});

describe("cross-site guard for assistant routes", () => {
  const req = (headers: Record<string, string>) =>
    new Request("http://127.0.0.1:3000/api/x", { method: "POST", headers: { host: "127.0.0.1:3000", ...headers } });

  it("allows same-origin JSON requests", () => {
    expect(rejectCrossSite(req({ "content-type": "application/json", origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin" }))).toBeNull();
  });

  it("refuses other sites and non-JSON bodies", () => {
    expect(rejectCrossSite(req({ "content-type": "application/json", "sec-fetch-site": "cross-site" }))?.status).toBe(403);
    expect(rejectCrossSite(req({ "content-type": "application/json", origin: "https://evil.example" }))?.status).toBe(403);
    expect(rejectCrossSite(req({ "content-type": "text/plain" }))?.status).toBe(415);
  });
});
