import { newId } from "@/domain/ids";
import { sha256 } from "@/domain/json";
import { errorIssue } from "@/domain/issues";
import { isLinkableReferenceType, isRecordType } from "@/domain/recordTypes";
import {
  formatStructuredDate,
  structuredDateFromRow,
  structuredDateIsComplete,
  type StructuredDateParts,
} from "@/world/calendarDate";
import { dateConflictWarningsForEvent, type DateConflictWarning } from "@/world/storyEventDates";
import { chronologicalIds, orderWouldCycle, type OrderEdge } from "@/world/storyOrder";
import {
  calendarDefs,
  loadWorldCalendar,
  parseStructuredDateInput,
  type ParsedStructuredDateInput,
  type WorldCalendarView,
} from "./worldCalendarService";
import { isUniqueConstraintError, type Db, type DbOrTx, type Tx } from "../db";
import { writeAudit } from "./auditService";
import { evidenceKindForSource, EVIDENCE_KIND_LABELS, type EvidenceKind } from "./establishedFactService";
import { MutationRejectedError, NotFoundError } from "./errors";

/*
 * Story events on a timeline. They are not scene locations, mentions, record
 * links, place relationships, or established facts. Order is explicit
 * earlier/later constraints. An empty time label means the time is unknown.
 * Planned events stay marked. Source passages are pinned to a revision.
 */

const UI_ACTOR = "author";
const TITLE_MAX = 200;
const SUMMARY_MAX = 4000;
const TIME_MAX = 200;

export interface StoryMapChoice {
  mapId: string;
  title: string;
  pinId: string;
}

export interface StoryEventLocationView {
  id: string;
  recordId: string;
  title: string;
  unavailable: boolean;
  maps: StoryMapChoice[];
}

export interface StoryEventSceneView {
  id: string;
  recordId: string;
  title: string;
  type: "manuscript_chapter" | "manuscript_scene";
  unavailable: boolean;
}

export interface StoryEventEvidenceView {
  id: string;
  sourceRecordId: string;
  sourceTitle: string;
  revisionNumber: number;
  passageStart: number;
  passageEnd: number;
  passageExcerpt: string;
  evidenceKind: EvidenceKind;
  evidenceKindLabel: string;
  needsRecheck: boolean;
}

export interface StoryEventOrderView {
  id: string;
  otherEventId: string;
  otherTitle: string;
  /** This event is before or after the other event. */
  direction: "before" | "after";
}

export interface StoryEventStructuredDate {
  eraId: string | null;
  year: number | null;
  monthPosition: number | null;
  day: number | null;
  /** Formatted when complete; null when unset or incomplete. */
  formatted: string | null;
}

export interface StoryEventDetail {
  id: string;
  title: string;
  summary: string;
  /** Empty when the story time is unknown. */
  timeLabel: string;
  structuredDate: StoryEventStructuredDate;
  dateWarnings: DateConflictWarning[];
  planned: boolean;
  /** all | unscoped | a manuscript draft id */
  draftScope: string;
  draftLabel: string;
  revision: number;
  locations: StoryEventLocationView[];
  scenes: StoryEventSceneView[];
  evidence: StoryEventEvidenceView[];
  orders: StoryEventOrderView[];
}

export interface StoryEventListItem {
  id: string;
  title: string;
  summary: string;
  timeLabel: string;
  structuredTime: string | null;
  planned: boolean;
  draftScope: string;
  draftLabel: string;
  revision: number;
}

export interface StoryChoice {
  id: string;
  title: string;
}

export interface StorySourceChoice extends StoryChoice {
  bodyLength: number;
}

export interface StoryTimeline {
  draft: string;
  calendar: WorldCalendarView | null;
  events: StoryEventListItem[];
  selected: StoryEventDetail | null;
  drafts: StoryChoice[];
  locationChoices: StoryChoice[];
  sceneChoices: StoryChoice[];
  sourceChoices: StorySourceChoice[];
}

export interface PlaceEventItem {
  id: string;
  title: string;
  planned: boolean;
  timeLabel: string;
}

