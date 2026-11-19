/**
 * Plot-grid display for beats linked to the other manuscript draft.
 * The beat's stored chapter or scene is never changed here.
 */

export function otherDraftRowByRecord(
  visibleRowIds: ReadonlySet<string>,
  links: readonly { fromRecordId: string; toRecordId: string }[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const link of links) {
    const fromVisible = visibleRowIds.has(link.fromRecordId);
    const toVisible = visibleRowIds.has(link.toRecordId);
    if (fromVisible === toVisible) continue;
    if (fromVisible) map.set(link.toRecordId, link.fromRecordId);
    else map.set(link.fromRecordId, link.toRecordId);
  }
  return map;
}

/** Row to show a beat on. Null means it stays in Unplaced. */
export function plotRowForManuscript(
  manuscriptRecordId: string | null,
  visibleRowIds: ReadonlySet<string>,
  otherDraftRow: ReadonlyMap<string, string>,
): string | null {
  if (!manuscriptRecordId) return null;
  if (visibleRowIds.has(manuscriptRecordId)) return manuscriptRecordId;
  const rowId = otherDraftRow.get(manuscriptRecordId);
  return rowId && visibleRowIds.has(rowId) ? rowId : null;
}
