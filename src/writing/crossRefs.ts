import { FENCE, HEADING } from "./markdownParse";
import { listSections, statusTagOf, type DocSection } from "./sections";

/*
 * Cross-references between documents, computed from saved text on every read.
 * Nothing here is stored or written, and nothing changes a record.
 *
 * - A filename such as `Harbour_Guide_APPROVED_WORKING_v1.4.md` refers to the
 *   document imported from any version of that file. Its document key drops
 *   the folder, extension, a leading number ("18-"), a version ("_v1.4"), a
 *   date, and trailing capitalised status words ("_APPROVED_WORKING",
 *   "_CURRENT"). Status words never set a record's status.
 * - An ID such as `SA-WORLD-001` or `SA-B1-C01` refers to where it is defined:
 *   an ID the author gave a record (structured field `refIds`), a heading that
 *   starts with it, a bold list item or paragraph that starts with it, or a
 *   table row whose first cell is it. A definition in a superseded record is
 *   used only when no current record defines the ID.
 * - Characters and places (character dossiers and worldbuilding records) are
 *   found in chapter and scene text by name: the title up to a dash, colon or
 *   bracket, the same without a leading "The", any `aliases` in the record's
 *   structured fields, and for characters the first and last word of the name
 *   when no other record uses that word. Matching is whole-word and
 *   case-sensitive.
 */

const STATUS_WORDS = new Set([
  "APPROVED",
  "WORKING",
  "CURRENT",
  "DRAFT",
  "PROPOSED",
  "FINAL",
  "LOCKED",
  "AUTHOR",
  "REVISED",
  "EDITED",
  "CANON",
  "OPEN",
  "SELECTED",
  "LATEST",
  "UPDATED",
  "WIP",
]);

const MARKDOWN_FILE = /\.(md|markdown)$/i;

/** A filename without path, extension, number prefix, version, date or trailing status words; spelling kept. */
export function documentName(filename: string): string {
  let name = filename.trim().replace(/^.*[\\/]/, "").replace(MARKDOWN_FILE, "");
  name = name.replace(/^\d+[\s._-]+/, "");
  for (;;) {
    const before = name;
    name = name
      .replace(/[\s_-]+v\d+(?:\.\d+)*$/i, "")
      .replace(/[\s_-]+\d{4}-\d{2}-\d{2}$/, "")
      .replace(/[\s_-]+([A-Z]+)$/, (whole, word: string) => (STATUS_WORDS.has(word) ? "" : whole));
    if (name === before) break;
  }
  return name.split(/[\s_.-]+/).filter(Boolean).join(" ");
}

/** The name a document keeps from version to version, lower case with single spaces. */
export function documentKey(filename: string): string {
  return documentName(filename).toLowerCase();
}

/** The number a filename starts with (`18-Chapter_One.md` gives 18), or null. */
export function filenameNumber(filename: string): number | null {
  const m = filename.trim().replace(/^.*[\\/]/, "").match(/^(\d{1,6})(?=[\s._-])/);
  return m ? Number(m[1]) : null;
}

const FILE_SOURCE = String.raw`(?<![\w.-])[A-Za-z0-9][\w.-]*\.(?:md|markdown)(?![\w-])`;
const ID_SOURCE = String.raw`(?<![\w-])[A-Z]{2,}[A-Z0-9]*(?:-[A-Z0-9]+)+(?![\w-])`;
const hasDigit = (id: string) => /\d/.test(id);

/** Markdown filenames mentioned in a text, keyed by document key (first spelling kept). */
export function fileMentions(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(new RegExp(FILE_SOURCE, "gi"))) {
    const key = documentKey(m[0]);
    if (key && !out.has(key)) out.set(key, m[0]);
  }
  return out;
}

/** IDs mentioned in a text, in order of first appearance. */
export function idMentions(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(new RegExp(ID_SOURCE, "g"))) if (hasDigit(m[0])) out.add(m[0]);
  return [...out];
}

export type DefinitionKind = "heading" | "item" | "row";

