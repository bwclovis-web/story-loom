/*
 * Audit of what retrieval supplied (or omitted) for one assistant answer.
 * Persisted as AssistantMessage.retrievalJson.
 */

import type { ContextKind } from "./prompt";
import type { RetrievalScope } from "./tools";

// RetrievalScope re-exported for RetrievalContextState consumers.
export type { RetrievalScope };

export interface RetrievalOmission {
  /** Short label for the UI. */
  label: string;
  reason: string;
  recordId?: string;
}

export interface RetrievalSourceNote {
  recordId: string;
  title: string;
  kind: ContextKind;
  revision: number;
  passageStart: number | null;
  passageEnd: number | null;
  /** How this text entered the request. */
  origin: "manual" | "tool" | "unsaved";
  /** Evidence / draft labeling for the model and UI. */
  evidenceLabel?: string;
}

export interface RetrievalMeta {
  scope: RetrievalScope;
  toolCallCount: number;
  toolRoundCount: number;
  /** Wall time spent in the tool loop (ms). */
  elapsedMs: number;
  unsavedProseIncluded: boolean;
  excludedRecordIds: string[];
  sources: RetrievalSourceNote[];
  omissions: RetrievalOmission[];
  /** Model or server concluded evidence was too thin. */
  insufficientEvidence: boolean;
  ambiguousNames: string[];
}

export function emptyRetrievalMeta(scope: RetrievalScope): RetrievalMeta {
  return {
    scope,
    toolCallCount: 0,
    toolRoundCount: 0,
    elapsedMs: 0,
    unsavedProseIncluded: false,
    excludedRecordIds: [],
    sources: [],
    omissions: [],
    insufficientEvidence: false,
    ambiguousNames: [],
  };
}

/** Runtime context for one discussion turn’s tool loop (server-only use). */
export interface RetrievalContextState {
  projectId: string;
  scope: RetrievalScope;
  focusRecordId: string | null;
  draftId: string | null;
  excludeRecordIds: ReadonlySet<string>;
  maxResultChars: number;
  meta: RetrievalMeta;
}

export function parseRetrievalMeta(raw: string | null | undefined): RetrievalMeta | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as RetrievalMeta;
    if (!v || typeof v !== "object" || !Array.isArray(v.sources) || !Array.isArray(v.omissions)) return null;
    return v;
  } catch {
    return null;
  }
}
