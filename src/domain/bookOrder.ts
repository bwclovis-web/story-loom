/*
 * Book order of chapters (among chapters) and scenes (within their chapter).
 * Records the author has placed carry a position; records never placed have
 * none and follow the placed ones in creation order, so a new or imported
 * chapter joins the end of the book.
 */

export interface BookOrdered {
  id: string;
  position: number | null;
  /** ISO time. */
  createdAt: string;
}

export function compareBookOrder(a: BookOrdered, b: BookOrdered): number {
  if (a.position !== b.position) {
    if (a.position === null) return 1;
    if (b.position === null) return -1;
    return a.position - b.position;
  }
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Sibling IDs after moving `movedId` to `index` (counted without it). The
 * index is clamped to the list, so "to the end" can be any large number.
 */
export function orderAfterMove(siblingIds: readonly string[], movedId: string, index: number): string[] {
  const rest = siblingIds.filter((id) => id !== movedId);
  const at = Math.max(0, Math.min(Number.isFinite(index) ? Math.trunc(index) : rest.length, rest.length));
  return [...rest.slice(0, at), movedId, ...rest.slice(at)];
}
