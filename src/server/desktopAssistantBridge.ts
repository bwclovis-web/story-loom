import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseJsonObject } from "@/domain/json";
import { API_KEY_ENV, BASE_URL_ENV, MODEL_ENV } from "@/assistant/config";

export type DesktopKeySource = "os-encrypted" | "fallback-plaintext" | null;

export interface DesktopAssistantBridge {
  keySource: DesktopKeySource;
  /** Model from desktop config when the key is injected from the shell. */
  model: string | null;
  precedenceNote: string;
}

function bridgePath(): string {
  const override = process.env.WORDLY_DESKTOP_ASSISTANT_BRIDGE?.trim();
  if (override) return path.resolve(/*turbopackIgnore: true*/ override);
  return path.join(path.resolve(/*turbopackIgnore: true*/ process.cwd(), "local"), "desktop-assistant-bridge.json");
}

export function desktopAssistantBridgePath(): string {
  return bridgePath();
}

export function loadDesktopAssistantBridge(): DesktopAssistantBridge | null {
  const file = bridgePath();
  if (!existsSync(file)) return null;
  try {
    const parsed = parseJsonObject(readFileSync(file, "utf8"));
    const keySource =
      parsed.keySource === "os-encrypted" || parsed.keySource === "fallback-plaintext" ? parsed.keySource : null;
    const model = typeof parsed.model === "string" && parsed.model.trim() ? parsed.model.trim() : null;
    const precedenceNote =
      typeof parsed.precedenceNote === "string" && parsed.precedenceNote.trim()
        ? parsed.precedenceNote.trim()
        : "desktop encrypted > assistant-secrets.json > .env";
    return { keySource, model, precedenceNote };
  } catch {
    return null;
  }
}

/** True when the Electron shell injected an API key for this server process. */
export function desktopInjectedApiKey(): string | null {
  if (process.env.STORYLOOM_ELECTRON !== "1") return null;
  const key = process.env.WORDLY_OPENAI_API_KEY?.trim() || process.env[API_KEY_ENV]?.trim();
  return key || null;
}

export function desktopPrecedenceActive(): boolean {
  return Boolean(desktopInjectedApiKey() && loadDesktopAssistantBridge()?.keySource);
}