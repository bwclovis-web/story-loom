import { errorIssue } from "@/domain/issues";
import type { JsonObject } from "@/domain/json";
import { isRecordType, type RecordType } from "@/domain/recordTypes";
import { aliasesOf, nameFormsFor, nameFormsOf, nameFromTitle } from "@/writing/crossRefs";
import { loadCrossRefIndex } from "./crossRefService";
import {
  applyPerMatchReplacements,
  findMatches,
  matchId,
  type Match,
} from "@/writing/findReplace";
import type { Db } from "../db";
import { MutationRejectedError, NotFoundError } from "./errors";
import { applyMutations } from "./mutationService";
import { getRecord } from "./recordService";
import { listManuscriptInBookOrder } from "./searchService";

const UI_ACTOR = "author";
const NAMED_TYPES = new Set(["character_dossier", "worldbuilding"]);

export interface RecordRenameMatch {
  id: string;
  recordId: string;
  recordTitle: string;
  recordType: RecordType;
  parentTitle: string | null;
  field: "title" | "body";
  start: number;
  end: number;
  form: string;
  replacement: string;
  excerptBefore: string;
  excerptAfter: string;
  ambiguous: boolean;
  protected: boolean;
  expectedRevision: number;
}

export interface RecordRenamePreview {
  recordId: string;
  newTitle: string;
  newFields: JsonObject;
  titleChanges: boolean;
  fieldsChange: boolean;
  matches: RecordRenameMatch[];
}

function excerptAround(text: string, start: number, end: number, window = 36): { before: string; after: string } {
  const bStart = Math.max(0, start - window);
  const aEnd = Math.min(text.length, end + window);
  return {
    before: `${bStart > 0 ? "…" : ""}${text.slice(bStart, start)}`,
    after: `${text.slice(end, aEnd)}${aEnd < text.length ? "…" : ""}`,
  };
}

export function buildFormToNew(
  record: { title: string; type: string; fields: JsonObject },
  input: { newTitle: string; newName: string; newAliases: readonly string[] },
): Map<string, string> {
  const map = new Map<string, string>();
  if (!isRecordType(record.type) || !NAMED_TYPES.has(record.type)) return map;
  const oldTitleName = nameFromTitle(record.title);
  const newTitleName = nameFromTitle(input.newTitle.trim()) || input.newName.trim();
  if (oldTitleName && newTitleName && oldTitleName !== newTitleName) {
    map.set(oldTitleName, newTitleName);
    const bare = oldTitleName.replace(/^The\s+/, "");
    const newBare = newTitleName.replace(/^The\s+/, "");
    if (bare !== oldTitleName && newBare !== newTitleName && bare !== newBare) map.set(bare, newBare);
  }
  const oldAliases = aliasesOf(record.fields);
  input.newAliases.forEach((alias, i) => {
    const from = oldAliases[i];
    const to = alias.trim();
    if (from && to && from !== to) map.set(from, to);
  });
  if (record.type === "character_dossier" && oldTitleName && newTitleName) {
    const { parts } = nameFormsOf({ title: record.title, type: record.type, fields: record.fields });
    const ow = oldTitleName.split(/\s+/);
    const nw = newTitleName.split(/\s+/);
    if (ow.length >= 2 && nw.length >= 2) {
      for (const part of parts) {
        if (part === ow[0] && ow[0] !== nw[0]) map.set(part, nw[0]!);
        if (part === ow[ow.length - 1] && ow[ow.length - 1] !== nw[nw.length - 1]) map.set(part, nw[nw.length - 1]!);
      }
    }
  }
  return map;
}

export async function previewRecordRename(
  db: Db,
  input: {
    projectId: string;
    recordId: string;
    newTitle: string;
    newName: string;
    newAliases: readonly string[];
    draftId?: string | null;
    hasDrafts?: boolean;
  },
): Promise<RecordRenamePreview> {
  const record = await getRecord(db, input.projectId, input.recordId);
  if (!NAMED_TYPES.has(record.type)) {
    throw new MutationRejectedError([
      errorIssue("INVALID_REFERENCE", "Rename everywhere is only for character dossiers and worldbuilding records.", {
        recordId: record.id,
      }),
    ]);
  }
  const index = await loadCrossRefIndex(db, input.projectId);
  const newTitle = input.newTitle.trim() || record.title;
  const newName = input.newName.trim();
  const newFields: JsonObject = { ...record.fields, ...(newName ? { name: newName } : {}), aliases: input.newAliases.map((a) => a.trim()).filter(Boolean) };
  const formToNew = buildFormToNew(record, { newTitle, newName, newAliases: input.newAliases });
  const forms = nameFormsFor(index, record.id);

  const matches: RecordRenameMatch[] = [];
  const findOptions = { matchCase: true, wholeWord: true };
  for (const row of await listManuscriptInBookOrder(db, {
    projectId: input.projectId,
    draftId: input.draftId,
    hasDrafts: input.hasDrafts,
  })) {
    for (const form of forms) {
      const replacement = formToNew.get(form);
      if (!replacement) continue;
      for (const field of ["title", "body"] as const) {
        const text = row[field];
        for (const m of findMatches(text, form, findOptions)) {
          const { before, after } = excerptAround(text, m.start, m.end);
          const ambiguous = (index.names.get(form)?.length ?? 0) > 1;
          matches.push({
            id: matchId(row.id, field, m.start, m.end),
            recordId: row.id,
            recordTitle: row.title,
            recordType: row.type,
            parentTitle: row.parentTitle,
            field,
            start: m.start,
            end: m.end,
            form,
            replacement,
            excerptBefore: `${before}${text.slice(m.start, m.end)}${after}`,
            excerptAfter: `${before}${replacement}${after}`,
            ambiguous,
            protected: row.protected,
            expectedRevision: row.currentRevision,
          });
        }
      }
    }
  }

  return {
    recordId: record.id,
    newTitle,
    newFields,
    titleChanges: newTitle !== record.title,
    fieldsChange: JSON.stringify(newFields) !== JSON.stringify(record.fields),
    matches,
  };
}

