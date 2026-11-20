import { RECORD_TYPE_LABELS, isRecordType } from "@/domain/recordTypes";
import { excerptAt, searchManuscript, searchProjectRecords } from "./searchService";
import type { DbOrTx } from "../db";

export type UnifiedSearchSource =
  | "record"
  | "manuscript"
  | "weave_beat"
  | "map_pin"
  | "map"
  | "story_event"
  | "established_fact";

export interface UnifiedProjectSearchHit {
  id: string;
  source: UnifiedSearchSource;
  title: string;
  subtitle: string | null;
  matchedIn: string;
  excerpt: string;
  href: string;
}

const LIMIT_PER_SOURCE = 40;

function matchText(text: string, query: string): { matchedIn: string; excerpt: string } | null {
  const title = excerptAt(text, query);
  if (title) return { matchedIn: "text", excerpt: title.excerpt };
  return null;
}

/**
 * Read-only project search across records, manuscript, Weave beats, map labels,
 * story events, and established-fact statements. Trashed records are excluded.
 */
export async function searchUnifiedProject(
  db: DbOrTx,
  input: {
    projectId: string;
    query: string;
    hasDrafts?: boolean;
    draftId?: string | null;
  },
): Promise<UnifiedProjectSearchHit[]> {
  const query = input.query.normalize("NFC").trim();
  if (!query) return [];
  const base = `/projects/${encodeURIComponent(input.projectId)}`;
  const hits: UnifiedProjectSearchHit[] = [];

  const [recordHits, manuscript] = await Promise.all([
    searchProjectRecords(db, { projectId: input.projectId, query, includeManuscript: false }),
    searchManuscript(db, {
      projectId: input.projectId,
      query,
      matchCase: false,
      hasDrafts: input.hasDrafts,
      draftId: input.draftId,
    }),
  ]);

  for (const row of recordHits) {
    if (hits.length >= LIMIT_PER_SOURCE * 7) break;
    const isManuscript = row.type === "manuscript_chapter" || row.type === "manuscript_scene" || row.type === "scene_note";
    hits.push({
      id: row.id,
      source: isManuscript ? "manuscript" : "record",
      title: row.title,
      subtitle: isRecordType(row.type) ? RECORD_TYPE_LABELS[row.type] : null,
      matchedIn: row.matchedIn,
      excerpt: row.excerpt,
      href: `${base}/records/${encodeURIComponent(row.id)}`,
    });
    if (hits.filter((h) => h.source === "record" || h.source === "manuscript").length >= LIMIT_PER_SOURCE) break;
  }

  for (const row of manuscript.hits) {
    if (hits.filter((h) => h.source === "manuscript").length >= LIMIT_PER_SOURCE) break;
    if (hits.some((h) => h.id === row.id && h.source === "manuscript")) continue;
    const excerpt = row.excerpts[0]?.before
      ? `${row.excerpts[0].before}${row.excerpts[0].match}${row.excerpts[0].after}`
      : row.title;
    hits.push({
      id: row.id,
      source: "manuscript",
      title: row.title,
      subtitle: row.parentTitle ? `${RECORD_TYPE_LABELS[row.type]} · ${row.parentTitle}` : RECORD_TYPE_LABELS[row.type],
      matchedIn: row.titleMatches ? "title" : "body",
      excerpt: excerpt.slice(0, 240),
      href: `${base}/records/${encodeURIComponent(row.id)}?${new URLSearchParams({ find: query })}`,
    });
  }

  const beats = await db.weaveBeat.findMany({
    where: { projectId: input.projectId },
    orderBy: [{ title: "asc" }, { id: "asc" }],
    select: { id: true, title: true, body: true, gridId: true, grid: { select: { title: true } } },
    take: 500,
  });
  for (const beat of beats) {
    if (hits.filter((h) => h.source === "weave_beat").length >= LIMIT_PER_SOURCE) break;
    const title = matchText(beat.title, query);
    const body = title ? null : matchText(beat.body, query);
    const match = title ?? body;
    if (!match) continue;
    hits.push({
      id: beat.id,
      source: "weave_beat",
      title: beat.title,
      subtitle: beat.grid.title,
      matchedIn: title ? "title" : "body",
      excerpt: match.excerpt,
      href: `${base}/plan/weave/${encodeURIComponent(beat.gridId)}`,
    });
  }

  const maps = await db.worldMap.findMany({
    where: { projectId: input.projectId, image: { record: { trashedAt: null } } },
    orderBy: [{ title: "asc" }, { id: "asc" }],
    select: { id: true, title: true },
  });
  for (const map of maps) {
    if (hits.filter((h) => h.source === "map").length >= LIMIT_PER_SOURCE) break;
    const match = matchText(map.title, query);
    if (!match) continue;
    hits.push({
      id: map.id,
      source: "map",
      title: map.title,
      subtitle: null,
      matchedIn: "title",
      excerpt: match.excerpt,
      href: `${base}/world/maps/${encodeURIComponent(map.id)}`,
    });
  }

  const pins = await db.worldMapPin.findMany({
    where: { projectId: input.projectId, map: { image: { record: { trashedAt: null } } } },
    orderBy: [{ label: "asc" }, { id: "asc" }],
    select: {
      id: true,
      label: true,
      mapId: true,
      recordId: true,
      map: { select: { title: true } },
      record: { select: { id: true, title: true, trashedAt: true } },
    },
    take: 500,
  });
  for (const pin of pins) {
    if (hits.filter((h) => h.source === "map_pin").length >= LIMIT_PER_SOURCE) break;
    const fields = [pin.label, pin.map.title, pin.record && !pin.record.trashedAt ? pin.record.title : ""].filter(Boolean);
    const matchField = fields.find((text) => excerptAt(text, query));
    if (!matchField) continue;
    const ex = excerptAt(matchField, query)!;
    hits.push({
      id: pin.id,
      source: "map_pin",
      title: pin.label || pin.record?.title || pin.map.title,
      subtitle: pin.map.title,
      matchedIn: matchField === pin.label ? "label" : matchField === pin.map.title ? "map title" : "linked record",
      excerpt: ex.excerpt,
      href: `${base}/world/maps/${encodeURIComponent(pin.mapId)}`,
    });
  }

  const events = await db.storyEvent.findMany({
    where: { projectId: input.projectId },
    orderBy: [{ title: "asc" }, { id: "asc" }],
    select: { id: true, title: true, summary: true, timeLabel: true },
    take: 300,
  });
  for (const event of events) {
    if (hits.filter((h) => h.source === "story_event").length >= LIMIT_PER_SOURCE) break;
    const title = matchText(event.title, query);
    const summary = title ? null : matchText(event.summary, query);
    const time = title || summary ? null : event.timeLabel ? matchText(event.timeLabel, query) : null;
    const match = title ?? summary ?? time;
    if (!match) continue;
    hits.push({
      id: event.id,
      source: "story_event",
      title: event.title,
      subtitle: event.timeLabel || null,
      matchedIn: title ? "title" : summary ? "summary" : "time",
      excerpt: match.excerpt,
      href: `${base}/world/events`,
    });
  }

  const facts = await db.establishedFact.findMany({
    where: { projectId: input.projectId, subject: { trashedAt: null } },
    orderBy: [{ statement: "asc" }, { id: "asc" }],
    select: {
      id: true,
      statement: true,
      subjectRecordId: true,
      subject: { select: { title: true } },
    },
    take: 500,
  });
  for (const fact of facts) {
    if (hits.filter((h) => h.source === "established_fact").length >= LIMIT_PER_SOURCE) break;
    const match = matchText(fact.statement, query);
    if (!match) continue;
    hits.push({
      id: fact.id,
      source: "established_fact",
      title: fact.subject.title,
      subtitle: null,
      matchedIn: "statement",
      excerpt: match.excerpt,
      href: `${base}/records/${encodeURIComponent(fact.subjectRecordId)}`,
    });
  }

  hits.sort((a, b) => a.title.localeCompare(b.title) || a.source.localeCompare(b.source));
  return hits;
}