export interface IdDefinition {
  id: string;
  kind: DefinitionKind;
  /** Heading anchor to link to: the heading itself, or the heading the item or row sits under. */
  anchor: string | null;
  label: string;
  statusTag: string | null;
}

const LEADING_NUMBER = String.raw`(?:[0-9A-Z]{1,4}[.)]\s+)?`;
const HEADING_ID = new RegExp(String.raw`^${LEADING_NUMBER}(${ID_SOURCE})`);
const ITEM_ID = new RegExp(String.raw`^ {0,3}(?:(?:[-+*]|\d{1,9}[.)])[ \t]+)?\*\*(${ID_SOURCE})([^*]*)\*\*`);
const ROW_ID = new RegExp(String.raw`^ {0,3}\|?[ \t]*(${ID_SOURCE})[ \t]*\|([^|]*)`);

function anchorAt(sections: readonly DocSection[], offset: number): string | null {
  let anchor: string | null = null;
  for (const s of sections) {
    if (s.start > offset) break;
    anchor = s.id;
  }
  return anchor;
}

/** Where a document defines IDs, in document order. */
export function idDefinitions(body: string): IdDefinition[] {
  const sections = listSections(body);
  const out: IdDefinition[] = [];
  for (const s of sections) {
    const m = HEADING_ID.exec(s.title);
    if (m && hasDigit(m[1])) out.push({ id: m[1], kind: "heading", anchor: s.id, label: s.title, statusTag: s.statusTag });
  }
  let fence: string | null = null;
  let offset = 0;
  while (offset <= body.length) {
    const newline = body.indexOf("\n", offset);
    const lineEnd = newline === -1 ? body.length : newline;
    const line = body.slice(offset, lineEnd).replace(/\r$/, "");
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1][0];
      else if (fenceMatch[1][0] === fence && !fenceMatch[2].trim()) fence = null;
    } else if (fence === null && !HEADING.test(line)) {
      const item = ITEM_ID.exec(line);
      const row = item ? null : ROW_ID.exec(line);
      if (item && hasDigit(item[1])) {
        const label = `${item[1]}${item[2]}`.replace(/[:\s]+$/, "").trim();
        out.push({ id: item[1], kind: "item", anchor: anchorAt(sections, offset), label, statusTag: statusTagOf(label) });
      } else if (row && hasDigit(row[1]) && !/^[\s:-]*$/.test(row[2])) {
        out.push({ id: row[1], kind: "row", anchor: anchorAt(sections, offset), label: row[2].trim() || row[1], statusTag: null });
      }
    }
    if (newline === -1) break;
    offset = newline + 1;
  }
  return out;
}

/** IDs the author gave a record in its structured field `refIds` (a string or a list of strings). */
export function refIdsOf(fields: Readonly<Record<string, unknown>>): string[] {
  const raw = fields.refIds;
  const list = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : [];
  return [...new Set(list.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean))];
}

/** Other names the author gave a character or place (structured field `aliases`, a string or a list of strings). */
export function aliasesOf(fields: Readonly<Record<string, unknown>>): string[] {
  const raw = fields.aliases;
  const list = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : [];
  return [...new Set(list.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter((v) => v.length >= 2))];
}

export interface XrefRecord {
  id: string;
  title: string;
  type: string;
  body: string;
  fields: Readonly<Record<string, unknown>>;
  /** Every filename this record was imported from. */
  filenames: readonly string[];
  /** The record's canon status. Links to superseded and draft records are flagged. */
  status?: string;
  /** The record that replaces this one, when it is superseded. */
  supersededBy?: string | null;
}

export type TargetVia = "refIds" | DefinitionKind | "file";

export interface XrefTarget {
  recordId: string;
  title: string;
  anchor: string | null;
  label: string;
  statusTag: string | null;
  via: TargetVia;
  /** Canon status of the whole target record. */
  status?: string;
  /** The live record that replaces a superseded target. */
  replacedBy?: { recordId: string; title: string } | null;
}

const PRIORITY: Record<TargetVia, number> = { refIds: 0, file: 0, heading: 1, item: 2, row: 3 };
const retired = (t: { status?: string }) => (t.status === "superseded" ? 1 : 0);

