/**
 * Board pointer decisions. Card positions stay on the board.
 * Moving a card does not change the reference it shows.
 * A board note stays a note until the author saves it as a note.
 */

export const BOARD_DRAG_THRESHOLD_PX = 5;

export type BoardTool = "select" | "pan";

export type BoardSurfaceView = "canvas" | "list";

export type BoardGesture = "select" | "pan" | "move";

export interface BoardNoteDraft {
  title: string;
  body: string;
}

export interface BoardCardSnapshot {
  id: string;
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  noteTitle: string;
  noteBody: string;
  label: string;
}

/** Pointer movement below this does not count as a drag. */
export function dragExceeded(dx: number, dy: number, threshold = BOARD_DRAG_THRESHOLD_PX): boolean {
  return dx * dx + dy * dy >= threshold * threshold;
}

/** Lock blocks both moving and resizing. Selection and note editing stay available. */
export function spatialChangeAllowed(locked: boolean): { move: boolean; resize: boolean } {
  return locked ? { move: false, resize: false } : { move: true, resize: true };
}

/**
 * A card moves only from its drag handle, with Select active, after the pointer
 * passes the threshold, and only while the layout is unlocked.
 * Pan scrolls the board. Text editing never starts a move.
 */
export function gestureForBoardPointer(input: {
  tool: BoardTool;
  locked: boolean;
  onHandle: boolean;
  onCard: boolean;
  editingText: boolean;
  exceeded: boolean;
}): BoardGesture {
  if (input.editingText) return "select";
  if (input.tool === "pan") return input.onCard && !input.exceeded ? "select" : "pan";
  if (!spatialChangeAllowed(input.locked).move) return "select";
  if (input.onHandle && input.exceeded) return "move";
  return "select";
}

/** A move is written only after a real drag that was not cancelled or locked. */
export function shouldWriteMove(input: { exceeded: boolean; cancelled: boolean; locked: boolean }): boolean {
  return input.exceeded && !input.cancelled && spatialChangeAllowed(input.locked).move;
}

/** Drop a draft once it matches the saved note. Other notes keep their drafts. */
export function rememberNoteDraft(
  drafts: Readonly<Record<string, BoardNoteDraft>>,
  cardId: string,
  draft: BoardNoteDraft,
  saved: BoardNoteDraft,
): Record<string, BoardNoteDraft> {
  if (draft.title === saved.title && draft.body === saved.body) {
    if (!(cardId in drafts)) return { ...drafts };
    const next = { ...drafts };
    delete next[cardId];
    return next;
  }
  return { ...drafts, [cardId]: { title: draft.title, body: draft.body } };
}

/**
 * Keep unsaved note text and the positions still on screen when a refresh arrives.
 * Server cards that were removed stay removed.
 */
export function mergeBoardCards<T extends BoardCardSnapshot>(
  server: readonly T[],
  local: readonly T[],
  drafts: Readonly<Record<string, BoardNoteDraft>>,
): T[] {
  const localById = new Map(local.map((card) => [card.id, card]));
  return server.map((card) => {
    const previous = localById.get(card.id);
    const draft = card.kind === "note" ? drafts[card.id] : undefined;
    if (!previous && !draft) return card;
    const title = draft?.title ?? card.noteTitle;
    return {
      ...card,
      ...(previous
        ? { x: previous.x, y: previous.y, width: previous.width, height: previous.height }
        : {}),
      ...(draft
        ? { noteTitle: draft.title, noteBody: draft.body, label: title.trim() || "Note" }
        : {}),
    };
  });
}

/** Scroll so the cards sit in the middle. This does not change zoom. */
export function centerScroll(
  viewport: { clientWidth: number; clientHeight: number },
  targets: readonly { x: number; y: number; width: number; height: number }[],
): { left: number; top: number } | null {
  if (!targets.length) return null;
  const minX = Math.min(...targets.map((card) => card.x));
  const minY = Math.min(...targets.map((card) => card.y));
  const maxX = Math.max(...targets.map((card) => card.x + card.width));
  const maxY = Math.max(...targets.map((card) => card.y + card.height));
  return {
    left: Math.max(0, (minX + maxX) / 2 - viewport.clientWidth / 2),
    top: Math.max(0, (minY + maxY) / 2 - viewport.clientHeight / 2),
  };
}

export type BoardFilterState = "empty" | "hidden" | "shown";

export function boardFilterState(total: number, visible: number): BoardFilterState {
  if (total === 0) return "empty";
  if (visible === 0) return "hidden";
  return "shown";
}
