import type { ProviderMessage } from "./prompt";

/*
 * The boundary between the assistant service and a model provider. The
 * OpenAI implementation lives in src/server/openai; tests use fakes.
 */

export interface ProviderTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
}

export type ProviderFunctionCall = {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
};

export type ProviderFunctionCallOutput = {
  type: "function_call_output";
  call_id: string;
  output: string;
};

/** Function-call rounds appended after the author messages for tool use. */
export type ProviderToolItem = ProviderFunctionCall | ProviderFunctionCallOutput;

/** Messages plus optional function-call rounds (OpenAI Responses input). */
export type ProviderInputItem = ProviderMessage | ProviderToolItem;

export interface ProviderRequest {
  model: string;
  instructions: string;
  /** Author-selected history and the framed question (always messages). */
  input: ProviderMessage[];
  /** Tool-call / tool-result items from prior rounds in this turn. */
  toolItems?: ProviderToolItem[];
  maxOutputTokens: number;
  timeoutMs: number;
  /** Read-only project tools for discussion turns. Omitted for proposals. */
  tools?: ProviderTool[];
  toolChoice?: "auto" | "none";
}

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export type ProviderToolCall = {
  callId: string;
  name: string;
  arguments: string;
};

/** One non-streaming Responses round (used for the tool loop). */
export type ProviderRound =
  | {
      kind: "message";
      text: string;
      status: "complete" | "incomplete";
      incompleteReason?: string;
      responseId?: string;
      usage?: ProviderUsage;
    }
  | {
      kind: "tool_calls";
      calls: ProviderToolCall[];
      responseId?: string;
      usage?: ProviderUsage;
    };

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
  /**
   * One non-streamed Responses round. Used for tool loops; optional so older
   * fakes that only implement stream keep working for tool-free turns.
   */
  complete?(request: ProviderRequest, signal: AbortSignal): Promise<ProviderRound>;
}
