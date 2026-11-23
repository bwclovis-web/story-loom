import type { NarrativePoint } from "@/domain/characterDevelopment";
import { chronologicalIds, orderGraphHasCycle, orderRelation, type OrderEdge } from "@/world/storyOrder";
import { buildManuscriptTree } from "@/ui/manuscriptTree";
import type { DbOrTx } from "../db";
import { EVIDENCE_KIND_LABELS, type EvidenceKind } from "./establishedFactService";
import { listScenesForLocation } from "./sceneLocationService";
import { resolveAvailableReference } from "./seriesBibleService";

/*
 * Read-only answers about story events, scene locations, and map markers.
 * Chronology uses earlier/later constraints only. This module does not write.
 */

const KNOWLEDGE =
  "A scene that reveals an event tells you when the reader learns it. It does not mean the event happens in that scene, and it does not mean every character in the scene knows it.";
const TIME =
  "An empty time label means the story time is unknown. Do not invent a date. Order comes only from earlier/later constraints. Unresolved means no constraint connects those events.";
const PLANNED =
  "A planned event stays planned. Zero-draft evidence and author-manuscript evidence stay labeled as such. Neither is the other.";

export interface TimelineSource {
  title: string;
  recordId?: string;
  eventId?: string;
  mapId?: string;
  pinId?: string;
  revision: number;
  passageStart: number | null;
  passageEnd: number | null;
  evidenceLabel?: string;
  stale?: boolean;
}

export interface TimelineAnswer {
  payload: Record<string, unknown>;
  sources: TimelineSource[];
  /** Manuscript rows left out because they are outside the open chapter. */
  omittedManuscript: string[];
}

interface EventRow {
  id: string;
  title: string;
  summary: string;
  timeLabel: string;
  planned: boolean;
  draftScope: string;
  revision: number;
  createdAt: Date;
}

interface EvidenceRow {
  eventId: string;
  sourceRecordId: string;
  sourceTitle: string;
  sourceRevision: number;
  revisionNumber: number;
  passageStart: number;
  passageEnd: number;
  passageExcerpt: string;
  evidenceKind: EvidenceKind;
  needsRecheck: boolean;
}

interface RevealRow {
  eventId: string;
  recordId: string;
  title: string;
  type: "manuscript_chapter" | "manuscript_scene";
  parentRecordId: string | null;
  revision: number;
}

interface PlaceRow {
  eventId: string;
  recordId: string;
  title: string;
}

interface MarkerRow {
  recordId: string;
  mapId: string;
  pinId: string;
  title: string;
}

interface Graph {
  events: EventRow[];
  visible: EventRow[];
  edges: OrderEdge[];
  order: string[];
  evidence: EvidenceRow[];
  reveals: RevealRow[];
  places: PlaceRow[];
  markers: MarkerRow[];
  draftLabels: Map<string, string>;
}

function visibleInDraft(scope: string, draft: string): boolean {
  if (draft === "all" || scope === "all") return true;
  return scope === draft;
}

function isEvidenceKind(value: string): value is EvidenceKind {
  return value === "planned" || value === "zero_draft" || value === "author_rewrite";
}

function draftLabel(scope: string, names: Map<string, string>): string {
  if (scope === "all") return "All drafts";
  if (scope === "unscoped") return "Unscoped manuscript";
  return names.get(scope) ?? "Missing draft";
}

function eventCard(event: EventRow, names: Map<string, string>) {
  return {
    eventId: event.id,
    title: event.title,
    summary: event.summary,
    timeLabel: event.timeLabel,
    timeUnknown: event.timeLabel.trim() === "",
    planned: event.planned,
    draftScope: event.draftScope,
    draftLabel: draftLabel(event.draftScope, names),
    revision: event.revision,
  };
}

