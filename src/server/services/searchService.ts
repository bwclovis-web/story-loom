import { parseJsonObject } from "@/domain/json";
import { isLinkableReferenceType, isRecordType, MANUSCRIPT_TYPES, type RecordType } from "@/domain/recordTypes";
import { isAuthorityStatus, type AuthorityStatus } from "@/domain/statuses";
import { buildManuscriptTree } from "@/ui/manuscriptTree";
import { aliasesOf } from "@/writing/crossRefs";
import { findMatches } from "@/writing/findReplace";
import { listSections } from "@/writing/sections";
import { searchText, type Excerpt } from "@/writing/textSearch";
import type { SeriesHomeRef } from "@/world/seriesHome";
import type { DbOrTx } from "../db";
import { listSeriesSharedRecords } from "./seriesBibleService";

/** Excerpt window. Hits say when the source text is longer than this. */
export const SEARCH_EXCERPT_CHARS = 240;

export interface SearchHit {
  id: string;
  projectId: string;
  type: RecordType;
  title: string;
  authorityStatus: AuthorityStatus;
  protected: boolean;
  currentRevision: number;
  matchedIn: "title" | "body" | "fields";
  excerpt: string;
  /** True when the matched text is longer than the excerpt window. The full text is not included. */
  excerptTruncated: boolean;
  excerptLimit: number;
  /** Set when the hit lives in another book of this series. */
  seriesHome?: SeriesHomeRef;
}

/**
 * Case-insensitive substring search over title, body, and the stored fields JSON.
 * Text is normalised to NFC before matching. Every match is returned; the caller pages them.
 * Manuscript chapters and scenes are included only when `includeManuscript` is set.
 */
