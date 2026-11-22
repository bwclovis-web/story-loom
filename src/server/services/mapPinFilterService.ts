import type { MapPinFilterRecordIndex } from "@/world/mapPinFilter";
import type { DbOrTx } from "../db";
import { loadWorldCalendar, calendarDefs } from "./worldCalendarService";

export type { MapPinFilterRecordIndex };

export interface MapPinFilterChoices {
  eras: Array<{ id: string; label: string }>;
  drafts: Array<{ id: string; label: string }>;
  books: Array<{ id: string; label: string }>;
}

export interface MapPinFilterContext {
  choices: MapPinFilterChoices;
  byRecordId: Record<string, MapPinFilterRecordIndex>;
}

function draftKey(draftId: string | null): string {
  return draftId ?? "unscoped";
}

function bookKey(groupId: string | null): string {
  return groupId ?? "ungrouped";
}

/** Read-only index for highlighting map pins by story events and scene locations. */
export async function loadMapPinFilterContext(
  db: DbOrTx,
  projectId: string,
  locationRecordIds: readonly string[],
): Promise<MapPinFilterContext> {
  const ids = [...new Set(locationRecordIds.filter(Boolean))];
  const calendar = await loadWorldCalendar(db, projectId);
  const { eras } = calendarDefs(calendar);

  const [drafts, groups, eventLinks, sceneLinks] = await Promise.all([
    db.manuscriptDraft.findMany({
      where: { projectId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, label: true },
    }),
    db.manuscriptGroup.findMany({
      where: { projectId },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { id: true, label: true },
    }),
    ids.length
      ? db.storyEventLocation.findMany({
          where: { projectId, locationRecordId: { in: ids } },
          select: {
            locationRecordId: true,
            event: {
              select: { draftScope: true, structEraId: true },
            },
          },
        })
      : Promise.resolve([]),
    ids.length
      ? db.sceneLocation.findMany({
          where: { projectId, locationRecordId: { in: ids } },
          select: {
            locationRecordId: true,
            manuscript: {
              select: { draftId: true, groupId: true },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  const byRecordId: Record<string, MapPinFilterRecordIndex> = {};
  const emptyIndex = (): MapPinFilterRecordIndex => ({
    eraIds: [],
    eventDraftScopes: [],
    sceneDraftKeys: [],
    sceneBookKeys: [],
  });

  for (const id of ids) byRecordId[id] = emptyIndex();

  for (const row of eventLinks) {
    const bucket = byRecordId[row.locationRecordId] ?? (byRecordId[row.locationRecordId] = emptyIndex());
    const era = row.event.structEraId;
    if (era && !bucket.eraIds.includes(era)) bucket.eraIds.push(era);
    const scope = row.event.draftScope;
    if (!bucket.eventDraftScopes.includes(scope)) bucket.eventDraftScopes.push(scope);
  }

  for (const row of sceneLinks) {
    const bucket = byRecordId[row.locationRecordId] ?? (byRecordId[row.locationRecordId] = emptyIndex());
    const d = draftKey(row.manuscript.draftId);
    const b = bookKey(row.manuscript.groupId);
    if (!bucket.sceneDraftKeys.includes(d)) bucket.sceneDraftKeys.push(d);
    if (!bucket.sceneBookKeys.includes(b)) bucket.sceneBookKeys.push(b);
  }

  return {
    choices: {
      eras: eras.map((era) => ({ id: era.id, label: era.name })),
      drafts: drafts.map((draft) => ({ id: draft.id, label: draft.label })),
      books: groups.map((group) => ({ id: group.id, label: group.label })),
    },
    byRecordId,
  };
}
