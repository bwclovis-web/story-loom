export interface MapPinFilterRecordIndex {
  eraIds: string[];
  eventDraftScopes: string[];
  sceneDraftKeys: string[];
  sceneBookKeys: string[];
}

export function eventVisibleInDraft(scope: string, draft: string): boolean {
  if (draft === "all" || scope === "all") return true;
  return scope === draft;
}

export function pinMatchesMapFilter(
  recordId: string | null | undefined,
  filter: { era: string; draft: string; book: string },
  index: MapPinFilterRecordIndex | undefined,
): boolean {
  if (filter.era === "all" && filter.draft === "all" && filter.book === "all") return true;
  if (!recordId || !index) return false;

  const eraOk = filter.era === "all" || index.eraIds.includes(filter.era);
  const draftOk =
    filter.draft === "all" ||
    index.eventDraftScopes.some((scope) => eventVisibleInDraft(scope, filter.draft)) ||
    index.sceneDraftKeys.includes(filter.draft);
  const bookOk = filter.book === "all" || index.sceneBookKeys.includes(filter.book);

  return eraOk && draftOk && bookOk;
}