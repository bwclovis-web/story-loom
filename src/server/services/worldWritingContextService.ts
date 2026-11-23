/**
 * Server helpers for point-scoped Living World Profile context in AI drafting.
 */

import type { NarrativePoint } from "@/domain/characterDevelopment";
import type { WritingContextMode } from "@/domain/characterWritingContext";
import { isWorldProfileRecordType } from "@/domain/worldProfile";
import {
  renderWorldContextSlice,
  type WorldContextSliceMeta,
} from "@/domain/worldWritingContext";
import type { OrderEdge } from "@/world/storyOrder";
import type { SeriesHomeRef } from "@/world/seriesHome";
import { seriesBookLabel } from "@/world/seriesHome";
import type { WorldHistoryBookOrder } from "@/domain/worldProfileHistory";

export interface WorldReferenceRenderOptions {
  title: string;
  recordId: string;
  type: string;
  body: string;
  fields: Readonly<Record<string, unknown>>;
  mode?: WritingContextMode;
  allowFuturePlans?: boolean;
  point?: NarrativePoint | null;
  edges?: readonly OrderEdge[];
  books?: WorldHistoryBookOrder;
  bookIds?: readonly string[];
  viewingProjectId?: string | null;
  home?: SeriesHomeRef | null;
}

export function booksFromIds(bookIds: readonly string[] | undefined): WorldHistoryBookOrder {
  if (!bookIds?.length) return [];
  return bookIds.map((projectId, narrativeIndex) => ({ projectId, narrativeIndex }));
}

/** Render a world profile for assistant / selection-assist / tool payloads. */
export function renderWorldReferenceForAssistant(opts: WorldReferenceRenderOptions): {
  text: string;
  meta: WorldContextSliceMeta;
} | null {
  if (!isWorldProfileRecordType(opts.type)) return null;
  const books = opts.books?.length ? opts.books : booksFromIds(opts.bookIds);
  return renderWorldContextSlice({
    title: opts.title,
    recordId: opts.recordId,
    body: opts.body,
    fields: opts.fields,
    mode: opts.mode,
    allowFuturePlans: opts.allowFuturePlans,
    point: opts.point,
    edges: opts.edges,
    books,
    viewingProjectId: opts.viewingProjectId ?? opts.point?.bookProjectId ?? null,
    homeLabel: opts.home ? seriesBookLabel(opts.home) : null,
  });
}

export function draftingModeFromScope(scope: string | undefined, mode?: WritingContextMode): WritingContextMode {
  if (mode) return mode;
  if (scope === "chapter") return "drafting";
  return "editorial";
}
