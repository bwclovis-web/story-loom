import { isRecordType, MANUSCRIPT_TYPES, type RecordType } from "@/domain/recordTypes";
import { isAuthorityStatus, type AuthorityStatus } from "@/domain/statuses";
import { buildManuscriptTree } from "@/ui/manuscriptTree";
import { findMatches } from "@/writing/findReplace";
import { searchText, type Excerpt } from "@/writing/textSearch";
import type { DbOrTx } from "../db";

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
}

/**
 * Case-insensitive substring search over title, body, and the stored fields JSON.
 * Text is normalised to NFC before matching. Every match is returned; the caller pages them.
 * Manuscript chapters and scenes are included only when `includeManuscript` is set.
 */
export async function searchProjectRecords(
  db: DbOrTx,
  input: { projectId: string; query: string; types?: readonly RecordType[]; includeManuscript: boolean },
): Promise<SearchHit[]> {
  const query = input.query.normalize("NFC").trim();
  const rows = await db.record.findMany({
    where: {
      projectId: input.projectId,
      trashedAt: null,
      type: {
        ...(input.includeManuscript ? {} : { notIn: [...MANUSCRIPT_TYPES] }),
        ...(input.types ? { in: [...input.types] } : {}),
      },
    },
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

/**
 * Every match in the saved text of chapters, scenes and scene notes, in book
 * order with notes after what they are on. Matching is literal, like the
 * editor's Find; case is ignored unless `matchCase` is set.
 */
export async function searchManuscript(
  db: DbOrTx,
  input: { projectId: string; query: string; matchCase: boolean },
): Promise<ManuscriptSearch> {
  const query = input.query.trim();
  if (!query) return { hits: [], totalMatches: 0 };
  const rows = await db.record.findMany({
    where: { projectId: input.projectId, trashedAt: null, type: { in: [...MANUSCRIPT_TYPES, "scene_note"] } },
    select: { id: true, type: true, title: true, body: true, parentRecordId: true, position: true, createdAt: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const tree = buildManuscriptTree(
    rows.flatMap((r) =>
      isRecordType(r.type) ? [{ ...r, type: r.type, createdAt: r.createdAt.toISOString() }] : [],
    ),
  );
  const notesOn = new Map<string, string[]>();
  for (const r of [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1))) {
    if (r.type === "scene_note" && r.parentRecordId) notesOn.set(r.parentRecordId, [...(notesOn.get(r.parentRecordId) ?? []), r.id]);
  }
  const order: string[] = [];
  const add = (id: string) => order.push(id, ...(notesOn.get(id) ?? []));
  for (const c of tree.chapters) {
    add(c.id);
    c.scenes.forEach((s) => add(s.id));
  }
  tree.unplaced.forEach((s) => add(s.id));

  const options = { matchCase: input.matchCase };
  const hits: ManuscriptHit[] = [];
  let totalMatches = 0;
  for (const id of order) {
    const row = byId.get(id)!;
    if (!isRecordType(row.type)) continue;
    const titleMatches = findMatches(row.title, query, options).length > 0;
    const text = searchText(row.body, query, { ...options, limit: MANUSCRIPT_EXCERPTS_PER_RECORD });
    if (!titleMatches && text.count === 0) continue;
    totalMatches += text.count;
    const parent = row.parentRecordId ? byId.get(row.parentRecordId) : undefined;
    hits.push({
      id: row.id,
      type: row.type,
      title: row.title,
      parentTitle: parent?.title ?? null,
      titleMatches,
      count: text.count,
      excerpts: text.excerpts,
    });
  }
  return { hits, totalMatches };
}

function excerptAt(text: string, query: string): { excerpt: string; excerptTruncated: boolean } | null {
  const haystack = text.normalize("NFC");
  const index = findMatch(haystack, query);
  if (index < 0) return null;
  if (haystack.length <= SEARCH_EXCERPT_CHARS) return { excerpt: haystack, excerptTruncated: false };
  const start = Math.max(0, Math.min(index - 40, haystack.length - SEARCH_EXCERPT_CHARS));
  return { excerpt: haystack.slice(start, start + SEARCH_EXCERPT_CHARS), excerptTruncated: true };
}

function findMatch(haystack: string, query: string): number {
  const needle = query.normalize("NFC");
  if (!needle) return -1;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(escaped, "iu").exec(haystack);
  return match?.index ?? -1;
}