export async function searchProjectRecords(
  db: DbOrTx,
  input: {
    projectId: string;
    query: string;
    types?: readonly RecordType[];
    includeManuscript: boolean;
    /** Also search series-scoped references in sibling books. */
    includeSeriesBible?: boolean;
  },
): Promise<SearchHit[]> {
  const query = input.query.normalize("NFC").trim();
  if (!query) return [];
  // Pre-filter in SQLite so large non-matching bodies are not loaded into Node.
  // Include NFD as well as NFC: SQLite substring match is byte-oriented and will
  // miss combining-character forms that JS later unifies under NFC.
  const typeFilter = input.types
    ? { in: [...input.types] }
    : input.includeManuscript
      ? undefined
      : { notIn: [...MANUSCRIPT_TYPES] };
  const candidateIds = await db.record.findMany({
    where: {
      projectId: input.projectId,
      trashedAt: null,
      ...(typeFilter ? { type: typeFilter } : {}),
      OR: sqlContainsAny(["title", "body", "fields"], query),
    },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  // SQLite LIKE is case-insensitive for ASCII; still load candidates and match in JS with NFC + excerpt.
  // When the query has no ASCII-folding match path, fall back to a broader title-only pass is unnecessary:
  // contains already returns a superset for typical English manuscripts.
  const idList = candidateIds.map((row) => row.id);
  const rows =
    idList.length === 0
      ? []
      : await db.record.findMany({
          where: { id: { in: idList }, projectId: input.projectId, trashedAt: null },
          orderBy: { id: "asc" },
          select: {
            id: true,
            projectId: true,
            type: true,
            title: true,
            body: true,
            fields: true,
            authorityStatus: true,
            protected: true,
            currentRevision: true,
          },
        });

  const hits: SearchHit[] = [];
  for (const row of rows) {
    if (!isRecordType(row.type)) throw new Error(`Unknown record type in database: ${row.type}`);
    if (!isAuthorityStatus(row.authorityStatus)) throw new Error(`Unknown authority status in database: ${row.authorityStatus}`);
    const title = excerptAt(row.title, query);
    const body = title ? null : excerptAt(row.body, query);
    const fields = title || body ? null : excerptAt(row.fields, query);
    const match = title ? { matchedIn: "title" as const, ...title } : body ? { matchedIn: "body" as const, ...body } : fields ? { matchedIn: "fields" as const, ...fields } : null;
    if (!match) continue;
    hits.push({
      id: row.id,
      projectId: row.projectId,
      type: row.type,
      title: row.title,
      authorityStatus: row.authorityStatus,
      protected: row.protected,
      currentRevision: row.currentRevision,
      matchedIn: match.matchedIn,
      excerpt: match.excerpt,
      excerptTruncated: match.excerptTruncated,
      excerptLimit: SEARCH_EXCERPT_CHARS,
    });
  }
  if (!input.includeSeriesBible) return hits;
  const shared = await listSeriesSharedRecords(db, input.projectId);
  const seen = new Set(hits.map((hit) => hit.id));
  for (const item of shared) {
    if (seen.has(item.record.id)) continue;
    if (input.types && !input.types.includes(item.record.type)) continue;
    const record = item.record;
    const title = excerptAt(record.title, query);
    const body = title ? null : excerptAt(record.body, query);
    const fields = title || body ? null : excerptAt(JSON.stringify(record.fields), query);
    const match = title ? { matchedIn: "title" as const, ...title } : body ? { matchedIn: "body" as const, ...body } : fields ? { matchedIn: "fields" as const, ...fields } : null;
    if (!match) continue;
    hits.push({
      id: record.id,
      projectId: record.projectId,
      type: record.type,
      title: record.title,
      authorityStatus: record.authorityStatus,
      protected: record.protected,
      currentRevision: record.currentRevision,
      matchedIn: match.matchedIn,
      excerpt: match.excerpt,
      excerptTruncated: match.excerptTruncated,
      excerptLimit: SEARCH_EXCERPT_CHARS,
      seriesHome: item.home,
    });
  }
  return hits;
}

/** Excerpts shown per chapter, scene or note; the hit says how many matches there are in all. */
export const MANUSCRIPT_EXCERPTS_PER_RECORD = 3;

export interface ManuscriptHit {
  id: string;
  type: RecordType;
  title: string;
  /** The chapter of a scene, or the chapter or scene a note is on. */
  parentTitle: string | null;
  titleMatches: boolean;
  /** Matches in the text. */
  count: number;
  excerpts: Excerpt[];
}

export interface ManuscriptSearch {
  hits: ManuscriptHit[];
  /** Matches in all texts (titles not counted). */
  totalMatches: number;
}

export interface ManuscriptRecordInOrder {
  id: string;
  type: RecordType;
  title: string;
  body: string;
  parentTitle: string | null;
  protected: boolean;
  currentRevision: number;
}

/** Chapters, scenes and notes on the active draft, in book order (notes after their parent). */
export async function listManuscriptInBookOrder(
  db: DbOrTx,
  input: {
    projectId: string;
    draftId?: string | null;
    hasDrafts?: boolean;
    /** When set, only these ids (plus their notes' parents for ordering) are loaded. */
    onlyIds?: readonly string[];
  },
): Promise<ManuscriptRecordInOrder[]> {
  const manuscriptFilter =
    input.hasDrafts === true
      ? input.draftId
        ? { type: { in: [...MANUSCRIPT_TYPES] }, draftId: input.draftId }
        : { type: { in: [...MANUSCRIPT_TYPES] }, id: { in: [] as string[] } }
      : { type: { in: [...MANUSCRIPT_TYPES] } };
  const rows = await db.record.findMany({
    where: {
      projectId: input.projectId,
      trashedAt: null,
      OR: [manuscriptFilter, { type: "scene_note" }],
      ...(input.onlyIds ? { id: { in: [...input.onlyIds] } } : {}),
    },
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      parentRecordId: true,
      position: true,
      createdAt: true,
      draftId: true,
      protected: true,
      currentRevision: true,
    },
  });
  const manuscriptIds = new Set(rows.filter((r) => r.type !== "scene_note").map((r) => r.id));
  const scoped = rows.filter((r) => r.type !== "scene_note" || (r.parentRecordId && manuscriptIds.has(r.parentRecordId)));
  const byId = new Map(scoped.map((r) => [r.id, r]));
  const tree = buildManuscriptTree(
    scoped.flatMap((r) =>
      isRecordType(r.type) && r.type !== "scene_note" ? [{ ...r, type: r.type, createdAt: r.createdAt.toISOString() }] : [],
    ),
  );
  const notesOn = new Map<string, string[]>();
  for (const r of [...scoped].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1))) {
    if (r.type === "scene_note" && r.parentRecordId) notesOn.set(r.parentRecordId, [...(notesOn.get(r.parentRecordId) ?? []), r.id]);
  }
  const order: string[] = [];
  const add = (id: string) => order.push(id, ...(notesOn.get(id) ?? []));
  for (const c of tree.chapters) {
    add(c.id);
    c.scenes.forEach((s) => add(s.id));
  }
  tree.unplaced.forEach((s) => add(s.id));

  const out: ManuscriptRecordInOrder[] = [];
  for (const id of order) {
    const row = byId.get(id);
    if (!row || !isRecordType(row.type)) continue;
    const parent = row.parentRecordId ? byId.get(row.parentRecordId) : undefined;
    out.push({
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      parentTitle: parent?.title ?? null,
      protected: row.protected,
      currentRevision: row.currentRevision,
    });
  }
  return out;
}