function rejected(message: string): MutationRejectedError {
  return new MutationRejectedError([errorIssue("INVALID_REFERENCE", message)]);
}

function stale(): MutationRejectedError {
  return new MutationRejectedError([
    errorIssue("STALE_REVISION", "This event was saved again after you started. The change was not applied."),
  ]);
}

function cleanTitle(title: string): string {
  const value = title.trim();
  if (!value || value.length > TITLE_MAX) throw rejected("Enter a title up to 200 characters.");
  return value;
}

function cleanSummary(summary: string): string {
  const value = summary.trim();
  if (value.length > SUMMARY_MAX) throw rejected("The summary is too long.");
  return value;
}

function cleanTime(timeLabel: string): string {
  const value = timeLabel.trim();
  if (value.length > TIME_MAX) throw rejected("The time text is too long.");
  return value;
}

function structView(
  parts: StructuredDateParts,
  months: ReturnType<typeof calendarDefs>["months"],
  eras: ReturnType<typeof calendarDefs>["eras"],
): StoryEventStructuredDate {
  return {
    eraId: parts.eraId,
    year: parts.year,
    monthPosition: parts.monthPosition,
    day: parts.day,
    formatted: formatStructuredDate(parts, months, eras),
  };
}

function listStructuredTime(
  event: {
    structEraId: string | null;
    structYear: number | null;
    structMonthPosition: number | null;
    structDay: number | null;
  },
  months: ReturnType<typeof calendarDefs>["months"],
  eras: ReturnType<typeof calendarDefs>["eras"],
): string | null {
  const parts = structuredDateFromRow(event);
  if (!structuredDateIsComplete(parts, months, eras)) return null;
  return formatStructuredDate(parts, months, eras);
}

function structData(parts: ParsedStructuredDateInput) {
  return {
    structEraId: parts.eraId,
    structYear: parts.year,
    structMonthPosition: parts.monthPosition,
    structDay: parts.day,
  };
}

async function requireDraftScope(tx: Tx, projectId: string, draftScope: string): Promise<string> {
  if (draftScope === "all" || draftScope === "unscoped") return draftScope;
  const draft = await tx.manuscriptDraft.findFirst({ where: { id: draftScope, projectId }, select: { id: true } });
  if (!draft) throw rejected("Choose a draft that belongs to this project.");
  return draft.id;
}

async function requireEvent(tx: Tx, projectId: string, eventId: string, expectedRevision: number) {
  const event = await tx.storyEvent.findFirst({ where: { id: eventId, projectId } });
  if (!event) throw new NotFoundError(`Story event ${eventId} not found`);
  if (event.revision !== expectedRevision) throw stale();
  return event;
}

async function bump(tx: Tx, eventId: string) {
  await tx.storyEvent.update({ where: { id: eventId }, data: { revision: { increment: 1 } } });
}

function draftLabel(scope: string, drafts: Map<string, string>): string {
  if (scope === "all") return "All drafts";
  if (scope === "unscoped") return "Unscoped manuscript";
  return drafts.get(scope) ?? "Missing draft";
}

function visibleInDraft(scope: string, draft: string): boolean {
  if (draft === "all" || scope === "all") return true;
  return scope === draft;
}

