import { orderRelation, type OrderEdge } from "@/world/storyOrder";
import { worldbuildingKindFromFields } from "@/world/worldKinds";

export type TimelineLaneKind = "character" | "faction" | "location";

export interface TimelineBoardEvent {
  id: string;
  title: string;
  summary: string;
  /** Complete structured-date sort key, or null when the date is missing or incomplete. */
  dateKey: number | null;
  /** Position in the author's recorded order. */
  orderIndex: number;
}

export interface TimelineBoardLink {
  eventId: string;
  recordId: string;
  title: string;
  laneKind: TimelineLaneKind;
  /** True when the reference is a place, so two of them on one date can be compared. */
  place: boolean;
}

export interface TimelineBoardReveal {
  eventId: string;
  recordId: string;
  title: string;
  /** Index in that draft's book order. */
  bookIndex: number;
  draftId: string;
}

export type TimelineWarning =
  | { kind: "same_date"; character: string; places: string[] }
  | { kind: "reveal_order"; earlierTitle: string; laterTitle: string }
  | { kind: "before_birth"; character: string; birthTitle: string };

export interface TimelineMark {
  eventId: string;
  title: string;
  laneKind: TimelineLaneKind;
  laneId: string;
  /** 0–1 along the board. */
  x: number;
  /** `order` on a date board means the event has no complete date. */
  axis: "date" | "order";
  ageYears: number | null;
  ageName: string | null;
}

export interface TimelineLane {
  id: string;
  title: string;
  kind: TimelineLaneKind;
}

export interface TimelineBoard {
  mode: "date" | "order";
  lanes: TimelineLane[];
  marks: TimelineMark[];
  warnings: TimelineWarning[];
}

const BIRTH = /\b(born|birth)\b/i;
const FLASHBACK = /\bflashback\b/i;
const UNASSIGNED = "__unassigned";

export function unassignedLaneId(kind: TimelineLaneKind): string {
  return `${UNASSIGNED}:${kind}`;
}

/** Character dossiers, organizations, and places become swimlanes. Other references do not. */
export function referenceLane(type: string, fields: unknown): { kind: TimelineLaneKind; place: boolean } | null {
  if (type === "character_dossier") return { kind: "character", place: false };
  if (type !== "worldbuilding") return null;
  const kind = worldbuildingKindFromFields(fields);
  if (kind === "organization") return { kind: "faction", place: false };
  if (kind === "place") return { kind: "location", place: true };
  return null;
}

export function buildTimelineBoard(input: {
  events: readonly TimelineBoardEvent[];
  links: readonly TimelineBoardLink[];
  reveals: readonly TimelineBoardReveal[];
  edges: readonly OrderEdge[];
}): TimelineBoard {
  const events = [...input.events].sort((a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id));
  const mode = events.some((event) => event.dateKey != null) ? "date" : "order";
  const placed = placeEvents(events, mode);
  const lanes: TimelineLane[] = [];
  const marks: TimelineMark[] = [];
  const kinds: TimelineLaneKind[] = ["character", "faction", "location"];
  for (const kind of kinds) {
    const seen = new Map<string, string>();
    for (const link of input.links) {
      if (link.laneKind !== kind || seen.has(link.recordId)) continue;
      seen.set(link.recordId, link.title);
      lanes.push({ id: link.recordId, title: link.title, kind });
    }
    const byEvent = new Map<string, string[]>();
    for (const link of input.links) {
      if (link.laneKind !== kind) continue;
      const list = byEvent.get(link.eventId) ?? [];
      list.push(link.recordId);
      byEvent.set(link.eventId, list);
    }
    let unassigned = false;
    for (const event of events) {
      const ids = byEvent.get(event.id) ?? [];
      const targets = ids.length > 0 ? ids : [unassignedLaneId(kind)];
      if (ids.length === 0) unassigned = true;
      const spot = placed.get(event.id)!;
      for (const laneId of targets) {
        const age = kind === "character" && ids.includes(laneId) ? ageOnLane(event, laneId, events, input.links) : null;
        marks.push({
          eventId: event.id,
          title: event.title,
          laneKind: kind,
          laneId,
          x: spot.x,
          axis: spot.axis,
          ageYears: age?.years ?? null,
          ageName: age?.name ?? null,
        });
      }
    }
    if (unassigned) lanes.push({ id: unassignedLaneId(kind), title: "", kind });
  }
  return {
    mode,
    lanes,
    marks,
    warnings: [
      ...sameDateWarnings(events, input.links),
      ...birthWarnings(events, input.links),
      ...revealWarnings(events, input.reveals, input.edges),
    ],
  };
}

function placeEvents(
  events: readonly TimelineBoardEvent[],
  mode: "date" | "order",
): Map<string, { x: number; axis: "date" | "order" }> {
  const placed = new Map<string, { x: number; axis: "date" | "order" }>();
  if (mode === "order") {
    const span = Math.max(events.length - 1, 1);
    events.forEach((event, index) => placed.set(event.id, { x: index / span, axis: "order" }));
    return placed;
  }
  const dated = events.flatMap((event) => (event.dateKey == null ? [] : [event.dateKey]));
  const min = Math.min(...dated);
  const max = Math.max(...dated);
  const span = max - min || 1;
  const undated = events.filter((event) => event.dateKey == null);
  for (const event of events) {
    if (event.dateKey == null) continue;
    placed.set(event.id, { x: ((event.dateKey - min) / span) * 0.82, axis: "date" });
  }
  undated.forEach((event, index) => {
    const slot = undated.length <= 1 ? 1 : index / (undated.length - 1);
    placed.set(event.id, { x: 0.86 + slot * 0.14, axis: "order" });
  });
  return placed;
}

