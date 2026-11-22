/*
 * Assistant configuration from server environment variables. Pure: callers
 * pass the environment. The API key is returned separately from the status
 * so the status can be shown in the UI without ever carrying the secret.
 */

export interface AssistantLimits {
  /** Characters per request: instructions, source material, earlier messages and the question. */
  maxInputChars: number;
  /** Upper bound on generated tokens per response (sent as max_output_tokens). */
  maxOutputTokens: number;
  /** Requests started in any rolling hour, across all workspaces. */
  maxRequestsPerHour: number;
  /** Tokens per calendar month (UTC) recorded by this app, across all workspaces. */
  monthlyTokenCap: number;
  /** Seconds before an unfinished request is abandoned. */
  requestTimeoutSeconds: number;
  /** Max tool invocations per discussion turn (search/read). */
  maxToolCalls: number;
  /** Max tool rounds (model asks → tools run → model continues). */
  maxToolRounds: number;
  /** Cap on characters returned by a single tool read. */
  maxToolResultChars: number;
  /**
   * Output-token cap for one chapter analysis. Optional on hand-built limit
   * objects; the configured value is always set. Discussion and proofreading
   * keep maxOutputTokens.
   */
  analysisOutputTokens?: number;
}

interface LimitSpec {
  env: string;
  defaultValue: number;
  min: number;
  max: number;
}

export const LIMIT_SPECS: Record<keyof AssistantLimits, LimitSpec> = {
  maxInputChars: { env: "ASSISTANT_MAX_INPUT_CHARS", defaultValue: 600_000, min: 1_000, max: 1_000_000 },
  maxOutputTokens: { env: "ASSISTANT_MAX_OUTPUT_TOKENS", defaultValue: 2_000, min: 100, max: 100_000 },
  maxRequestsPerHour: { env: "ASSISTANT_MAX_REQUESTS_PER_HOUR", defaultValue: 30, min: 1, max: 1_000 },
  monthlyTokenCap: { env: "ASSISTANT_MONTHLY_TOKEN_CAP", defaultValue: 3_000_000, min: 1_000, max: 1_000_000_000 },
  requestTimeoutSeconds: { env: "ASSISTANT_REQUEST_TIMEOUT_SECONDS", defaultValue: 120, min: 10, max: 600 },
  maxToolCalls: { env: "ASSISTANT_MAX_TOOL_CALLS", defaultValue: 12, min: 0, max: 40 },
  maxToolRounds: { env: "ASSISTANT_MAX_TOOL_ROUNDS", defaultValue: 4, min: 0, max: 12 },
  maxToolResultChars: { env: "ASSISTANT_MAX_TOOL_RESULT_CHARS", defaultValue: 80_000, min: 2_000, max: 400_000 },
  /**
   * A representative response is 24 suggestions (three of each category) with a
   * 160-character quotation and a short note. That JSON is a few thousand
   * tokens under the app's four-characters-per-token estimate, so 2,000 would
   * cut a normal chapter off. 8,000 leaves room for longer quotations without
   * raising the chat and proofreading cap. The monthly token cap still applies.
   */
  analysisOutputTokens: { env: "ASSISTANT_ANALYSIS_OUTPUT_TOKENS", defaultValue: 8_000, min: 500, max: 100_000 },
};

/**
 * Story Loom's own key. The generic OPENAI_API_KEY is never used: it is
 * often set for the whole computer and shared by other apps, and this app is
 * responsible for its own key, usage and billing.
 */
export const API_KEY_ENV = "WORDLY_OPENAI_API_KEY";
export const SHARED_API_KEY_ENV = "OPENAI_API_KEY";
/** The OpenAI library adds these headers to every request and has no option to ignore them. */
export const SHARED_HEADERS_ENV = "OPENAI_CUSTOM_HEADERS";
export const MODEL_ENV = "OPENAI_MODEL";

const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;

export interface AssistantStatus {
  configured: boolean;
  /** Model ID from OPENAI_MODEL; not secret. */
  model: string | null;
  limits: AssistantLimits;
  /** What stops the assistant from running. Never contains the key. */
  problems: string[];
}

export interface AssistantConfig {
  status: AssistantStatus;
  /** Present only when status.configured is true. */
  apiKey: string | null;
}

type Env = Record<string, string | undefined>;

function readLimit(env: Env, spec: LimitSpec, problems: string[]): number {
  const raw = env[spec.env]?.trim();
  if (!raw) return spec.defaultValue;
  const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value < spec.min || value > spec.max) {
    problems.push(`${spec.env} must be a whole number from ${spec.min} to ${spec.max}.`);
    return spec.defaultValue;
  }
  return value;
}

export function readAssistantConfig(env: Env): AssistantConfig {
  const problems: string[] = [];
  const apiKey = env[API_KEY_ENV]?.trim() || null;
  const model = env[MODEL_ENV]?.trim() || null;

  if (!apiKey && env[SHARED_API_KEY_ENV]?.trim()) {
    problems.push(
      `${API_KEY_ENV} is not set. ${SHARED_API_KEY_ENV} is set, but that name is shared with other apps on this computer, so Story Loom does not use it. Add a key for this app on the Settings page, or put it in ${API_KEY_ENV} in this folder's .env file.`,
    );
  } else if (!apiKey) {
    problems.push(
      `${API_KEY_ENV} is not set. Add your OpenAI API key on the Settings page, or set ${API_KEY_ENV} in .env.`,
    );
  }
  if (env[SHARED_HEADERS_ENV]?.trim()) {
    problems.push(
      `${SHARED_HEADERS_ENV} is set. The OpenAI library would add those headers to this app's requests, so remove it from the environment Story Loom runs in.`,
    );
  }
  if (!model) {
    problems.push(
      `${MODEL_ENV} is not set. Choose a text model on the Settings page (or in .env) that your API project can use with the Responses API.`,
    );
  } else if (!MODEL_PATTERN.test(model)) {
    problems.push(`${MODEL_ENV} does not look like a model ID.`);
  }

  const exposed = Object.keys(env).filter((k) => /^NEXT_PUBLIC_.*(OPENAI|API_KEY)/i.test(k) && env[k]);
  for (const name of exposed) {
    problems.push(`Remove ${name}: NEXT_PUBLIC_ variables are copied into the browser. Use ${API_KEY_ENV} instead.`);
  }

  const limits = Object.fromEntries(
    (Object.keys(LIMIT_SPECS) as (keyof AssistantLimits)[]).map((k) => [k, readLimit(env, LIMIT_SPECS[k], problems)]),
  ) as unknown as AssistantLimits;

  const configured = problems.length === 0;
  return {
    status: { configured, model: model && MODEL_PATTERN.test(model) ? model : null, limits, problems },
    apiKey: configured ? apiKey : null,
  };
}

/** Rough token estimate (about four characters per token in English). Shown only as an estimate, never as a price. */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

export const DEFAULT_ANALYSIS_OUTPUT_TOKENS = LIMIT_SPECS.analysisOutputTokens.defaultValue;

/** Chapter-analysis output cap. Falls back when a caller built limits without the field. */
export function analysisOutputTokens(limits: AssistantLimits): number {
  return limits.analysisOutputTokens ?? DEFAULT_ANALYSIS_OUTPUT_TOKENS;
}