async function loadGraph(db: DbOrTx, projectId: string, draft: string): Promise<Graph> {
  const [events, orders, drafts, evidence, reveals, places, markers] = await Promise.all([
    db.storyEvent.findMany({
      where: { projectId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    db.storyEventOrder.findMany({
      where: { projectId },
      select: { earlierEventId: true, laterEventId: true },
    }),
    db.manuscriptDraft.findMany({ where: { projectId }, select: { id: true, label: true } }),
    db.storyEventEvidence.findMany({
      where: { projectId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { source: { select: { id: true, title: true, currentRevision: true, trashedAt: true } } },
    }),
    db.storyEventScene.findMany({
      where: { projectId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: {
        manuscript: { select: { id: true, title: true, type: true, parentRecordId: true, currentRevision: true, trashedAt: true } },
      },
    }),
    db.storyEventLocation.findMany({
      where: { projectId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { location: { select: { id: true, title: true, trashedAt: true } } },
    }),
    db.worldMapPin.findMany({
      where: { projectId, recordId: { not: null }, map: { image: { record: { trashedAt: null } } } },
      select: { id: true, recordId: true, mapId: true, map: { select: { title: true } } },
      orderBy: [{ map: { title: "asc" } }, { id: "asc" }],
    }),
  ]);
  const edges = orders.map((order) => ({ earlierId: order.earlierEventId, laterId: order.laterEventId }));
  const order = chronologicalIds(
    events.map((event) => ({ id: event.id, createdAt: event.createdAt.getTime() })),
    edges,
  );
  const visible = order.flatMap((id) => {
    const event = events.find((item) => item.id === id);
    if (!event || !visibleInDraft(event.draftScope, draft)) return [];
    return [event];
  });
  return {
    events,
    visible,
    edges,
    order,
    evidence: evidence.flatMap((row) => {
      if (row.source.trashedAt || !isEvidenceKind(row.evidenceKind)) return [];
      const stale = row.needsRecheck || row.source.currentRevision > row.revisionNumber;
      return [
        {
          eventId: row.eventId,
          sourceRecordId: row.source.id,
          sourceTitle: row.source.title,
          sourceRevision: row.source.currentRevision,
          revisionNumber: row.revisionNumber,
          passageStart: row.passageStart,
          passageEnd: row.passageEnd,
          passageExcerpt: row.passageExcerpt,
          evidenceKind: row.evidenceKind,
          needsRecheck: stale,
        },
      ];
    }),
    reveals: reveals.flatMap((row) => {
      if (row.manuscript.trashedAt) return [];
      if (row.manuscript.type !== "manuscript_chapter" && row.manuscript.type !== "manuscript_scene") return [];
      return [
        {
          eventId: row.eventId,
          recordId: row.manuscript.id,
          title: row.manuscript.title,
          type: row.manuscript.type,
          parentRecordId: row.manuscript.parentRecordId,
          revision: row.manuscript.currentRevision,
        },
      ];
    }),
    places: places.flatMap((row) => {
      if (row.location.trashedAt) return [];
      return [{ eventId: row.eventId, recordId: row.location.id, title: row.location.title }];
    }),
    markers: markers.flatMap((pin) => {
      if (!pin.recordId) return [];
      return [{ recordId: pin.recordId, mapId: pin.mapId, pinId: pin.id, title: pin.map.title }];
    }),
    draftLabels: new Map(drafts.map((item) => [item.id, item.label])),
  };
}

function allowed(recordId: string, manuscriptIds: ReadonlySet<string> | null): boolean {
  return manuscriptIds === null || manuscriptIds.has(recordId);
}

function evidenceOf(graph: Graph, eventId: string) {
  return graph.evidence
    .filter((row) => row.eventId === eventId)
    .map((row) => ({
      sourceRecordId: row.sourceRecordId,
      sourceTitle: row.sourceTitle,
      pinnedRevision: row.revisionNumber,
      sourceRevision: row.sourceRevision,
      passageStart: row.passageStart,
      passageEnd: row.passageEnd,
      excerpt: row.passageExcerpt,
      evidenceKind: row.evidenceKind,
      evidenceKindLabel: EVIDENCE_KIND_LABELS[row.evidenceKind],
      needsRecheck: row.needsRecheck,
    }));
}

function revealsOf(graph: Graph, eventId: string, manuscriptIds: ReadonlySet<string> | null) {
  const kept = [];
  const omitted: string[] = [];
  for (const row of graph.reveals) {
    if (row.eventId !== eventId) continue;
    if (!allowed(row.recordId, manuscriptIds)) {
      omitted.push(row.title);
      continue;
    }
    kept.push({ recordId: row.recordId, title: row.title, type: row.type, revision: row.revision });
  }
  return { kept, omitted };
}

function placesOf(graph: Graph, eventId: string) {
  return graph.places
    .filter((row) => row.eventId === eventId)
    .map((row) => ({
      recordId: row.recordId,
      title: row.title,
      maps: graph.markers
        .filter((marker) => marker.recordId === row.recordId)
        .map((marker) => ({ mapId: marker.mapId, pinId: marker.pinId, title: marker.title })),
    }));
}

function pushEvent(sources: TimelineSource[], event: EventRow) {
  sources.push({
    title: event.title,
    eventId: event.id,
    revision: event.revision,
    passageStart: null,
    passageEnd: null,
    evidenceLabel: event.planned ? "Planned event" : "Story event",
  });
}

function addEventSources(
  sources: TimelineSource[],
  graph: Graph,
  event: EventRow,
  manuscriptIds: ReadonlySet<string> | null,
  options: { omitPlannedEvidence?: boolean } = {},
) {
  pushEvent(sources, event);
  for (const reveal of revealsOf(graph, event.id, manuscriptIds).kept) {
    sources.push({
      title: reveal.title,
      recordId: reveal.recordId,
      revision: reveal.revision,
      passageStart: null,
      passageEnd: null,
      evidenceLabel: "Revealing scene — reader learns the event here, not character knowledge",
    });
  }
  for (const place of placesOf(graph, event.id)) {
    sources.push({
      title: place.title,
      recordId: place.recordId,
      revision: 0,
      passageStart: null,
      passageEnd: null,
      evidenceLabel: "Event location",
    });
    for (const map of place.maps) {
      sources.push({
        title: map.title,
        mapId: map.mapId,
        pinId: map.pinId,
        revision: 0,
        passageStart: null,
        passageEnd: null,
        evidenceLabel: "Map marker",
      });
    }
  }
  for (const row of graph.evidence.filter((item) => item.eventId === event.id)) {
    if (options.omitPlannedEvidence && row.evidenceKind === "planned") continue;
    sources.push({
      title: `${event.title} · ${row.sourceTitle}`,
      recordId: row.sourceRecordId,
      revision: row.revisionNumber,
      passageStart: row.passageStart,
      passageEnd: row.passageEnd,
      evidenceLabel: EVIDENCE_KIND_LABELS[row.evidenceKind],
      stale: row.needsRecheck,
    });
  }
}

function described(graph: Graph, event: EventRow, manuscriptIds: ReadonlySet<string> | null) {
  const reveals = revealsOf(graph, event.id, manuscriptIds);
  return {
    ...eventCard(event, graph.draftLabels),
    reveals: reveals.kept,
    places: placesOf(graph, event.id),
    evidence: evidenceOf(graph, event.id),
    omittedReveals: reveals.omitted,
  };
}

export async function eventsAtPlace(
  db: DbOrTx,
  projectId: string,
  locationRecordId: string,
  draft: string,
  manuscriptIds: ReadonlySet<string> | null = null,
  options: {
    allowSeriesShared?: boolean;
    omitPlanned?: boolean;
    point?: NarrativePoint | null;
    edges?: readonly OrderEdge[];
  } = {},
): Promise<TimelineAnswer | { error: "not_found" }> {
  let location: { id: string; title: string; currentRevision: number } | null = null;
  if (options.allowSeriesShared) {
    const available = await resolveAvailableReference(db, projectId, locationRecordId);
    if (available) {
      location = {
        id: available.record.id,
        title: available.record.title,
        currentRevision: available.record.currentRevision,
      };
    }
  } else {
    const row = await db.record.findFirst({
      where: { id: locationRecordId, projectId, trashedAt: null },
      select: { id: true, title: true, currentRevision: true },
    });
    location = row;
  }
  if (!location) return { error: "not_found" };
  const graph = await loadGraph(db, projectId, draft);
  const linked = new Set(graph.places.filter((row) => row.recordId === location.id).map((row) => row.eventId));
  let events = graph.visible.filter((event) => linked.has(event.id));
  const omittedPlanned: string[] = [];
  const omittedAfterPoint: string[] = [];
  if (options.omitPlanned) {
    events = events.filter((event) => {
      if (!event.planned) return true;
      omittedPlanned.push(event.title);
      return false;
    });
  }
  const pointEventId = options.point?.storyEventId ?? null;
  const edges = options.edges ?? [];
  if (pointEventId && edges.length) {
    events = events.filter((event) => {
      const rel = orderRelation(edges, event.id, pointEventId);
      if (rel === "after") {
        omittedAfterPoint.push(event.title);
        return false;
      }
      return true;
    });
  }
  const catalog = await listScenesForLocation(db, projectId, location.id, { draft, book: "all" });
  const omittedManuscript: string[] = [...omittedPlanned, ...omittedAfterPoint];
  const sceneLocations = catalog.scenes.flatMap((scene) => {
    if (!allowed(scene.recordId, manuscriptIds)) {
      omittedManuscript.push(scene.title);
      return [];
    }
    return [scene];
  });
  const sources: TimelineSource[] = [
    {
      title: location.title,
      recordId: location.id,
      revision: location.currentRevision,
      passageStart: null,
      passageEnd: null,
      evidenceLabel: "Place",
    },
  ];
  for (const marker of graph.markers.filter((item) => item.recordId === location.id)) {
    sources.push({
      title: marker.title,
      mapId: marker.mapId,
      pinId: marker.pinId,
      revision: 0,
      passageStart: null,
      passageEnd: null,
      evidenceLabel: "Map marker",
    });
  }
  const describedEvents = events.map((event) => {
    addEventSources(sources, graph, event, manuscriptIds, { omitPlannedEvidence: options.omitPlanned === true });
    const card = described(graph, event, manuscriptIds);
    omittedManuscript.push(...card.omittedReveals);
    if (!options.omitPlanned) return card;
    return {
      ...card,
      evidence: card.evidence.filter((row: { evidenceKind: string }) => row.evidenceKind !== "planned"),
    };
  });
  const unresolvedPairs = pairs(events, graph.edges, "unresolved");
  return {
    payload: {
      location: { recordId: location.id, title: location.title },
      sceneLocations: sceneLocations.map((scene) => ({
        recordId: scene.recordId,
        title: scene.title,
        type: scene.type,
        isPrimary: scene.isPrimary,
        note: "Scene location: where this chapter or scene is set. Not an event, and not story chronology.",
      })),
      maps: graph.markers
        .filter((marker) => marker.recordId === location.id)
        .map((marker) => ({ mapId: marker.mapId, pinId: marker.pinId, title: marker.title })),
      events: describedEvents,
      unresolvedPairs,
      unknownTime: events.filter((event) => event.timeLabel.trim() === "").map((event) => event.title),
      coverage: coverage(events, graph, unresolvedPairs.length),
      notes: [KNOWLEDGE, TIME, PLANNED, "Scene locations are settings. Events linked to the place are a separate list, in constraint order."],
      ...(omittedPlanned.length || omittedAfterPoint.length
        ? {
            draftingOmissions: {
              planned: omittedPlanned,
              afterStoryPoint: omittedAfterPoint,
            },
          }
        : {}),
    },
    sources,
    omittedManuscript,
  };
}

export async function eventReveals(
  db: DbOrTx,
  projectId: string,
  eventId: string,
  draft: string,
  manuscriptIds: ReadonlySet<string> | null = null,
): Promise<TimelineAnswer | { error: "not_found" }> {
  const graph = await loadGraph(db, projectId, draft);
  const event = graph.visible.find((item) => item.id === eventId);
  if (!event) return { error: "not_found" };
  const sources: TimelineSource[] = [];
  addEventSources(sources, graph, event, manuscriptIds);
  const card = described(graph, event, manuscriptIds);
  const before = graph.visible.filter((other) => other.id !== event.id && orderRelation(graph.edges, other.id, event.id) === "before");
  const after = graph.visible.filter((other) => other.id !== event.id && orderRelation(graph.edges, other.id, event.id) === "after");
  return {
    payload: {
      event: card,
      occurringBefore: before.map((item) => eventCard(item, graph.draftLabels)),
      occurringAfter: after.map((item) => eventCard(item, graph.draftLabels)),
      unresolvedWith: graph.visible
        .filter((other) => other.id !== event.id && orderRelation(graph.edges, other.id, event.id) === "unresolved")
        .map((item) => item.title),
      coverage: coverage([event, ...before, ...after], graph, 0),
      notes: [KNOWLEDGE, TIME, PLANNED],
    },
    sources,
    omittedManuscript: card.omittedReveals,
  };
}

async function manuscriptFocus(db: DbOrTx, projectId: string, manuscriptRecordId: string) {
  const record = await db.record.findFirst({
    where: { id: manuscriptRecordId, projectId, trashedAt: null },
    select: { id: true, title: true, type: true, parentRecordId: true, currentRevision: true, draftId: true },
  });
  if (!record || (record.type !== "manuscript_chapter" && record.type !== "manuscript_scene")) return null;
  const chapterId = record.type === "manuscript_chapter" ? record.id : record.parentRecordId;
  const scenes = chapterId
    ? await db.record.findMany({
        where: { projectId, parentRecordId: chapterId, type: "manuscript_scene", trashedAt: null },
        select: { id: true, title: true, currentRevision: true },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      })
    : [];
  return { record, chapterId, scenes };
}

function revealIdsFor(
  graph: Graph,
  focus: { id: string; type: string },
  chapterSceneIds: ReadonlySet<string>,
  wholeChapter: boolean,
): Set<string> {
  const ids = new Set<string>();
  for (const reveal of graph.reveals) {
    if (reveal.recordId === focus.id) ids.add(reveal.eventId);
    if (wholeChapter && chapterSceneIds.has(reveal.recordId)) ids.add(reveal.eventId);
  }
  return ids;
}

export async function eventsBeforeManuscript(
  db: DbOrTx,
  projectId: string,
  manuscriptRecordId: string,
  draft: string,
  manuscriptIds: ReadonlySet<string> | null = null,
): Promise<TimelineAnswer | { error: "not_found" }> {
  const focus = await manuscriptFocus(db, projectId, manuscriptRecordId);
  if (!focus) return { error: "not_found" };
  if (manuscriptIds && !manuscriptIds.has(focus.record.id)) return { error: "not_found" };
  const graph = await loadGraph(db, projectId, draft);
  const wholeChapter = focus.record.type === "manuscript_chapter";
  const sceneIds = new Set(focus.scenes.map((scene) => scene.id));
  const revealedIds = revealIdsFor(graph, focus.record, sceneIds, wholeChapter);
  const revealed = graph.visible.filter((event) => revealedIds.has(event.id));
  const occurringBefore = revealed.length
    ? graph.visible.filter((event) => !revealedIds.has(event.id) && revealed.some((item) => orderRelation(graph.edges, event.id, item.id) === "before"))
    : [];
  const occurringAfter = revealed.length
    ? graph.visible.filter(
        (event) =>
          !revealedIds.has(event.id) &&
          !occurringBefore.some((item) => item.id === event.id) &&
          revealed.some((item) => orderRelation(graph.edges, event.id, item.id) === "after"),
      )
    : [];
  const placed = new Set([...revealed, ...occurringBefore, ...occurringAfter].map((event) => event.id));
  const unresolved = revealed.length ? graph.visible.filter((event) => !placed.has(event.id)) : [];
  const sources: TimelineSource[] = [
    {
      title: focus.record.title,
      recordId: focus.record.id,
      revision: focus.record.currentRevision,
      passageStart: null,
      passageEnd: null,
      evidenceLabel: wholeChapter ? "Chapter" : "Scene",
    },
  ];
  for (const event of [...revealed, ...occurringBefore]) addEventSources(sources, graph, event, manuscriptIds);
  const locations = await sceneLocationsFor(db, projectId, [focus.record.id, ...focus.scenes.map((scene) => scene.id)]);
  return {
    payload: {
      manuscript: { recordId: focus.record.id, title: focus.record.title, type: focus.record.type },
      basis: wholeChapter ? "chapter" : "scene",
      revealedHere: revealed.map((event) => described(graph, event, manuscriptIds)),
      occurringBefore: occurringBefore.map((event) => described(graph, event, manuscriptIds)),
      occurringAfter: occurringAfter.map((event) => eventCard(event, graph.draftLabels)),
      unresolved: unresolved.map((event) => event.title),
      unknownTime: [...revealed, ...occurringBefore, ...unresolved]
        .filter((event) => event.timeLabel.trim() === "")
        .map((event) => event.title),
      sceneLocations: locations,
      chronologyRecorded: revealed.length > 0,
      coverage: coverage([...revealed, ...occurringBefore], graph, unresolved.length),
      notes: revealed.length
        ? [KNOWLEDGE, TIME, PLANNED, "occurringBefore uses constraint paths only. Manuscript order is not used."]
        : [
            "No event is linked as revealed by this chapter or scene, so none are established before it by a constraint.",
            KNOWLEDGE,
            TIME,
          ],
    },
    sources,
    omittedManuscript: [],
  };
}

export async function chapterEventSequence(
  db: DbOrTx,
  projectId: string,
  manuscriptRecordId: string,
  draft: string,
  manuscriptIds: ReadonlySet<string> | null = null,
): Promise<TimelineAnswer | { error: "not_found" }> {
  const focus = await manuscriptFocus(db, projectId, manuscriptRecordId);
  if (!focus || !focus.chapterId) return { error: "not_found" };
  if (manuscriptIds && !manuscriptIds.has(focus.record.id)) return { error: "not_found" };
  const chapter = await db.record.findFirst({
    where: { id: focus.chapterId, projectId, trashedAt: null },
    select: { id: true, title: true, currentRevision: true, draftId: true },
  });
  if (!chapter) return { error: "not_found" };
  const graph = await loadGraph(db, projectId, draft);
  const sceneIds = new Set(focus.scenes.map((scene) => scene.id));
  const inChapter = new Set<string>([chapter.id, ...sceneIds]);
  const revealedIds = new Set(graph.reveals.filter((row) => inChapter.has(row.recordId)).map((row) => row.eventId));
  const revealed = graph.visible.filter((event) => revealedIds.has(event.id));
  const indexes = await readerIndexes(db, projectId, chapter.draftId);
  const earliestReveal = (eventId: string, only: ReadonlySet<string> | null) => {
    const hits = graph.reveals
      .filter((row) => row.eventId === eventId && (only === null || only.has(row.recordId)))
      .flatMap((row) => {
        const index = indexes.get(row.recordId);
        if (index === undefined) return [];
        return [{ recordId: row.recordId, title: row.title, index }];
      })
      .sort((a, b) => a.index - b.index);
    return hits[0] ?? null;
  };
  const unresolvedPairs = pairs(revealed, graph.edges, "unresolved");
  const constraints = [];
  const readerOrderDifferences = [];
  for (let i = 0; i < revealed.length; i += 1) {
    for (let j = i + 1; j < revealed.length; j += 1) {
      const left = revealed[i]!;
      const right = revealed[j]!;
      const relation = orderRelation(graph.edges, left.id, right.id);
      if (relation !== "before" && relation !== "after") continue;
      const earlier = relation === "before" ? left : right;
      const later = relation === "before" ? right : left;
      constraints.push({ earlierEventId: earlier.id, earlierTitle: earlier.title, laterEventId: later.id, laterTitle: later.title });
    }
  }
  for (const event of revealed) {
    const here = earliestReveal(event.id, inChapter);
    if (!here) continue;
    for (const other of graph.visible) {
      if (other.id === event.id) continue;
      if (orderRelation(graph.edges, event.id, other.id) !== "before") continue;
      const otherReveal = earliestReveal(other.id, null);
      if (!otherReveal || otherReveal.index >= here.index) continue;
      readerOrderDifferences.push({
        earlierEventId: event.id,
        earlierTitle: event.title,
        earlierRevealedIn: here,
        laterEventId: other.id,
        laterTitle: other.title,
        laterRevealedIn: otherReveal,
        note: "The reader meets the chronologically later event first. That is a difference in manuscript order, not by itself a broken timeline.",
      });
    }
  }
  const cycle = orderGraphHasCycle(
    graph.events.map((event) => event.id),
    graph.edges,
  );
  const sources: TimelineSource[] = [
    {
      title: chapter.title,
      recordId: chapter.id,
      revision: chapter.currentRevision,
      passageStart: null,
      passageEnd: null,
      evidenceLabel: "Chapter",
    },
  ];
  for (const event of revealed) addEventSources(sources, graph, event, manuscriptIds);
  const unknownTime = revealed.filter((event) => event.timeLabel.trim() === "").map((event) => event.title);
  return {
    payload: {
      chapter: { recordId: chapter.id, title: chapter.title },
      revealedInChapter: revealed.map((event) => described(graph, event, manuscriptIds)),
      constraints,
      unresolvedPairs,
      unknownTime,
      readerOrderDifferences,
      constraintCycle: cycle,
      conflictsWithRecordedSequence: cycle,
      sceneLocations: await sceneLocationsFor(db, projectId, [...inChapter]),
      coverage: coverage(revealed, graph, unresolvedPairs.length),
      notes: [
        "conflictsWithRecordedSequence is true only when the recorded constraints contradict each other.",
        "readerOrderDifferences means the manuscript reveals a later story event first. Say so, and do not call that a contradiction unless constraintCycle is true.",
        KNOWLEDGE,
        TIME,
        PLANNED,
      ],
    },
    sources,
    omittedManuscript: [],
  };
}

function pairs(events: EventRow[], edges: OrderEdge[], relation: "unresolved") {
  const out: Array<{ left: string; right: string; relation: "unresolved" }> = [];
  for (let i = 0; i < events.length; i += 1) {
    for (let j = i + 1; j < events.length; j += 1) {
      const left = events[i]!;
      const right = events[j]!;
      if (orderRelation(edges, left.id, right.id) === relation) {
        out.push({ left: left.title, right: right.title, relation });
      }
    }
  }
  return out;
}

function coverage(events: EventRow[], graph: Graph, unresolvedCount: number) {
  const ids = new Set(events.map((event) => event.id));
  const evidence = graph.evidence.filter((row) => ids.has(row.eventId));
  return {
    eventCount: events.length,
    constraintCount: graph.edges.length,
    unknownTimeCount: events.filter((event) => event.timeLabel.trim() === "").length,
    unresolvedCount,
    pinnedPassageCount: evidence.length,
    staleEvidenceCount: evidence.filter((row) => row.needsRecheck).length,
  };
}

async function sceneLocationsFor(db: DbOrTx, projectId: string, manuscriptIds: string[]) {
  if (!manuscriptIds.length) return [];
  const rows = await db.sceneLocation.findMany({
    where: { projectId, manuscriptRecordId: { in: manuscriptIds } },
    include: { location: { select: { id: true, title: true, trashedAt: true } }, manuscript: { select: { title: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.flatMap((row) => {
    if (row.location.trashedAt) return [];
    return [
      {
        manuscriptRecordId: row.manuscriptRecordId,
        manuscriptTitle: row.manuscript.title,
        locationRecordId: row.location.id,
        locationTitle: row.location.title,
        isPrimary: row.isPrimary,
        note: "Scene location. Not an event and not a story date.",
      },
    ];
  });
}

async function readerIndexes(db: DbOrTx, projectId: string, draftId: string | null): Promise<Map<string, number>> {
  const rows = await db.record.findMany({
    where: {
      projectId,
      trashedAt: null,
      type: { in: ["manuscript_chapter", "manuscript_scene"] },
      draftId,
    },
    select: { id: true, title: true, type: true, parentRecordId: true, position: true, createdAt: true },
  });
  const tree = buildManuscriptTree(
    rows.flatMap((row) => {
      if (row.type !== "manuscript_chapter" && row.type !== "manuscript_scene") return [];
      return [
        {
          id: row.id,
          title: row.title,
          type: row.type,
          parentRecordId: row.parentRecordId,
          position: row.position,
          createdAt: row.createdAt.toISOString(),
        },
      ];
    }),
  );
  const ordered: string[] = [];
  for (const chapter of tree.chapters) {
    ordered.push(chapter.id);
    for (const scene of chapter.scenes) ordered.push(scene.id);
  }
  for (const scene of tree.unplaced) ordered.push(scene.id);
  return new Map(ordered.map((id, index) => [id, index]));
}
