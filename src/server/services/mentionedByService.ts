import { RECORD_TYPE_LABELS, isLinkableReferenceType, isRecordType } from "@/domain/recordTypes";
import { crossRefsFor, type CrossRefIndex, type RecordCrossRefs } from "@/writing/crossRefs";
import type { DbOrTx } from "../db";
import { listLinkingRecords } from "./linkService";
import { listRecordPlacements } from "./referencePlacementService";
import { listScenesForLocation } from "./sceneLocationService";
import { listEventsForLocation, type PlaceEventItem } from "./storyEventService";

export type MentionedByKind =
  | "manuscript_name"
  | "cross_ref"
  | "manuscript_link"
  | "scene_location"
  | "story_event"
  | "weave_beat"
  | "map_pin"
  | "board_card";

export interface MentionedByItem {
  kind: MentionedByKind;
  title: string;
  detail: string;
  href: string;
}

/** Inbound references to a record: read-only union of computed cross-refs and related rows. */
export async function listMentionedBy(
  db: DbOrTx,
  projectId: string,
  recordId: string,
  index: CrossRefIndex,
): Promise<MentionedByItem[]> {
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const record = index.records.get(recordId);
  if (!record) return [];
  const refs: RecordCrossRefs = crossRefsFor(index, recordId);
  const items: MentionedByItem[] = [];

  for (const hit of refs.namedIn) {
    items.push({
      kind: "manuscript_name",
      title: hit.title,
      detail: `${hit.count} mention${hit.count === 1 ? "" : "s"}`,
      href: `${base}/records/${encodeURIComponent(hit.recordId)}`,
    });
  }

  for (const m of refs.mentionedBy) {
    items.push({
      kind: "cross_ref",
      title: m.title,
      detail: m.via.join(", "),
      href: `${base}/records/${encodeURIComponent(m.recordId)}`,
    });
  }

  if (isLinkableReferenceType(record.type)) {
    const links = await listLinkingRecords(db, projectId, recordId);
    for (const link of links) {
      if (!isRecordType(link.type)) continue;
      const parent = link.parentRecordId
        ? await db.record.findFirst({ where: { id: link.parentRecordId, projectId, trashedAt: null }, select: { title: true } })
        : null;
      items.push({
        kind: "manuscript_link",
        title: link.title,
        detail: parent ? `${RECORD_TYPE_LABELS[link.type]} · ${parent.title}` : RECORD_TYPE_LABELS[link.type],
        href: `${base}/records/${encodeURIComponent(link.recordId)}`,
      });
    }

    const scenes = await listScenesForLocation(db, projectId, recordId);
    for (const scene of scenes.scenes) {
      items.push({
        kind: "scene_location",
        title: scene.title,
        detail: scene.isPrimary ? "Primary location" : "Scene location",
        href: `${base}/records/${encodeURIComponent(scene.recordId)}`,
      });
    }

    let events: PlaceEventItem[] = [];
    try {
      events = await listEventsForLocation(db, projectId, recordId);
    } catch {
      events = [];
    }
    for (const event of events) {
      items.push({
        kind: "story_event",
        title: event.title,
        detail: event.timeLabel || "Story event",
        href: `${base}/world/events`,
      });
    }

    const beats = await db.weaveBeatWorldRef.findMany({
      where: { projectId, recordId, record: { trashedAt: null } },
      orderBy: [{ beat: { title: "asc" } }, { id: "asc" }],
      select: {
        beat: { select: { id: true, title: true, gridId: true, grid: { select: { title: true } } } },
      },
    });
    for (const row of beats) {
      items.push({
        kind: "weave_beat",
        title: row.beat.title,
        detail: row.beat.grid.title,
        href: `${base}/plan/weave/${encodeURIComponent(row.beat.gridId)}`,
      });
    }

    const placements = await listRecordPlacements(db, projectId, recordId);
    for (const place of placements) {
      if (place.surface === "board") {
        items.push({
          kind: "board_card",
          title: record.title,
          detail: place.surfaceTitle,
          href: `${base}/world/boards/${encodeURIComponent(place.surfaceId)}`,
        });
      } else {
        items.push({
          kind: "map_pin",
          title: record.title,
          detail: place.surfaceTitle,
          href: `${base}/world/maps/${encodeURIComponent(place.surfaceId)}`,
        });
      }
    }
  }

  items.sort((a, b) => a.title.localeCompare(b.title) || a.kind.localeCompare(b.kind));
  return items;
}