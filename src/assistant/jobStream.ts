/*
 * Client helper for assistant job streams (selection assist, beat draft).
 * Supports SSE (text/event-stream) and legacy NDJSON line streams.
 */

export type AssistantJobEvent =
  | { type: "started"; runId?: string }
  | { type: "delta"; text: string }
  | { type: "done"; result?: unknown }
  | { type: "error"; message?: string };

function parseNdjsonLine(line: string): AssistantJobEvent | null {
  if (!line.trim()) return null;
  try {
    return JSON.parse(line) as AssistantJobEvent;
  } catch {
    return null;
  }
}

function parseSseBlock(block: string): AssistantJobEvent | null {
  const lines = block.split("\n");
  let event = "message";
  let data = "";
  for (const line of lines) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!data) return null;
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    if (event === "delta" && typeof parsed.text === "string") return { type: "delta", text: parsed.text };
    if (event === "started") return { type: "started", runId: typeof parsed.runId === "string" ? parsed.runId : undefined };
    if (event === "done") return { type: "done", result: parsed.result ?? parsed };
    if (event === "error") return { type: "error", message: typeof parsed.message === "string" ? parsed.message : undefined };
    return { type: event as AssistantJobEvent["type"], ...(parsed as object) } as AssistantJobEvent;
  } catch {
    return null;
  }
}

/** Read a streaming assistant job response until the body ends. */
export async function readAssistantJobStream(
  response: Response,
  onEvent: (event: AssistantJobEvent) => void,
): Promise<void> {
  if (!response.body) throw new Error("No response body");
  const contentType = response.headers.get("content-type") ?? "";
  const sse = contentType.includes("text/event-stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    if (sse) {
      let sep = buffer.indexOf("\n\n");
      while (sep >= 0) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const event = parseSseBlock(block);
        if (event) onEvent(event);
        sep = buffer.indexOf("\n\n");
      }
    } else {
      let lineEnd = buffer.indexOf("\n");
      while (lineEnd >= 0) {
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 1);
        const event = parseNdjsonLine(line);
        if (event) onEvent(event);
        lineEnd = buffer.indexOf("\n");
      }
    }
  }
}