export async function loadStoryTimeline(
  db: DbOrTx,
  projectId: string,
  options?: { draft?: string; eventId?: string | null },
): Promise<StoryTimeline> {
  const draft = options?.draft || "all";
  await refreshStaleStoryEvidence(db, projectId);
  const calendar = await loadWorldCalendar(db, projectId);
  const { months, eras } = calendarDefs(calendar);
  const [events, drafts, locations, scenes, sources, orders] = await Promise.all([
    db.storyEvent.findMany({ where: { projectId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    db.manuscriptDraft.findMany({
      where: { projectId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, label: true },
    }),
    db.record.findMany({
      where: { projectId, trashedAt: null },
      select: { id: true, title: true, type: true },
      orderBy: [{ title: "asc" }, { id: "asc" }],
    }),
    db.record.findMany({
      where: { projectId, trashedAt: null, type: { in: ["manuscript_chapter", "manuscript_scene"] } },
      select: { id: true, title: true },
      orderBy: [{ title: "asc" }, { id: "asc" }],
    }),
    db.record.findMany({
      where: {
        projectId,
        trashedAt: null,
        type: { in: ["manuscript_chapter", "manuscript_scene", "chapter_outline", "story_architecture"] },
      },
      select: { id: true, title: true, type: true, body: true },
      orderBy: [{ title: "asc" }, { id: "asc" }],
    }),
    db.storyEventOrder.findMany({ where: { projectId }, select: { earlierEventId: true, laterEventId: true } }),
  ]);
  const draftNames = new Map(drafts.map((item) => [item.id, item.label]));
  const edges: OrderEdge[] = orders.map((order) => ({ earlierId: order.earlierEventId, laterId: order.laterEventId }));
  const orderedIds = chronologicalIds(
    events.map((event) => ({ id: event.id, createdAt: event.createdAt.getTime() })),
    edges,
  );
  const byId = new Map(events.map((event) => [event.id, event]));
  const list = orderedIds.flatMap((id) => {
    const event = byId.get(id);
    if (!event || !visibleInDraft(event.draftScope, draft)) return [];
    return [
      {
        id: event.id,
        title: event.title,
        summary: event.summary,
        timeLabel: event.timeLabel,
        structuredTime: listStructuredTime(event, months, eras),
        planned: event.planned,
        draftScope: event.draftScope,
        draftLabel: draftLabel(event.draftScope, draftNames),
        revision: event.revision,
      },
    ];
  });
  const selectedId = options?.eventId && list.some((event) => event.id === options.eventId) ? options.eventId : (list[0]?.id ?? null);
  return {
    draft,
    calendar,
    events: list,
    selected: selectedId
      ? await eventDetail(db, projectId, selectedId, draftNames, calendar, events, orders)
      : null,
    drafts: drafts.map((item) => ({ id: item.id, title: item.label })),
    locationChoices: locations.flatMap((record) => {
      if (!isRecordType(record.type) || !isLinkableReferenceType(record.type)) return [];
      return [{ id: record.id, title: record.title }];
    }),
    sceneChoices: scenes.map((record) => ({ id: record.id, title: record.title })),
    sourceChoices: sources.flatMap((record) => {
      if (!isRecordType(record.type)) return [];
      return [{ id: record.id, title: record.title, bodyLength: record.body.length }];
    }),
  };
}

async function eventDetail(
  db: DbOrTx,
  projectId: string,
  eventId: string,
  draftNames: Map<string, string>,
  calendar: WorldCalendarView | null,
  peerEvents: {
    id: string;
    title: string;
    structEraId: string | null;
    structYear: number | null;
    structMonthPosition: number | null;
    structDay: number | null;
  }[],
  orders: { earlierEventId: string; laterEventId: string }[],
): Promise<StoryEventDetail | null> {
  const event = await db.storyEvent.findFirst({ where: { id: eventId, projectId } });
  if (!event) return null;
  const { months, eras } = calendarDefs(calendar);
  const parts = structuredDateFromRow(event);
  const [locations, scenes, evidence, earlier, later] = await Promise.all([
    db.storyEventLocation.findMany({
      where: { eventId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { location: { select: { id: true, title: true, trashedAt: true } } },
    }),
    db.storyEventScene.findMany({
      where: { eventId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { manuscript: { select: { id: true, title: true, type: true, trashedAt: true } } },
    }),
    db.storyEventEvidence.findMany({
      where: { eventId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { source: { select: { id: true, title: true, trashedAt: true } } },
    }),
    db.storyEventOrder.findMany({
      where: { earlierEventId: eventId },
      include: { later: { select: { id: true, title: true } } },
    }),
    db.storyEventOrder.findMany({
      where: { laterEventId: eventId },
      include: { earlier: { select: { id: true, title: true } } },
    }),
  ]);
  const locationIds = locations.map((row) => row.locationRecordId);
  const pins = locationIds.length
    ? await db.worldMapPin.findMany({
        where: { projectId, recordId: { in: locationIds }, map: { image: { record: { trashedAt: null } } } },
        select: { id: true, recordId: true, mapId: true, map: { select: { title: true } } },
        orderBy: [{ map: { title: "asc" } }, { id: "asc" }],
      })
    : [];
  const mapsByRecord = new Map<string, StoryMapChoice[]>();
  for (const pin of pins) {
    if (!pin.recordId) continue;
    const list = mapsByRecord.get(pin.recordId) ?? [];
    list.push({ mapId: pin.mapId, title: pin.map.title, pinId: pin.id });
    mapsByRecord.set(pin.recordId, list);
  }
  return {
    id: event.id,
    title: event.title,
    summary: event.summary,
    timeLabel: event.timeLabel,
    structuredDate: structView(parts, months, eras),
    dateWarnings: dateConflictWarningsForEvent(event.id, parts, orders, peerEvents, months, eras),
    planned: event.planned,
    draftScope: event.draftScope,
    draftLabel: draftLabel(event.draftScope, draftNames),
    revision: event.revision,
    locations: locations.map((row) => ({
      id: row.id,
      recordId: row.location.id,
      title: row.location.title,
      unavailable: row.location.trashedAt !== null,
      maps: mapsByRecord.get(row.locationRecordId) ?? [],
    })),
    scenes: scenes.flatMap((row) => {
      if (row.manuscript.type !== "manuscript_chapter" && row.manuscript.type !== "manuscript_scene") return [];
      return [
        {
          id: row.id,
          recordId: row.manuscript.id,
          title: row.manuscript.title,
          type: row.manuscript.type,
          unavailable: row.manuscript.trashedAt !== null,
        },
      ];
    }),
    evidence: evidence.flatMap((row) => {
      if (row.source.trashedAt) return [];
      if (row.evidenceKind !== "planned" && row.evidenceKind !== "zero_draft" && row.evidenceKind !== "author_rewrite") return [];
      return [
        {
          id: row.id,
          sourceRecordId: row.source.id,
          sourceTitle: row.source.title,
          revisionNumber: row.revisionNumber,
          passageStart: row.passageStart,
          passageEnd: row.passageEnd,
          passageExcerpt: row.passageExcerpt,
          evidenceKind: row.evidenceKind,
          evidenceKindLabel: EVIDENCE_KIND_LABELS[row.evidenceKind],
          needsRecheck: row.needsRecheck,
        },
      ];
    }),
    orders: [
      ...earlier.map((row) => ({
        id: row.id,
        otherEventId: row.later.id,
        otherTitle: row.later.title,
        direction: "before" as const,
      })),
      ...later.map((row) => ({
        id: row.id,
        otherEventId: row.earlier.id,
        otherTitle: row.earlier.title,
        direction: "after" as const,
      })),
    ],
  };
}

export async function listEventsForLocation(db: DbOrTx, projectId: string, locationRecordId: string): Promise<PlaceEventItem[]> {
  const timeline = await loadStoryTimeline(db, projectId, { draft: "all" });
  const linked = await db.storyEventLocation.findMany({
    where: { projectId, locationRecordId },
    select: { eventId: true },
  });
  const ids = new Set(linked.map((row) => row.eventId));
  return timeline.events.flatMap((event) => {
    if (!ids.has(event.id)) return [];
    return [{ id: event.id, title: event.title, planned: event.planned, timeLabel: event.timeLabel }];
  });
}

export async function createStoryEvent(
  db: Db,
  projectId: string,
  input: {
    title: string;
    summary?: string;
    timeLabel?: string;
    planned?: boolean;
    draftScope?: string;
    structuredDate?: ParsedStructuredDateInput;
  },
): Promise<{ id: string }> {
  const title = cleanTitle(input.title);
  const summary = cleanSummary(input.summary ?? "");
  const timeLabel = cleanTime(input.timeLabel ?? "");
  const planned = input.planned === true;
  const structured =
    input.structuredDate ??
    ({ eraId: null, year: null, monthPosition: null, day: null } satisfies ParsedStructuredDateInput);
  return db.$transaction(async (tx) => {
    const project = await tx.project.findFirst({ where: { id: projectId, trashedAt: null }, select: { id: true } });
    if (!project) throw new NotFoundError(`Project ${projectId} not found`);
    const draftScope = await requireDraftScope(tx, projectId, input.draftScope ?? "all");
    const id = newId("sev");
    await tx.storyEvent.create({
      data: { id, projectId, title, summary, timeLabel, planned, draftScope, revision: 0, ...structData(structured) },
    });
    await writeAudit(tx, {
      projectId,
      action: "story_event.create",
      actor: UI_ACTOR,
      summary: `Created story event "${title}"`,
      details: { eventId: id, planned, draftScope },
    });
    return { id };
  });
}

export async function updateStoryEvent(
  db: Db,
  projectId: string,
  eventId: string,
  input: {
    title: string;
    summary: string;
    timeLabel: string;
    planned: boolean;
    draftScope: string;
    expectedRevision: number;
    structuredDate: ParsedStructuredDateInput;
  },
): Promise<void> {
  const title = cleanTitle(input.title);
  const summary = cleanSummary(input.summary);
  const timeLabel = cleanTime(input.timeLabel);
  await db.$transaction(async (tx) => {
    await requireEvent(tx, projectId, eventId, input.expectedRevision);
    const draftScope = await requireDraftScope(tx, projectId, input.draftScope);
    await tx.storyEvent.update({
      where: { id: eventId },
      data: {
        title,
        summary,
        timeLabel,
        planned: input.planned,
        draftScope,
        revision: { increment: 1 },
        ...structData(input.structuredDate),
      },
    });
    await writeAudit(tx, {
      projectId,
      action: "story_event.update",
      actor: UI_ACTOR,
      summary: `Updated story event "${title}"`,
      details: { eventId, planned: input.planned, draftScope },
    });
  });
}

async function requireLocation(tx: Tx, projectId: string, recordId: string) {
  const record = await tx.record.findFirst({
    where: { id: recordId, projectId, trashedAt: null },
    select: { id: true, type: true, title: true },
  });
  if (!record || !isRecordType(record.type) || !isLinkableReferenceType(record.type)) {
    throw rejected("Choose a reference in this project.");
  }
  return record;
}

async function requireScene(tx: Tx, projectId: string, recordId: string) {
  const record = await tx.record.findFirst({
    where: { id: recordId, projectId, trashedAt: null },
    select: { id: true, type: true, title: true },
  });
  if (!record || (record.type !== "manuscript_chapter" && record.type !== "manuscript_scene")) {
    throw rejected("Choose a chapter or scene in this project.");
  }
  return record;
}

export async function linkStoryEventLocation(
  db: Db,
  projectId: string,
  eventId: string,
  locationRecordId: string,
  expectedRevision: number,
): Promise<void> {
  try {
    await db.$transaction(async (tx) => {
      await requireEvent(tx, projectId, eventId, expectedRevision);
      const location = await requireLocation(tx, projectId, locationRecordId);
      await tx.storyEventLocation.create({
        data: { id: newId("evl"), eventId, projectId, locationRecordId },
      });
      await bump(tx, eventId);
      await writeAudit(tx, {
        projectId,
        action: "story_event.link_location",
        actor: UI_ACTOR,
        summary: `Linked "${location.title}" to a story event`,
        details: { eventId, locationRecordId },
      });
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw rejected("That place is already linked to this event.");
    throw error;
  }
}

export async function unlinkStoryEventLocation(
  db: Db,
  projectId: string,
  eventId: string,
  linkId: string,
  expectedRevision: number,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await requireEvent(tx, projectId, eventId, expectedRevision);
    const link = await tx.storyEventLocation.findFirst({ where: { id: linkId, eventId, projectId } });
    if (!link) throw rejected("That place is not linked to this event.");
    await tx.storyEventLocation.delete({ where: { id: linkId } });
    await bump(tx, eventId);
    await writeAudit(tx, {
      projectId,
      action: "story_event.unlink_location",
      actor: UI_ACTOR,
      summary: "Removed a place from a story event",
      details: { eventId, locationRecordId: link.locationRecordId },
    });
  });
}

export async function linkStoryEventScene(
  db: Db,
  projectId: string,
  eventId: string,
  manuscriptRecordId: string,
  expectedRevision: number,
): Promise<void> {
  try {
    await db.$transaction(async (tx) => {
      await requireEvent(tx, projectId, eventId, expectedRevision);
      const scene = await requireScene(tx, projectId, manuscriptRecordId);
      await tx.storyEventScene.create({
        data: { id: newId("evs"), eventId, projectId, manuscriptRecordId },
      });
      await bump(tx, eventId);
      await writeAudit(tx, {
        projectId,
        action: "story_event.link_scene",
        actor: UI_ACTOR,
        summary: `"${scene.title}" reveals a story event`,
        details: { eventId, manuscriptRecordId },
      });
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw rejected("That chapter or scene already reveals this event.");
    throw error;
  }
}

export async function unlinkStoryEventScene(
  db: Db,
  projectId: string,
  eventId: string,
  linkId: string,
  expectedRevision: number,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await requireEvent(tx, projectId, eventId, expectedRevision);
    const link = await tx.storyEventScene.findFirst({ where: { id: linkId, eventId, projectId } });
    if (!link) throw rejected("That chapter or scene does not reveal this event.");
    await tx.storyEventScene.delete({ where: { id: linkId } });
    await bump(tx, eventId);
    await writeAudit(tx, {
      projectId,
      action: "story_event.unlink_scene",
      actor: UI_ACTOR,
      summary: "Removed a revealing scene from a story event",
      details: { eventId, manuscriptRecordId: link.manuscriptRecordId },
    });
  });
}

export async function orderStoryEvents(
  db: Db,
  projectId: string,
  input: { eventId: string; otherEventId: string; direction: "before" | "after"; expectedRevision: number },
): Promise<void> {
  const earlierEventId = input.direction === "before" ? input.eventId : input.otherEventId;
  const laterEventId = input.direction === "before" ? input.otherEventId : input.eventId;
  if (earlierEventId === laterEventId) throw rejected("An event cannot come before itself.");
  try {
    await db.$transaction(async (tx) => {
      const selected = await requireEvent(tx, projectId, input.eventId, input.expectedRevision);
      const other = await tx.storyEvent.findFirst({ where: { id: input.otherEventId, projectId } });
      if (!other) throw rejected("Choose another event in this project.");
      const existing = await tx.storyEventOrder.findMany({
        where: { projectId },
        select: { earlierEventId: true, laterEventId: true },
      });
      const edges = existing.map((row) => ({ earlierId: row.earlierEventId, laterId: row.laterEventId }));
      if (orderWouldCycle(edges, earlierEventId, laterEventId)) {
        throw rejected("That order would make a circle.");
      }
      await tx.storyEventOrder.create({
        data: { id: newId("evo"), projectId, earlierEventId, laterEventId },
      });
      await bump(tx, input.eventId);
      const earlierTitle = input.direction === "before" ? selected.title : other.title;
      const laterTitle = input.direction === "before" ? other.title : selected.title;
      await writeAudit(tx, {
        projectId,
        action: "story_event.order",
        actor: UI_ACTOR,
        summary: `"${earlierTitle}" is before "${laterTitle}"`,
        details: { earlierEventId, laterEventId },
      });
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw rejected("That order is already recorded.");
    throw error;
  }
}

export async function removeStoryEventOrder(
  db: Db,
  projectId: string,
  eventId: string,
  orderId: string,
  expectedRevision: number,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await requireEvent(tx, projectId, eventId, expectedRevision);
    const order = await tx.storyEventOrder.findFirst({
      where: { id: orderId, projectId, OR: [{ earlierEventId: eventId }, { laterEventId: eventId }] },
    });
    if (!order) throw rejected("That order is not on this event.");
    await tx.storyEventOrder.delete({ where: { id: orderId } });
    await bump(tx, eventId);
    await writeAudit(tx, {
      projectId,
      action: "story_event.unorder",
      actor: UI_ACTOR,
      summary: "Removed a story-event order",
      details: { eventId, orderId },
    });
  });
}

export async function addStoryEventEvidence(
  db: Db,
  projectId: string,
  eventId: string,
  input: { sourceRecordId: string; passageStart: number; passageEnd: number; expectedRevision: number },
): Promise<void> {
  await db.$transaction(async (tx) => {
    await requireEvent(tx, projectId, eventId, input.expectedRevision);
    const source = await tx.record.findFirst({
      where: { id: input.sourceRecordId, projectId, trashedAt: null },
      select: { id: true, title: true, type: true, body: true, currentRevision: true },
    });
    if (!source || !isRecordType(source.type)) throw rejected("Choose a source in this project.");
    const kind = await evidenceKindForSource(tx, projectId, source.id);
    const start = Math.max(0, Math.min(source.body.length, Math.floor(input.passageStart)));
    const end = Math.max(start, Math.min(source.body.length, Math.floor(input.passageEnd)));
    const excerpt = source.body.slice(start, end);
    if (!excerpt.trim()) throw rejected("Choose a passage in the source.");
    await tx.storyEventEvidence.create({
      data: {
        id: newId("eve"),
        eventId,
        projectId,
        sourceRecordId: source.id,
        revisionNumber: source.currentRevision,
        passageStart: start,
        passageEnd: end,
        passageExcerpt: excerpt,
        contentHash: sha256(excerpt),
        evidenceKind: kind,
        needsRecheck: false,
      },
    });
    await bump(tx, eventId);
    await writeAudit(tx, {
      projectId,
      action: "story_event.evidence",
      actor: UI_ACTOR,
      summary: `Pinned a passage from "${source.title}" to a story event`,
      details: { eventId, sourceRecordId: source.id, revisionNumber: source.currentRevision },
    });
  });
}

export async function removeStoryEventEvidence(
  db: Db,
  projectId: string,
  eventId: string,
  evidenceId: string,
  expectedRevision: number,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await requireEvent(tx, projectId, eventId, expectedRevision);
    const row = await tx.storyEventEvidence.findFirst({ where: { id: evidenceId, eventId, projectId } });
    if (!row) throw rejected("That passage is not on this event.");
    await tx.storyEventEvidence.delete({ where: { id: evidenceId } });
    await bump(tx, eventId);
    await writeAudit(tx, {
      projectId,
      action: "story_event.evidence_remove",
      actor: UI_ACTOR,
      summary: "Removed a pinned passage from a story event",
      details: { eventId, evidenceId },
    });
  });
}

export async function refreshStaleStoryEvidence(db: DbOrTx, projectId: string): Promise<number> {
  const evidence = await db.storyEventEvidence.findMany({
    where: { projectId, needsRecheck: false },
    select: { id: true, sourceRecordId: true, revisionNumber: true },
  });
  if (!evidence.length) return 0;
  const sources = await db.record.findMany({
    where: { id: { in: [...new Set(evidence.map((row) => row.sourceRecordId))] }, projectId },
    select: { id: true, currentRevision: true },
  });
  const rev = new Map(sources.map((source) => [source.id, source.currentRevision]));
  const staleIds = evidence.filter((row) => (rev.get(row.sourceRecordId) ?? 0) > row.revisionNumber).map((row) => row.id);
  if (!staleIds.length) return 0;
  await db.storyEventEvidence.updateMany({ where: { id: { in: staleIds } }, data: { needsRecheck: true } });
  return staleIds.length;
}

/** Called with fact evidence when a cited source gains a new revision. */
export async function markStoryEvidenceNeedsRecheckForSourceInTx(
  tx: Tx,
  projectId: string,
  sourceRecordId: string,
  newRevision: number,
): Promise<void> {
  await tx.storyEventEvidence.updateMany({
    where: { projectId, sourceRecordId, revisionNumber: { lt: newRevision }, needsRecheck: false },
    data: { needsRecheck: true },
  });
}