/**
 * Every match in the saved text of chapters, scenes and scene notes, in book
 * order with notes after what they are on. Matching is literal, like the
 * editor's Find; case is ignored unless `matchCase` is set.
 */
export async function searchManuscript(
  db: DbOrTx,
  input: { projectId: string; query: string; matchCase: boolean; draftId?: string | null; hasDrafts?: boolean },
): Promise<ManuscriptSearch> {
  const query = input.query.trim();
  if (!query) return { hits: [], totalMatches: 0 };

  const options = { matchCase: input.matchCase };
  // Narrow candidates in SQL first so a 120k-word book does not load every body into Node.
  const manuscriptFilter =
    input.hasDrafts === true
      ? input.draftId
        ? { type: { in: [...MANUSCRIPT_TYPES] }, draftId: input.draftId }
        : { type: { in: [...MANUSCRIPT_TYPES] }, id: { in: [] as string[] } }
      : { type: { in: [...MANUSCRIPT_TYPES] } };
  const candidates = await db.record.findMany({
    where: {
      projectId: input.projectId,
      trashedAt: null,
      AND: [
        { OR: [manuscriptFilter, { type: "scene_note" }] },
        { OR: sqlContainsAny(["title", "body"], query) },
      ],
    },
    select: { id: true, parentRecordId: true, type: true },
  });
  if (candidates.length === 0) return { hits: [], totalMatches: 0 };
  const onlyIds = new Set<string>();
  for (const row of candidates) {
    onlyIds.add(row.id);
    if (row.parentRecordId) onlyIds.add(row.parentRecordId);
  }

  const hits: ManuscriptHit[] = [];
  let totalMatches = 0;
  const candidateSet = new Set(candidates.map((row) => row.id));
  for (const row of await listManuscriptInBookOrder(db, { ...input, onlyIds: [...onlyIds] })) {
    if (!candidateSet.has(row.id)) continue;
    const titleMatches = findMatches(row.title, query, options).length > 0;
    const text = searchText(row.body, query, { ...options, limit: MANUSCRIPT_EXCERPTS_PER_RECORD });
    if (!titleMatches && text.count === 0) continue;
    totalMatches += text.count;
    hits.push({
      id: row.id,
      type: row.type,
      title: row.title,
      parentTitle: row.parentTitle,
      titleMatches,
      count: text.count,
      excerpts: text.excerpts,
    });
  }
  return { hits, totalMatches };
}

export type ContextMatchIn = "title" | "name" | "aliases" | "section";

export interface ContextSearchHit {
  id: string;
  title: string;
  type: RecordType;
  authorityStatus: AuthorityStatus;
  currentRevision: number;
  matchedIn: ContextMatchIn;
  excerpt: string;
  /** Heading anchor when matchedIn is section. */
  sectionId: string | null;
  sectionTitle: string | null;
  /** Set when the reference lives in another book of this series. */
  seriesHome?: SeriesHomeRef;
}

/**
 * Title, fields.name / aliases, and section heading search for the context rail.
 * Manuscript records are never returned. Prefer title, then name, aliases, then section.
 */
