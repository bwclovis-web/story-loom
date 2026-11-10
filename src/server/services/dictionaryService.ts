import { newId } from "@/domain/ids";
import { parseJsonObject } from "@/domain/json";
import { contentClassOf, isRecordType } from "@/domain/recordTypes";
import {
  DictionaryMatcher,
  defaultCaseSensitive,
  findDuplicate,
  MAX_NOTE_CHARS,
  validateDictionaryWord,
  wordKey,
  type DictionaryScope,
  type DictionaryWord,
} from "@/spelling/dictionary";
import { spellTokens } from "@/spelling/words";
import type { Db, DbOrTx } from "../db";
import { writeAudit } from "./auditService";
import { LIVE_PROJECT } from "./trashFilters";

/*
 * The author's dictionary. Every call names a project; it sees that project's
 * entries and its workspace's shared entries, never another project's or
 * another workspace's. Entries are not records: adding, editing or removing
 * one changes no record, revision or canon status.
 */

export type DictionaryOrigin = "manual" | "editor" | "import" | "reference";

export class DictionaryError extends Error {
  constructor(
    readonly code: "INVALID" | "DUPLICATE" | "NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "DictionaryError";
  }
}

export interface DictionaryEntryView extends DictionaryWord {
  id: string;
  scope: DictionaryScope;
  note: string;
  origin: string;
  createdAt: string;
  updatedAt: string;
}

export interface DictionaryEntryInput {
  word: string;
  caseSensitive: boolean;
  note?: string;
  scope: DictionaryScope;
}

interface ProjectScope {
  projectId: string;
  workspaceId: string;
}

type EntryRow = {
  id: string;
  projectId: string | null;
  word: string;
  caseSensitive: boolean;
  note: string;
  origin: string;
  createdAt: Date;
  updatedAt: Date;
};

const SCOPE_LABEL: Record<DictionaryScope, string> = { project: "project dictionary", workspace: "workspace dictionary" };

