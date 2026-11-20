/** Persist composer choices when opening a new conversation from Assistant Home. */

const PREFIX = "storyloom-assistant-composer:";

export type StoredComposerState = {
  question: string;
  selectedRefs: string[];
  sectionPicks: Record<string, string[]>;
  excludedIds: string[];
  chapterRecordId: string | null;
  passage: { start: number; end: number } | null;
  mode: "whole" | "passage";
  includeIds: string[];
  retrievalScope: "chapter" | "book" | "series";
  enableTools: boolean;
};

export function composerStateKey(projectId: string, conversationId: string): string {
  return `${PREFIX}${projectId}:${conversationId}`;
}

export function saveComposerState(projectId: string, conversationId: string, state: StoredComposerState): void {
  try {
    sessionStorage.setItem(composerStateKey(projectId, conversationId), JSON.stringify(state));
  } catch {
    // ignore
  }
}

export function loadComposerState(projectId: string, conversationId: string): StoredComposerState | null {
  try {
    const raw = sessionStorage.getItem(composerStateKey(projectId, conversationId));
    if (!raw) return null;
    return JSON.parse(raw) as StoredComposerState;
  } catch {
    return null;
  }
}

export function clearComposerState(projectId: string, conversationId: string): void {
  try {
    sessionStorage.removeItem(composerStateKey(projectId, conversationId));
  } catch {
    // ignore
  }
}