export async function searchContextReferences(
  db: DbOrTx,
  input: { projectId: string; query: string; limit?: number },
): Promise<ContextSearchHit[]> {
  const query = input.query.normalize("NFC").trim();
  if (!query) return [];
  const limit = input.limit ?? 24;
  const rows = await db.record.findMany({
    where: { projectId: input.projectId, trashedAt: null, type: { notIn: [...MANUSCRIPT_TYPES] } },
    orderBy: [{ title: "asc" }, { id: "asc" }],
    select: {
      id: true,
      title: true,
      type: true,
      body: true,
      fields: true,
      authorityStatus: true,
      currentRevision: true,
    },
  });

  const hits: ContextSearchHit[] = [];
  for (const row of rows) {
    if (!isRecordType(row.type) || !isLinkableReferenceType(row.type)) continue;
    if (!isAuthorityStatus(row.authorityStatus)) continue;
    const base = {
      id: row.id,
      title: row.title,
      type: row.type,
      authorityStatus: row.authorityStatus,
      currentRevision: row.currentRevision,
    };

    if (findMatch(row.title, query) >= 0) {
      hits.push({
        ...base,
        matchedIn: "title",
        excerpt: clipExcerpt(row.title, query),
        sectionId: null,
        sectionTitle: null,
      });
      if (hits.length >= limit) break;
      continue;
    }

    let fields: Record<string, unknown> = {};
    try {
      fields = parseJsonObject(row.fields);
    } catch {
      fields = {};
    }
    const name = typeof fields.name === "string" ? fields.name.trim() : "";
    if (name && findMatch(name, query) >= 0) {
      hits.push({
        ...base,
        matchedIn: "name",
        excerpt: clipExcerpt(name, query),
        sectionId: null,
        sectionTitle: null,
      });
      if (hits.length >= limit) break;
      continue;
    }

    const aliasHit = aliasesOf(fields).find((a) => findMatch(a, query) >= 0);
    if (aliasHit) {
      hits.push({
        ...base,
        matchedIn: "aliases",
        excerpt: clipExcerpt(aliasHit, query),
        sectionId: null,
        sectionTitle: null,
      });
      if (hits.length >= limit) break;
      continue;
    }

    const section = listSections(row.body).find((s) => findMatch(s.title, query) >= 0);
    if (section) {
      hits.push({
        ...base,
        matchedIn: "section",
        excerpt: clipExcerpt(section.title, query),
        sectionId: section.id,
        sectionTitle: section.title,
      });
      if (hits.length >= limit) break;
    }
  }
  if (hits.length >= limit) return hits;
  const shared = await listSeriesSharedRecords(db, input.projectId);
  for (const item of shared) {
    if (hits.length >= limit) break;
    if (hits.some((hit) => hit.id === item.record.id)) continue;
    const row = item.record;
    if (!isLinkableReferenceType(row.type)) continue;
    const base = {
      id: row.id,
      title: row.title,
      type: row.type,
      authorityStatus: row.authorityStatus,
      currentRevision: row.currentRevision,
      seriesHome: item.home,
    };
    if (findMatch(row.title, query) >= 0) {
      hits.push({ ...base, matchedIn: "title", excerpt: clipExcerpt(row.title, query), sectionId: null, sectionTitle: null });
      continue;
    }
    const fields = row.fields;
    const name = typeof fields.name === "string" ? fields.name.trim() : "";
    if (name && findMatch(name, query) >= 0) {
      hits.push({ ...base, matchedIn: "name", excerpt: clipExcerpt(name, query), sectionId: null, sectionTitle: null });
      continue;
    }
    const aliasHit = aliasesOf(fields).find((alias) => findMatch(alias, query) >= 0);
    if (aliasHit) {
      hits.push({ ...base, matchedIn: "aliases", excerpt: clipExcerpt(aliasHit, query), sectionId: null, sectionTitle: null });
      continue;
    }
    const section = listSections(row.body).find((itemSection) => findMatch(itemSection.title, query) >= 0);
    if (section) {
      hits.push({
        ...base,
        matchedIn: "section",
        excerpt: clipExcerpt(section.title, query),
        sectionId: section.id,
        sectionTitle: section.title,
      });
    }
  }
  return hits;
}

export function excerptAt(text: string, query: string): { excerpt: string; excerptTruncated: boolean } | null {
  const haystack = text.normalize("NFC");
  const index = findMatch(haystack, query);
  if (index < 0) return null;
  if (haystack.length <= SEARCH_EXCERPT_CHARS) return { excerpt: haystack, excerptTruncated: false };
  const start = Math.max(0, Math.min(index - 40, haystack.length - SEARCH_EXCERPT_CHARS));
  return { excerpt: haystack.slice(start, start + SEARCH_EXCERPT_CHARS), excerptTruncated: true };
}

function clipExcerpt(text: string, query: string): string {
  return excerptAt(text, query)?.excerpt ?? text.slice(0, SEARCH_EXCERPT_CHARS);
}

/** NFC and NFD query forms for SQLite `contains` candidate filtering. */
export function searchQuerySqlForms(query: string): string[] {
  const nfc = query.normalize("NFC");
  const nfd = nfc.normalize("NFD");
  return nfc === nfd ? [nfc] : [nfc, nfd];
}

function sqlContainsAny(
  fields: readonly ("title" | "body" | "fields")[],
  query: string,
): Array<Record<"title" | "body" | "fields", { contains: string }>> {
  return searchQuerySqlForms(query).flatMap((form) =>
    fields.map((field) => ({ [field]: { contains: form } }) as Record<"title" | "body" | "fields", { contains: string }>),
  );
}

function findMatch(haystack: string, query: string): number {
  const needle = query.normalize("NFC");
  if (!needle) return -1;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(escaped, "iu").exec(haystack);
  return match?.index ?? -1;
}
