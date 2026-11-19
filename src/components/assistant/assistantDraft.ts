/*
 * Persist the composer draft and selected conversation when switching
 * between the Write rail and the expanded Assistant page.
 */

const PREFIX = "storyloom-assistant-draft:";

export interface AssistantUiDraft {
  conversationId: string | null;
  question: string;
  scope: "chapter" | "book" | "series";
  updatedAt: number;
}

export function draftKey(projectId: string): string {
  return `${PREFIX}${projectId}`;
}

export function loadAssistantDraft(projectId: string): AssistantUiDraft | null {
  try {
    const raw = sessionStorage.getItem(draftKey(projectId));
    if (!raw) return null;
    const v = JSON.parse(raw) as AssistantUiDraft;
    if (!v || typeof v.question !== "string") return null;
    return v;
  } catch {
    return null;
  }
}

export function saveAssistantDraft(projectId: string, draft: Omit<AssistantUiDraft, "updatedAt">): void {
  try {
    sessionStorage.setItem(draftKey(projectId), JSON.stringify({ ...draft, updatedAt: Date.now() }));
  } catch {
    // ignore
  }
}