function view(row: EntryRow): DictionaryEntryView {
  return {
    id: row.id,
    scope: row.projectId ? "project" : "workspace",
    word: row.word,
    caseSensitive: row.caseSensitive,
    note: row.note,
    origin: row.origin,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function scopeOf(db: DbOrTx, projectId: string): Promise<ProjectScope> {
  const project = await db.project.findFirst({ where: { id: projectId, ...LIVE_PROJECT }, select: { id: true, workspaceId: true } });
  if (!project) throw new DictionaryError("NOT_FOUND", "That project does not exist.");
  return { projectId: project.id, workspaceId: project.workspaceId };
}

/** Entries that apply to the project: its own and its workspace's. */
function activeWhere(s: ProjectScope) {
  return { workspaceId: s.workspaceId, OR: [{ projectId: s.projectId }, { projectId: null }] };
}

export async function listDictionary(db: DbOrTx, projectId: string): Promise<{ project: DictionaryEntryView[]; workspace: DictionaryEntryView[] }> {
  const s = await scopeOf(db, projectId);
  const rows = await db.dictionaryEntry.findMany({ where: activeWhere(s), orderBy: [{ wordKey: "asc" }, { word: "asc" }] });
  return {
    project: rows.filter((r) => r.projectId).map(view),
    workspace: rows.filter((r) => !r.projectId).map(view),
  };
}

/** Every word accepted in this project, for the spell checker and proofreading. */
export async function dictionaryWordsForProject(db: DbOrTx, projectId: string): Promise<DictionaryWord[]> {
  const s = await scopeOf(db, projectId);
  const rows = await db.dictionaryEntry.findMany({
    where: activeWhere(s),
    select: { word: true, caseSensitive: true },
    orderBy: [{ wordKey: "asc" }, { word: "asc" }],
  });
  return rows;
}

function cleanInput(input: DictionaryEntryInput): DictionaryWord & { note: string } {
  const check = validateDictionaryWord(input.word);
  if (!check.ok) throw new DictionaryError("INVALID", check.message);
  const note = (input.note ?? "").trim();
  if (note.length > MAX_NOTE_CHARS) throw new DictionaryError("INVALID", `A note can have at most ${MAX_NOTE_CHARS} characters.`);
  return { word: check.word, caseSensitive: input.caseSensitive, note };
}

async function assertNotDuplicate(db: DbOrTx, s: ProjectScope, candidate: DictionaryWord, exceptId?: string) {
  const sameKey = await db.dictionaryEntry.findMany({
    where: { ...activeWhere(s), wordKey: wordKey(candidate.word), ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
  const dup = findDuplicate(sameKey, candidate);
  if (dup) {
    throw new DictionaryError("DUPLICATE", `"${dup.word}" is already in the ${SCOPE_LABEL[dup.projectId ? "project" : "workspace"]}.`);
  }
}

export async function addDictionaryEntry(
  db: Db,
  projectId: string,
  input: DictionaryEntryInput,
  origin: DictionaryOrigin,
  actor = "author",
): Promise<DictionaryEntryView> {
  const entry = cleanInput(input);
  return db.$transaction(async (tx) => {
    const s = await scopeOf(tx, projectId);
    await assertNotDuplicate(tx, s, entry);
    const row = await tx.dictionaryEntry.create({
      data: {
        id: newId("dic"),
        workspaceId: s.workspaceId,
        projectId: input.scope === "project" ? s.projectId : null,
        word: entry.word,
        wordKey: wordKey(entry.word),
        caseSensitive: entry.caseSensitive,
        note: entry.note,
        origin,
      },
    });
    await writeAudit(tx, {
      projectId: s.projectId,
      action: "dictionary.add",
      actor,
      summary: `Added "${entry.word}" to the ${SCOPE_LABEL[input.scope]}`,
      details: { entryId: row.id, word: entry.word, scope: input.scope, caseSensitive: entry.caseSensitive, origin },
    });
    return view(row);
  });
}

async function findEntry(db: DbOrTx, s: ProjectScope, entryId: string) {
  const row = await db.dictionaryEntry.findFirst({ where: { id: entryId, ...activeWhere(s) } });
  if (!row) throw new DictionaryError("NOT_FOUND", "That dictionary entry is not in this project or its workspace.");
  return row;
}

export async function updateDictionaryEntry(
  db: Db,
  projectId: string,
  entryId: string,
  input: DictionaryEntryInput,
  actor = "author",
): Promise<DictionaryEntryView> {
  const entry = cleanInput(input);
  return db.$transaction(async (tx) => {
    const s = await scopeOf(tx, projectId);
    const before = await findEntry(tx, s, entryId);
    await assertNotDuplicate(tx, s, entry, entryId);
    const row = await tx.dictionaryEntry.update({
      where: { id: before.id },
      data: {
        projectId: input.scope === "project" ? s.projectId : null,
        word: entry.word,
        wordKey: wordKey(entry.word),
        caseSensitive: entry.caseSensitive,
        note: entry.note,
      },
    });
    await writeAudit(tx, {
      projectId: s.projectId,
      action: "dictionary.update",
      actor,
      summary: before.word === entry.word ? `Updated "${entry.word}" in the dictionary` : `Changed dictionary entry "${before.word}" to "${entry.word}"`,
      details: {
        entryId,
        before: { word: before.word, caseSensitive: before.caseSensitive, scope: before.projectId ? "project" : "workspace", note: before.note },
        after: { word: entry.word, caseSensitive: entry.caseSensitive, scope: input.scope, note: entry.note },
      },
    });
    return view(row);
  });
}

export async function removeDictionaryEntry(db: Db, projectId: string, entryId: string, actor = "author"): Promise<void> {
  await db.$transaction(async (tx) => {
    const s = await scopeOf(tx, projectId);
    const row = await findEntry(tx, s, entryId);
    await tx.dictionaryEntry.delete({ where: { id: row.id } });
    await writeAudit(tx, {
      projectId: s.projectId,
      action: "dictionary.remove",
      actor,
      summary: `Removed "${row.word}" from the ${SCOPE_LABEL[row.projectId ? "project" : "workspace"]}`,
      details: { entryId, word: row.word, caseSensitive: row.caseSensitive, scope: row.projectId ? "project" : "workspace" },
    });
  });
}

export interface BulkAddResult {
  added: DictionaryEntryView[];
  skipped: { word: string; message: string }[];
}

/** Adds the words the author picked (from an import or from reference names). Each is checked again; problems are listed, not hidden. */
export async function addDictionaryEntries(
  db: Db,
  projectId: string,
  scope: DictionaryScope,
  items: readonly { word: string; caseSensitive: boolean; note?: string }[],
  origin: DictionaryOrigin,
  actor = "author",
): Promise<BulkAddResult> {
  return db.$transaction(async (tx) => {
    const s = await scopeOf(tx, projectId);
    const active = await tx.dictionaryEntry.findMany({ where: activeWhere(s) });
    const accepted: (DictionaryWord & { where: string })[] = active.map((r) => ({
      word: r.word,
      caseSensitive: r.caseSensitive,
      where: `the ${SCOPE_LABEL[r.projectId ? "project" : "workspace"]}`,
    }));
    const added: DictionaryEntryView[] = [];
    const skipped: BulkAddResult["skipped"] = [];
    for (const item of items) {
      let entry: DictionaryWord & { note: string };
      try {
        entry = cleanInput({ ...item, scope });
      } catch (e) {
        skipped.push({ word: item.word, message: (e as Error).message });
        continue;
      }
      const dup = findDuplicate(accepted, entry);
      if (dup) {
        skipped.push({ word: entry.word, message: `"${dup.word}" is already in ${dup.where}.` });
        continue;
      }
      const row = await tx.dictionaryEntry.create({
        data: {
          id: newId("dic"),
          workspaceId: s.workspaceId,
          projectId: scope === "project" ? s.projectId : null,
          word: entry.word,
          wordKey: wordKey(entry.word),
          caseSensitive: entry.caseSensitive,
          note: entry.note,
          origin,
        },
      });
      accepted.push({ word: row.word, caseSensitive: row.caseSensitive, where: "the words being added" });
      added.push(view(row));
    }
    if (added.length > 0) {
      await writeAudit(tx, {
        projectId: s.projectId,
        action: origin === "import" ? "dictionary.import" : "dictionary.add",
        actor,
        summary: `Added ${added.length} word${added.length === 1 ? "" : "s"} to the ${SCOPE_LABEL[scope]}${origin === "reference" ? " from reference names" : origin === "import" ? " from an imported list" : ""}`,
        details: { scope, origin, words: added.map((a) => a.word), skipped: skipped.length },
      });
    }
    return { added, skipped };
  });
}

export interface ReferenceTermSuggestion {
  word: string;
  caseSensitive: boolean;
  sources: { recordId: string; title: string }[];
}

const MAX_SOURCES_PER_WORD = 5;

function nameStrings(title: string, fieldsJson: string): string[] {
  const out = [title];
  const fields = parseJsonObject(fieldsJson);
  if (typeof fields.name === "string") out.push(fields.name);
  const aliases = fields.aliases;
  if (typeof aliases === "string") out.push(aliases);
  else if (Array.isArray(aliases)) for (const a of aliases) if (typeof a === "string") out.push(a);
  return out;
}

/**
 * Words from reference titles, `fields.name` and `fields.aliases` that the
 * standard dictionary does not know and no entry accepts yet. Only a list to
 * choose from: nothing is added until the author picks words.
 */
export async function suggestReferenceTerms(
  db: DbOrTx,
  projectId: string,
  isKnown: (word: string) => boolean,
): Promise<ReferenceTermSuggestion[]> {
  const s = await scopeOf(db, projectId);
  const [records, active] = await Promise.all([
    db.record.findMany({ where: { projectId: s.projectId, trashedAt: null }, select: { id: true, type: true, title: true, fields: true }, orderBy: { title: "asc" } }),
    db.dictionaryEntry.findMany({ where: activeWhere(s), select: { word: true, caseSensitive: true } }),
  ]);
  const matcher = new DictionaryMatcher(active);
  const found = new Map<string, ReferenceTermSuggestion>();
  for (const r of records) {
    if (!isRecordType(r.type) || contentClassOf(r.type) !== "reference") continue;
    for (const name of nameStrings(r.title, r.fields)) {
      for (const token of spellTokens(name)) {
        const check = validateDictionaryWord(token.word);
        if (!check.ok || matcher.accepts(check.word) || isKnown(check.word)) continue;
        const entry = found.get(check.word) ?? { word: check.word, caseSensitive: defaultCaseSensitive(check.word), sources: [] };
        if (!entry.sources.some((x) => x.recordId === r.id) && entry.sources.length < MAX_SOURCES_PER_WORD) {
          entry.sources.push({ recordId: r.id, title: r.title });
        }
        found.set(check.word, entry);
      }
    }
  }
  return [...found.values()].sort((a, b) => a.word.localeCompare(b.word));
}

/** Entries of one scope with their notes, for export. */
export async function dictionaryForExport(db: DbOrTx, projectId: string, scope: DictionaryScope) {
  const s = await scopeOf(db, projectId);
  const project = await db.project.findUnique({ where: { id: s.projectId }, include: { workspace: true } });
  const rows = await db.dictionaryEntry.findMany({
    where: scope === "project" ? { workspaceId: s.workspaceId, projectId: s.projectId } : { workspaceId: s.workspaceId, projectId: null },
    orderBy: [{ wordKey: "asc" }, { word: "asc" }],
  });
  return {
    label: scope === "project" ? project!.title : project!.workspace.name,
    entries: rows.map((r) => ({ word: r.word, caseSensitive: r.caseSensitive, note: r.note })),
  };
}
