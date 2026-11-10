/*
 * In-process registry of running assistant requests, so the Cancel button can
 * stop a response even if the browser keeps the stream open.
 */

const globalForRuns = globalThis as unknown as { __wordlyAssistantRuns?: Map<string, AbortController> };

function runs(): Map<string, AbortController> {
  globalForRuns.__wordlyAssistantRuns ??= new Map();
  return globalForRuns.__wordlyAssistantRuns;
}

export function registerRun(messageId: string): AbortController {
  const controller = new AbortController();
  runs().set(messageId, controller);
  return controller;
}

export function finishRun(messageId: string): void {
  runs().delete(messageId);
}

export function cancelRun(messageId: string): boolean {
  const controller = runs().get(messageId);
  if (!controller) return false;
  controller.abort();
  return true;
}
