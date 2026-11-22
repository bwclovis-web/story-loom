import "server-only";

/** Encode one Server-Sent Events frame (`event` + `data` lines, blank line terminator). */
export function encodeSse(event: string, data: unknown): Uint8Array {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  return new TextEncoder().encode(`event: ${event}\ndata: ${payload}\n\n`);
}

export function sseResponseHeaders(): HeadersInit {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    "Connection": "keep-alive",
    "X-Content-Type-Options": "nosniff",
  };
}