function isBirth(event: TimelineBoardEvent): boolean {
  return BIRTH.test(`${event.title}\n${event.summary}`);
}

function ageOnLane(
  event: TimelineBoardEvent,
  characterId: string,
  events: readonly TimelineBoardEvent[],
  links: readonly TimelineBoardLink[],
): { years: number; name: string } | null {
  if (event.dateKey == null || isBirth(event)) return null;
  const births = birthKeys(characterId, events, links);
  const earlier = births.filter((birth) => birth.dateKey <= event.dateKey!);
  if (earlier.length === 0) return null;
  const birth = earlier.reduce((best, item) => (item.dateKey < best.dateKey ? item : best));
  const link = links.find((item) => item.recordId === characterId);
  return { years: Math.floor((event.dateKey - birth.dateKey) / 10_000), name: link?.title ?? "" };
}

function birthKeys(
  characterId: string,
  events: readonly TimelineBoardEvent[],
  links: readonly TimelineBoardLink[],
): { eventId: string; dateKey: number; title: string }[] {
  const ids = new Set(links.filter((link) => link.recordId === characterId && link.laneKind === "character").map((link) => link.eventId));
  return events.flatMap((event) => {
    if (!ids.has(event.id) || event.dateKey == null || !isBirth(event)) return [];
    return [{ eventId: event.id, dateKey: event.dateKey, title: event.title }];
  });
}

function sameDateWarnings(events: readonly TimelineBoardEvent[], links: readonly TimelineBoardLink[]): TimelineWarning[] {
  const warnings: TimelineWarning[] = [];
  const characters = uniqueCharacters(links);
  for (const character of characters) {
    const eventIds = new Set(
      links.filter((link) => link.recordId === character.recordId && link.laneKind === "character").map((link) => link.eventId),
    );
    const byDate = new Map<number, TimelineBoardEvent[]>();
    for (const event of events) {
      if (!eventIds.has(event.id) || event.dateKey == null) continue;
      const list = byDate.get(event.dateKey) ?? [];
      list.push(event);
      byDate.set(event.dateKey, list);
    }
    for (const group of byDate.values()) {
      const ids = new Set(group.map((event) => event.id));
      const places = new Map<string, string>();
      for (const link of links) {
        if (!link.place || !ids.has(link.eventId)) continue;
        places.set(link.recordId, link.title);
      }
      if (places.size < 2) continue;
      warnings.push({ kind: "same_date", character: character.title, places: [...places.values()] });
    }
  }
  return warnings;
}

function birthWarnings(events: readonly TimelineBoardEvent[], links: readonly TimelineBoardLink[]): TimelineWarning[] {
  const warnings: TimelineWarning[] = [];
  for (const character of uniqueCharacters(links)) {
    const births = birthKeys(character.recordId, events, links);
    if (births.length === 0) continue;
    const earliest = births.reduce((best, item) => (item.dateKey < best.dateKey ? item : best));
    const ids = new Set(
      links.filter((link) => link.recordId === character.recordId && link.laneKind === "character").map((link) => link.eventId),
    );
    for (const event of events) {
      if (!ids.has(event.id) || event.id === earliest.eventId || event.dateKey == null) continue;
      if (event.dateKey < earliest.dateKey) {
        warnings.push({ kind: "before_birth", character: character.title, birthTitle: earliest.title });
      }
    }
  }
  return warnings;
}

function revealWarnings(
  events: readonly TimelineBoardEvent[],
  reveals: readonly TimelineBoardReveal[],
  edges: readonly OrderEdge[],
): TimelineWarning[] {
  const warnings: TimelineWarning[] = [];
  const seen = new Set<string>();
  const drafts = new Set(reveals.map((reveal) => reveal.draftId));
  for (const draftId of drafts) {
    const inDraft = reveals.filter((reveal) => reveal.draftId === draftId);
    for (let i = 0; i < events.length; i += 1) {
      for (let j = i + 1; j < events.length; j += 1) {
        const left = events[i]!;
        const right = events[j]!;
        const relation = orderRelation(edges, left.id, right.id);
        if (relation !== "before" && relation !== "after") continue;
        const earlier = relation === "before" ? left : right;
        const later = relation === "before" ? right : left;
        const earlierReveal = earliestReveal(inDraft, earlier.id);
        const laterReveal = earliestReveal(inDraft, later.id);
        if (!earlierReveal || !laterReveal || laterReveal.bookIndex >= earlierReveal.bookIndex) continue;
        if (taggedFlashback(earlier, earlierReveal.title) || taggedFlashback(later, laterReveal.title)) continue;
        const id = `${earlier.id}:${later.id}`;
        if (seen.has(id)) continue;
        seen.add(id);
        warnings.push({ kind: "reveal_order", earlierTitle: earlier.title, laterTitle: later.title });
      }
    }
  }
  return warnings;
}

function earliestReveal(reveals: readonly TimelineBoardReveal[], eventId: string): TimelineBoardReveal | null {
  const hits = reveals.filter((reveal) => reveal.eventId === eventId).sort((a, b) => a.bookIndex - b.bookIndex);
  return hits[0] ?? null;
}

function taggedFlashback(event: TimelineBoardEvent, revealTitle: string): boolean {
  return FLASHBACK.test(revealTitle) || FLASHBACK.test(event.title) || FLASHBACK.test(event.summary);
}

function uniqueCharacters(links: readonly TimelineBoardLink[]): { recordId: string; title: string }[] {
  const seen = new Map<string, string>();
  for (const link of links) {
    if (link.laneKind === "character" && !seen.has(link.recordId)) seen.set(link.recordId, link.title);
  }
  return [...seen.entries()].map(([recordId, title]) => ({ recordId, title }));
}
