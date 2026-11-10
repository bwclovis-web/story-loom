import { MAX_RESULT_CHARS } from "./limits";

export class McpToolError extends Error {
  readonly details: Record<string, unknown>;

  constructor(readonly code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "McpToolError";
    this.details = details;
  }
}

export function resultChars(value: unknown): number {
  return JSON.stringify(value).length;
}

/** Refuses an oversized payload. The error lists sizes and does not include the payload. */
export function assertFits(payload: unknown, items: { id: string; chars: number }[]): void {
  const chars = resultChars(payload);
  if (chars > MAX_RESULT_CHARS) {
    throw new McpToolError(
      "RESULT_TOO_LARGE",
      `The result is ${chars} characters, over the limit of ${MAX_RESULT_CHARS}. Nothing was shortened and nothing was returned.`,
      { chars, limit: MAX_RESULT_CHARS, items },
    );
  }
}
