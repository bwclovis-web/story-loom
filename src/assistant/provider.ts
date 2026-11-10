import type { ProviderMessage } from "./prompt";

/*
 * The boundary between the assistant service and a model provider. The
 * OpenAI implementation lives in src/server/openai; tests use fakes.
 */

export interface ProviderRequest {
  model: string;
  instructions: string;
  input: ProviderMessage[];
  maxOutputTokens: number;
  timeoutMs: number;
}

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export type ProviderEvent =
  | { type: "delta"; text: string }
  | {
      type: "done";
      status: "complete" | "incomplete";
      incompleteReason?: string;
      responseId?: string;
      usage?: ProviderUsage;
    };

export type ProviderErrorCode =
  | "cancelled"
  | "auth"
  | "permission"
  | "not_found"
  | "rate_limit"
  | "bad_request"
  | "server"
  | "connection"
  | "timeout"
  | "provider_failed";

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    readonly httpStatus?: number,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** A JSON Schema the response must follow (Structured Outputs, strict mode). */
export interface OutputSchema {
  name: string;
  schema: Record<string, unknown>;
}

export type StructuredResult = {
  responseId?: string;
  usage?: ProviderUsage;
} & (
  | { status: "complete"; text: string }
  | { status: "incomplete"; incompleteReason?: string }
  | { status: "refused"; refusal: string }
);

export interface AssistantProvider {
  stream(request: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderEvent>;
  /** One non-streamed response constrained to `schema`. Throws ProviderError on failure. */
  structured(request: ProviderRequest, schema: OutputSchema, signal: AbortSignal): Promise<StructuredResult>;
}