export async function applyRecordRename(
  db: Db,
  input: {
    projectId: string;
    recordId: string;
    newTitle: string;
    newName: string;
    newAliases: readonly string[];
    selectedMatchIds: readonly string[];
    recordRevision: number;
    recordRevisions: Readonly<Record<string, number>>;
    unlockProtected?: boolean;
    draftId?: string | null;
    hasDrafts?: boolean;
  },
) {
  const preview = await previewRecordRename(db, {
    projectId: input.projectId,
    recordId: input.recordId,
    newTitle: input.newTitle,
    newName: input.newName,
    newAliases: input.newAliases,
    draftId: input.draftId,
    hasDrafts: input.hasDrafts,
  });
  const record = await getRecord(db, input.projectId, input.recordId);
  if (record.currentRevision !== input.recordRevision) {
    throw new MutationRejectedError([
      errorIssue("STALE_REVISION", "This reference changed while you were reviewing. Start again.", { recordId: record.id }),
    ]);
  }

  const selected = new Set(input.selectedMatchIds);
  const chosen = preview.matches.filter((m) => selected.has(m.id));
  if (chosen.length !== selected.size) {
    throw new MutationRejectedError([
      errorIssue("INVALID_CHANGE", "The match list changed. Preview again and choose your replacements."),
    ]);
  }

  const rows = await listManuscriptInBookOrder(db, {
    projectId: input.projectId,
    draftId: input.draftId,
    hasDrafts: input.hasDrafts,
  });
  const textById = new Map(rows.map((r) => [r.id, r]));

  const byRecord = new Map<string, { title: (Match & { replacement: string })[]; body: (Match & { replacement: string })[] }>();
  for (const m of chosen) {
    const entry = byRecord.get(m.recordId) ?? { title: [], body: [] };
    const item = { start: m.start, end: m.end, replacement: m.replacement };
    if (m.field === "title") entry.title.push(item);
    else entry.body.push(item);
    byRecord.set(m.recordId, entry);
  }

  const protectedIds: string[] = [];
  if (record.protected && (preview.titleChanges || preview.fieldsChange)) protectedIds.push(record.id);
  for (const manuscriptId of byRecord.keys()) {
    const row = textById.get(manuscriptId);
    if (row?.protected) protectedIds.push(manuscriptId);
  }
  if (protectedIds.length > 0 && !input.unlockProtected) {
    throw new MutationRejectedError([
      errorIssue("PROTECTED_RECORD", "One or more records are protected. Confirm you intend to change them."),
    ]);
  }

  const mutations = [];
  if (preview.titleChanges || preview.fieldsChange) {
    mutations.push({
      kind: "update_record" as const,
      recordId: record.id,
      expectedRevision: input.recordRevision,
      changes: {
        ...(preview.titleChanges ? { title: preview.newTitle } : {}),
        ...(preview.fieldsChange
          ? {
              fields: {
                set: preview.newFields,
                unset: Object.keys(record.fields).filter((k) => !(k in preview.newFields)),
              },
            }
          : {}),
      },
    });
  }

  for (const [manuscriptId, spec] of byRecord) {
    const row = textById.get(manuscriptId);
    if (!row) throw new NotFoundError(`Record ${manuscriptId} not found`);
    const expectedRevision = input.recordRevisions[manuscriptId] ?? row.currentRevision;
    if (row.currentRevision !== expectedRevision) {
      throw new MutationRejectedError([
        errorIssue("STALE_REVISION", `Record ${manuscriptId} changed while you were reviewing. Start again.`, {
          recordId: manuscriptId,
        }),
      ]);
    }
    const newTitle = applyPerMatchReplacements(row.title, spec.title);
    const newBody = applyPerMatchReplacements(row.body, spec.body);
    if (newTitle === row.title && newBody === row.body) continue;
    mutations.push({
      kind: "update_record" as const,
      recordId: manuscriptId,
      expectedRevision,
      changes: {
        ...(newTitle !== row.title ? { title: newTitle } : {}),
        ...(newBody !== row.body ? { body: newBody } : {}),
      },
    });
  }

  if (mutations.length === 0) {
    throw new MutationRejectedError([errorIssue("INVALID_CHANGE", "Nothing would change with the names and matches you selected.")]);
  }

  return applyMutations(
    db,
    {
      projectId: input.projectId,
      actor: UI_ACTOR,
      source: { kind: "ui" },
      scope: "manuscript",
      protectedOverrides: new Set(input.unlockProtected ? protectedIds : []),
    },
    mutations,
    {
      action: "record.rename",
      summary: `Renamed "${record.title}" across ${mutations.length} record${mutations.length === 1 ? "" : "s"}`,
    },
  );
}