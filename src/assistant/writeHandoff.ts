/*
 * Write → Assistant handoff. Unsaved prose cannot fit in the URL; the editor
 * stores a short-lived payload in sessionStorage, keyed per project.
 */

import type { RetrievalScope } from "./tools";

export const WRITE_HANDOFF_PREFIX = "storyloom-assistant-write:";

export interface WriteHandoffPayload {
  recordId: string;
  draftId: string | null;
  question: string;
  scope: RetrievalScope;
  passage: { start: number; end: number } | null;
  includeUnsavedProse: boolean;
  unsavedBody: string | null;
  createdAt: number;
}

export function writeHandoffKey(projectId: string): string {
  return `${WRITE_HANDOFF_PREFIX}${projectId}`;
}

export function storeWriteHandoff(projectId: string, payload: WriteHandoffPayload): void {
  try {
    sessionStorage.setItem(writeHandoffKey(projectId), JSON.stringify(payload));
  } catch {
    // Quota or private mode — assistant still opens with seed only.
  }
}

export function takeWriteHandoff(projectId: string): WriteHandoffPayload | null {
  try {
    const raw = sessionStorage.getItem(writeHandoffKey(projectId));
    if (!raw) return null;
    sessionStorage.removeItem(writeHandoffKey(projectId));
    const v = JSON.parse(raw) as WriteHandoffPayload;
    if (!v?.recordId || typeof v.question !== "string") return null;
    if (Date.now() - (v.createdAt ?? 0) > 30 * 60_000) return null;
    return v;
  } catch {
    return null;
  }
}
