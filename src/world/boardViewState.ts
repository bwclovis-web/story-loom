/** Board filter and Canvas/List choice for this browser tab. Positions stay on the cards. */

export type BoardKindFilter = "all" | "record" | "image" | "note";
export type BoardSurfaceView = "canvas" | "list";

const FILTER_PREFIX = "wordly-board-filter:";
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

export function readBoardView(boardId: string): BoardSurfaceView {
  return storage()?.getItem(`${VIEW_PREFIX}${boardId}`) === "list" ? "list" : "canvas";
}

export function writeBoardView(boardId: string, view: BoardSurfaceView): void {
  storage()?.setItem(`${VIEW_PREFIX}${boardId}`, view);
}
