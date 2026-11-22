import { describe, expect, it } from "vitest";
import { readAssistantConfig } from "@/assistant/config";
import { createAssistantProviderFromConfig } from "@/server/assistantProviderFactory";

const KEY = "sk-test-not-a-real-key-000000";

describe("assistant provider factory", () => {
  it("returns an openai provider for openai config", () => {
    const config = readAssistantConfig({ WORDLY_OPENAI_API_KEY: KEY, OPENAI_MODEL: "gpt-test", WORDLY_ASSISTANT_PROVIDER: "openai" });
    expect(config.status.provider).toBe("openai");
    const provider = createAssistantProviderFromConfig(config);
    expect(typeof provider.stream).toBe("function");
    expect(typeof provider.structured).toBe("function");
    expect(typeof provider.complete).toBe("function");
  });

  it("returns anthropic and gemini providers", () => {
    const anthropic = readAssistantConfig({
      WORDLY_ASSISTANT_PROVIDER: "anthropic",
      WORDLY_ANTHROPIC_API_KEY: KEY,
      OPENAI_MODEL: "claude-test",
    });
    expect(anthropic.status.configured).toBe(true);
    expect(createAssistantProviderFromConfig(anthropic).complete).toBeDefined();

    const gemini = readAssistantConfig({
      WORDLY_ASSISTANT_PROVIDER: "gemini",
      WORDLY_GEMINI_API_KEY: KEY,
      OPENAI_MODEL: "gemini-test",
    });
    expect(gemini.status.configured).toBe(true);
    expect(createAssistantProviderFromConfig(gemini).stream).toBeDefined();
  });

  it("requires base URL for openai_compatible", () => {
    const config = readAssistantConfig({
      WORDLY_OPENAI_API_KEY: KEY,
      OPENAI_MODEL: "or-model",
      WORDLY_ASSISTANT_PROVIDER: "openai_compatible",
    });
    expect(config.status.configured).toBe(false);
    expect(config.status.problems.join(" ")).toContain("WORDLY_OPENAI_BASE_URL");
  });
});