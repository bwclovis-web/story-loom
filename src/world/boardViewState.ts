/** Board filter and Canvas/List choice for this browser tab. Positions stay on the cards. */

import {
  emptyTaxonomyFilter,
  type TaxonomyFilterValue,
} from "@/world/taxonomyDiscovery";

export type BoardKindFilter = "all" | "record" | "image" | "note";
export type BoardSurfaceView = "canvas" | "list";

const FILTER_PREFIX = "wordly-board-filter:";
const TAXONOMY_PREFIX = "wordly-board-taxonomy:";
const VIEW_PREFIX = "wordly-board-view:";

function storage(): Storage | null {
  return typeof sessionStorage === "undefined" ? null : sessionStorage;
}

export function readBoardFilter(boardId: string): BoardKindFilter {
  const value = storage()?.getItem(`${FILTER_PREFIX}${boardId}`);
  if (value === "record" || value === "image" || value === "note" || value === "all") return value;
  return "all";
}

export function writeBoardFilter(boardId: string, filter: BoardKindFilter): void {
  storage()?.setItem(`${FILTER_PREFIX}${boardId}`, filter);
}

export function readBoardTaxonomyFilter(boardId: string): TaxonomyFilterValue {
  const raw = storage()?.getItem(`${TAXONOMY_PREFIX}${boardId}`);
  if (!raw) return emptyTaxonomyFilter();
  try {
    const parsed = JSON.parse(raw) as { category?: unknown; subcategory?: unknown };
    return {
      category: typeof parsed.category === "string" && parsed.category ? parsed.category : null,
      subcategory:
        typeof parsed.subcategory === "string" && parsed.subcategory ? parsed.subcategory : null,
    };
  } catch {
    return emptyTaxonomyFilter();
  }
}

export function writeBoardTaxonomyFilter(boardId: string, filter: TaxonomyFilterValue): void {
  if (!filter.category) {
    storage()?.removeItem(`${TAXONOMY_PREFIX}${boardId}`);
    return;
  }
  storage()?.setItem(
    `${TAXONOMY_PREFIX}${boardId}`,
    JSON.stringify({ category: filter.category, subcategory: filter.subcategory }),
  );
}

export function readBoardView(boardId: string): BoardSurfaceView {
  return storage()?.getItem(`${VIEW_PREFIX}${boardId}`) === "list" ? "list" : "canvas";
}

export function writeBoardView(boardId: string, view: BoardSurfaceView): void {
  storage()?.setItem(`${VIEW_PREFIX}${boardId}`, view);
}