function byPriority(a: XrefTarget, b: XrefTarget): number {
  return (
    retired(a) - retired(b) ||
    PRIORITY[a.via] - PRIORITY[b.via] ||
    a.title.localeCompare(b.title) ||
    a.recordId.localeCompare(b.recordId)
  );
}

/** Record types whose names are looked for in the manuscript, and the types that are searched. */
const NAMED_TYPES = new Set(["character_dossier", "worldbuilding"]);
const PROSE_TYPES = new Set(["manuscript_chapter", "manuscript_scene"]);
/** Words that are never used on their own as a character's first or last name. */
const NAME_PART_STOPWORDS = new Set(
  "The A An Of And Lady Lord Sir Dame Mr Mrs Ms Miss Dr Doctor Captain Master Mistress King Queen Prince Princess Father Mother Brother Sister Aunt Uncle Old Young Saint St De Van Von Le La".split(
    " ",
  ),
);

/** The name part of a title: "Seren — Character Dossier" gives "Seren". Null when it does not start with a capital. */
export function nameFromTitle(title: string): string | null {
  const name = title.split(/\s+[\u2014\u2013-]\s+|:\s|\s\(/)[0].trim();
  return name.length >= 2 && name.length <= 60 && /^\p{Lu}/u.test(name) ? name : null;
}

/** Full names (title, title without "The", aliases) and, for characters, single-word parts of the name. */
export function nameFormsOf(record: Pick<XrefRecord, "title" | "type" | "fields">): { full: string[]; parts: string[] } {
  if (!NAMED_TYPES.has(record.type)) return { full: [], parts: [] };
  const name = nameFromTitle(record.title);
  const full = new Set<string>();
  if (name) {
    full.add(name);
    const bare = name.replace(/^The\s+/, "");
    if (bare !== name && /^\p{Lu}/u.test(bare)) full.add(bare);
  }
  for (const alias of aliasesOf(record.fields)) full.add(alias);
  const parts = new Set<string>();
  if (name && record.type === "character_dossier") {
    const words = name.split(/\s+/);
    if (words.length >= 2) {
      for (const word of [words[0], words[words.length - 1]]) {
        if (/^\p{Lu}[\p{L}'\u2019-]{2,}$/u.test(word) && !NAME_PART_STOPWORDS.has(word) && !full.has(word)) parts.add(word);
      }
    }
  }
  return { full: [...full], parts: [...parts] };
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function buildNameTerms(records: readonly XrefRecord[]): Map<string, string[]> {
  const terms = new Map<string, string[]>();
  const partOwners = new Map<string, Set<string>>();
  for (const r of records) {
    if (r.status === "superseded") continue;
    const { full, parts } = nameFormsOf(r);
    for (const term of full) terms.set(term, [...(terms.get(term) ?? []), r.id]);
    for (const part of parts) partOwners.set(part, (partOwners.get(part) ?? new Set()).add(r.id));
  }
  // A first or last name counts only when it belongs to one character and is nobody's full name.
  for (const [part, owners] of partOwners) {
    if (owners.size === 1 && !terms.has(part)) terms.set(part, [...owners]);
  }
  return terms;
}

function namePattern(terms: ReadonlyMap<string, string[]>): RegExp | null {
  if (terms.size === 0) return null;
  const alternatives = [...terms.keys()].sort((a, b) => b.length - a.length || a.localeCompare(b)).map(escapeRegExp);
  return new RegExp(String.raw`(?<![\p{L}\p{N}_])(?:${alternatives.join("|")})(?![\p{L}\p{N}_])`, "gu");
}

export interface NameHits {
  count: number;
  /** The forms found, in order of first appearance. */
  forms: string[];
}

/** Characters and places named in a text, by record. */
export function nameMentions(text: string, terms: ReadonlyMap<string, string[]>, pattern: RegExp | null): Map<string, NameHits> {
  const out = new Map<string, NameHits>();
  if (!pattern) return out;
  for (const m of text.matchAll(new RegExp(pattern.source, pattern.flags))) {
    for (const recordId of terms.get(m[0]) ?? []) {
      const hits = out.get(recordId) ?? { count: 0, forms: [] };
      hits.count += 1;
      if (!hits.forms.includes(m[0])) hits.forms.push(m[0]);
      out.set(recordId, hits);
    }
  }
  return out;
}

export interface CrossRefIndex {
  records: Map<string, XrefRecord>;
  /** Every place each ID is given or defined, best first. */
  ids: Map<string, XrefTarget[]>;
  /** Records imported from each document key. */
  files: Map<string, XrefTarget[]>;
  /** Filenames and IDs each record's text mentions. */
  mentions: Map<string, { files: Map<string, string>; ids: string[] }>;
  /** First segments of every known ID ("SA" for SA-WORLD-001). */
  prefixes: Set<string>;
  /** Each name form looked for in the manuscript, with the records it names. */
  names: Map<string, string[]>;
  /** Characters and places named in each chapter and scene. */
  named: Map<string, Map<string, NameHits>>;
}

export function buildCrossRefIndex(records: readonly XrefRecord[]): CrossRefIndex {
  const index: CrossRefIndex = {
    records: new Map(),
    ids: new Map(),
    files: new Map(),
    mentions: new Map(),
    prefixes: new Set(),
    names: buildNameTerms(records),
    named: new Map(),
  };
  const add = (map: Map<string, XrefTarget[]>, key: string, target: XrefTarget) => {
    const list = map.get(key) ?? [];
    list.push(target);
    map.set(key, list);
  };
  const pattern = namePattern(index.names);
  for (const r of records) index.records.set(r.id, r);
  const replacement = (r: XrefRecord) => {
    const next = r.status === "superseded" && r.supersededBy ? index.records.get(r.supersededBy) : undefined;
    return next ? { recordId: next.id, title: next.title } : null;
  };
  for (const r of records) {
    const about = { recordId: r.id, title: r.title, status: r.status, replacedBy: replacement(r) };
    for (const id of refIdsOf(r.fields)) {
      add(index.ids, id, { ...about, anchor: null, label: r.title, statusTag: null, via: "refIds" });
    }
    for (const d of idDefinitions(r.body)) {
      add(index.ids, d.id, { ...about, anchor: d.anchor, label: d.label, statusTag: d.statusTag, via: d.kind });
    }
    for (const key of new Set(r.filenames.map(documentKey).filter(Boolean))) {
      add(index.files, key, { ...about, anchor: null, label: r.title, statusTag: null, via: "file" });
    }
    index.mentions.set(r.id, { files: fileMentions(r.body), ids: idMentions(r.body) });
    if (PROSE_TYPES.has(r.type)) {
      const hits = nameMentions(r.body, index.names, pattern);
      if (hits.size) index.named.set(r.id, hits);
    }
  }
  for (const list of [...index.ids.values(), ...index.files.values()]) list.sort(byPriority);
  for (const id of index.ids.keys()) index.prefixes.add(id.split("-")[0]);
  return index;
}

/** The name forms looked for in the manuscript for one record. */
export function nameFormsFor(index: CrossRefIndex, recordId: string): string[] {
  const out: string[] = [];
  for (const [term, owners] of index.names) if (owners.includes(recordId)) out.push(term);
  return out.sort((a, b) => b.length - a.length || a.localeCompare(b));
}

export function resolveId(index: CrossRefIndex, id: string): XrefTarget | null {
  return index.ids.get(id)?.[0] ?? null;
}

export function resolveFile(index: CrossRefIndex, filename: string): XrefTarget | null {
  return index.files.get(documentKey(filename))?.[0] ?? null;
}

export interface RecordCrossRefs {
  /** IDs this record carries (refIds) or defines in its text. */
  defined: (XrefTarget & { id: string })[];
  /** Filenames its text mentions, with the imported document when there is one. */
  files: { filename: string; target: XrefTarget | null }[];
  /** IDs its text mentions that it does not define itself. Unknown IDs are listed only when their prefix is in use. */
  ids: { id: string; target: XrefTarget | null }[];
  /** Other records whose text mentions this one's filenames or IDs. */
  mentionedBy: { recordId: string; title: string; type: string; via: string[] }[];
  /** In a chapter or scene: the characters and places its text names, most mentioned first. */
  names: (RecordRef & NameHits & { status?: string })[];
  /** For a character or place: the chapters and scenes that name it, most mentions first. */
  namedIn: (RecordRef & { count: number })[];
  /** For a character or place: the forms looked for in the manuscript. */
  nameForms: string[];
}

export interface RecordRef {
  recordId: string;
  title: string;
  type: string;
}

function refOf(r: XrefRecord): RecordRef {
  return { recordId: r.id, title: r.title, type: r.type };
}

export function crossRefsFor(index: CrossRefIndex, recordId: string): RecordCrossRefs {
  const record = index.records.get(recordId);
  if (!record) return { defined: [], files: [], ids: [], mentionedBy: [], names: [], namedIn: [], nameForms: [] };
  const defined: RecordCrossRefs["defined"] = [];
  for (const [id, targets] of index.ids) {
    for (const t of targets) if (t.recordId === recordId) defined.push({ ...t, id });
  }
  const ownIds = new Set(defined.map((d) => d.id));
  const ownKeys = new Set(record.filenames.map(documentKey).filter(Boolean));
  const mentions = index.mentions.get(recordId)!;

  const files = [...mentions.files]
    .filter(([key]) => !ownKeys.has(key))
    .map(([, filename]) => ({ filename, target: resolveFile(index, filename) }));
  const ids = mentions.ids
    .filter((id) => !ownIds.has(id))
    .map((id) => ({ id, target: resolveId(index, id) }))
    .filter((m) => m.target || index.prefixes.has(m.id.split("-")[0]));

  const mentionedBy: RecordCrossRefs["mentionedBy"] = [];
  for (const [otherId, other] of index.mentions) {
    if (otherId === recordId) continue;
    const via = [
      ...[...other.files].filter(([key]) => ownKeys.has(key)).map(([, filename]) => filename),
      ...other.ids.filter((id) => ownIds.has(id)),
    ];
    if (via.length) {
      const r = index.records.get(otherId)!;
      mentionedBy.push({ recordId: otherId, title: r.title, type: r.type, via });
    }
  }
  mentionedBy.sort((a, b) => a.title.localeCompare(b.title));

  const names = [...(index.named.get(recordId) ?? [])].flatMap(([id, hits]) => {
    const r = index.records.get(id);
    return r ? [{ ...refOf(r), ...hits, status: r.status }] : [];
  });
  names.sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
  const namedIn: RecordCrossRefs["namedIn"] = [];
  for (const [proseId, hits] of index.named) {
    const h = hits.get(recordId);
    const r = index.records.get(proseId);
    if (h && r) namedIn.push({ ...refOf(r), count: h.count });
  }
  namedIn.sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
  return { defined, files, ids, mentionedBy, names, namedIn, nameForms: nameFormsFor(index, recordId) };
}

/** Statuses a link warns about: the target is not current canon or settled work. */
export function isFlaggedStatus(status: string | undefined): status is "superseded" | "draft" {
  return status === "superseded" || status === "draft";
}

export interface CrossRefReport {
  /** IDs mentioned that no record defines (only for prefixes some record uses). */
  undefinedIds: { id: string; mentionedBy: RecordRef[] }[];
  /** Markdown filenames mentioned that were never imported. */
  missingFiles: { filename: string; mentionedBy: RecordRef[] }[];
  /** IDs defined by more than one current record. */
  conflicts: { id: string; places: XrefTarget[] }[];
  /** Mentions whose target record is superseded or draft. */
  flaggedMentions: { from: RecordRef; token: string; target: XrefTarget }[];
  /** Every character and place, with how often the manuscript names it. */
  names: (RecordRef & { forms: string[]; chapters: number; mentions: number })[];
  /** Superseded records, left out of every list except as targets. */
  supersededSkipped: number;
}

function pushRef(map: Map<string, RecordRef[]>, key: string, ref: RecordRef) {
  const list = map.get(key) ?? [];
  if (!list.some((r) => r.recordId === ref.recordId)) list.push(ref);
  map.set(key, list);
}

/**
 * Project-wide check. Mentions made by superseded records are left out: an
 * old version referring to old material is expected.
 */
export function crossRefReport(index: CrossRefIndex): CrossRefReport {
  const undefinedIds = new Map<string, RecordRef[]>();
  const missingFiles = new Map<string, RecordRef[]>();
  const flaggedMentions: CrossRefReport["flaggedMentions"] = [];
  let supersededSkipped = 0;
  for (const [recordId, mentions] of index.mentions) {
    const r = index.records.get(recordId)!;
    if (r.status === "superseded") {
      supersededSkipped += 1;
      continue;
    }
    const ref = refOf(r);
    const ownKeys = new Set(r.filenames.map(documentKey).filter(Boolean));
    for (const [key, filename] of mentions.files) {
      if (ownKeys.has(key)) continue;
      const target = resolveFile(index, filename);
      if (!target) pushRef(missingFiles, filename, ref);
      else if (target.recordId !== recordId && isFlaggedStatus(target.status)) flaggedMentions.push({ from: ref, token: filename, target });
    }
    for (const id of mentions.ids) {
      const target = resolveId(index, id);
      if (!target) {
        if (index.prefixes.has(id.split("-")[0])) pushRef(undefinedIds, id, ref);
      } else if (target.recordId !== recordId && isFlaggedStatus(target.status)) {
        flaggedMentions.push({ from: ref, token: id, target });
      }
    }
  }

  const conflicts: CrossRefReport["conflicts"] = [];
  for (const [id, targets] of index.ids) {
    const current = targets.filter((t) => t.status !== "superseded");
    const strong = new Set(current.filter((t) => t.via !== "row").map((t) => t.recordId));
    const rows = new Set(current.filter((t) => t.via === "row").map((t) => t.recordId));
    // A register row next to the document that defines the ID is not a conflict; two definitions are.
    if (strong.size > 1 || (strong.size === 0 && rows.size > 1)) conflicts.push({ id, places: current });
  }

  const names: CrossRefReport["names"] = [];
  for (const r of index.records.values()) {
    if (!NAMED_TYPES.has(r.type) || r.status === "superseded") continue;
    const forms = nameFormsFor(index, r.id);
    if (!forms.length) continue;
    let chapters = 0;
    let mentions = 0;
    for (const hits of index.named.values()) {
      const h = hits.get(r.id);
      if (h) {
        chapters += 1;
        mentions += h.count;
      }
    }
    names.push({ ...refOf(r), forms, chapters, mentions });
  }

  const byKey = <T,>(m: Map<string, RecordRef[]>, make: (key: string, refs: RecordRef[]) => T) =>
    [...m].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => make(k, v.sort((x, y) => x.title.localeCompare(y.title))));
  return {
    undefinedIds: byKey(undefinedIds, (id, mentionedBy) => ({ id, mentionedBy })),
    missingFiles: byKey(missingFiles, (filename, mentionedBy) => ({ filename, mentionedBy })),
    conflicts: conflicts.sort((a, b) => a.id.localeCompare(b.id)),
    flaggedMentions: flaggedMentions.sort(
      (a, b) => (a.target.status === b.target.status ? 0 : a.target.status === "superseded" ? -1 : 1) || a.from.title.localeCompare(b.from.title),
    ),
    names: names.sort((a, b) => b.mentions - a.mentions || a.title.localeCompare(b.title)),
    supersededSkipped,
  };
}

export interface TextSegment {
  text: string;
  target?: XrefTarget;
}

/** Splits text into plain parts and parts that refer to a known document or ID. */
export function linkSegments(text: string, index: CrossRefIndex): TextSegment[] {
  const out: TextSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(new RegExp(`${FILE_SOURCE}|${ID_SOURCE}`, "g"))) {
    const token = m[0];
    const target = MARKDOWN_FILE.test(token) ? resolveFile(index, token) : hasDigit(token) ? resolveId(index, token) : null;
    if (!target) continue;
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: token, target });
    last = m.index + token.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
