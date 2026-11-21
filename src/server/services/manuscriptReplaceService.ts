import { errorIssue } from "@/domain/issues";
import type { RecordType } from "@/domain/recordTypes";
import { applySelectedReplacements, findMatches, findRegexMatches, matchId, type Match, type RegexPreviewError } from "@/writing/findReplace";
import type { Db } from "../db";
import { MutationRejectedError } from "./errors";
import { applyMutations } from "./mutationService";
import { listManuscriptInBookOrder } from "./searchService";

const UI_ACTOR = "author";

export interface ManuscriptReplaceMatch {
  id: string;
  recordId: string;
  recordTitle: string;
  recordType: RecordType;
  parentTitle: string | null;
  field: "title" | "body";
  start: number;
  end: number;
  matched: string;
  excerptBefore: string;
  excerptAfter: string;
  protected: boolean;
  expectedRevision: number;
}

export interface ManuscriptReplacePreview {
  find: string;
  replace: string;
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
  regexError: RegexPreviewError | null;
  matches: ManuscriptReplaceMatch[];
}

function excerptAround(text: string, start: number, end: number, window = 36): { before: string; after: string } {
  const bStart = Math.max(0, start - window);
  const aEnd = Math.min(text.length, end + window);
  return {
    before: `${bStart > 0 ? "…" : ""}${text.slice(bStart, start)}`,
    after: `${text.slice(end, aEnd)}${aEnd < text.length ? "…" : ""}`,
  };
}

function collectMatches(
  row: {
    id: string;
    type: RecordType;
    title: string;
    body: string;
    parentTitle: string | null;
    protected: boolean;
    currentRevision: number;
  },
  find: string,
  replace: string,
  options: { matchCase: boolean; wholeWord: boolean; regex: boolean },
): { matches: ManuscriptReplaceMatch[]; error: RegexPreviewError | null } {
  const out: ManuscriptReplaceMatch[] = [];
  let error: RegexPreviewError | null = null;
  const addField = (field: "title" | "body", text: string) => {
    const found = options.regex ? findRegexMatches(text, find, options) : { matches: findMatches(text, find, options), error: null };
    if (found.error) {
      error = found.error;
      return;
    }
    for (const m of found.matches) {
      const { before, after } = excerptAround(text, m.start, m.end);
      out.push({
        id: matchId(row.id, field, m.start, m.end),
        recordId: row.id,
        recordTitle: row.title,
        recordType: row.type,
        parentTitle: row.parentTitle,
        field,
        start: m.start,
        end: m.end,
        matched: text.slice(m.start, m.end),
        excerptBefore: `${before}${text.slice(m.start, m.end)}${after}`,
        excerptAfter: `${before}${replace}${after}`,
        protected: row.protected,
        expectedRevision: row.currentRevision,
      });
    }
  };
  addField("title", row.title);
  if (!error) addField("body", row.body);
  return { matches: error ? [] : out, error };
}

export async function previewManuscriptReplace(
  db: Db,
  input: {
    projectId: string;
    find: string;
    replace: string;
    matchCase: boolean;
    wholeWord: boolean;
    regex?: boolean;
    draftId?: string | null;
    hasDrafts?: boolean;
  },
): Promise<ManuscriptReplacePreview> {
  const find = input.find;
  const replace = input.replace;
  const options = { matchCase: input.matchCase, wholeWord: input.wholeWord, regex: input.regex === true };
  const rows = await listManuscriptInBookOrder(db, {
    projectId: input.projectId,
    draftId: input.draftId,
    hasDrafts: input.hasDrafts,
  });
  const collected = find.trim() ? rows.map((row) => collectMatches(row, find, replace, options)) : [];
  const regexError = collected.find((row) => row.error)?.error ?? null;
  const matches = regexError ? [] : collected.flatMap((row) => row.matches);
  return { find, replace, matchCase: input.matchCase, wholeWord: input.wholeWord, regex: options.regex, regexError, matches };
}

export async function applyManuscriptReplace(
  db: Db,
  input: {
    projectId: string;
    find: string;
    replace: string;
    matchCase: boolean;
    wholeWord: boolean;
    regex?: boolean;
    selectedMatchIds: readonly string[];
    /** Expected revision per record from the preview the author reviewed (recordId → revision). */
    recordRevisions: Readonly<Record<string, number>>;
    unlockProtected?: boolean;
    draftId?: string | null;
    hasDrafts?: boolean;
  },
) {
  const preview = await previewManuscriptReplace(db, input);
  if (preview.regexError) {
    throw new MutationRejectedError([errorIssue("INVALID_CHANGE", "That regular expression was not run. Review the preview and try a simpler pattern.")]);
  }
  if (!preview.find.trim()) {
    throw new MutationRejectedError([errorIssue("INVALID_CHANGE", "Type something to find.")]);
  }
  const selected = new Set(input.selectedMatchIds);
  const chosen = preview.matches.filter((m) => selected.has(m.id));
  if (chosen.length === 0) {
    throw new MutationRejectedError([errorIssue("INVALID_CHANGE", "Choose at least one match to replace.")]);
  }
  if (chosen.length !== selected.size) {
    throw new MutationRejectedError([
      errorIssue("INVALID_CHANGE", "The match list changed. Run the search again and choose your replacements."),
    ]);
  }

  const byRecord = new Map<
    string,
    { row: (typeof preview.matches)[0]; title: Match[]; body: Match[]; expectedRevision: number; protected: boolean; type: RecordType; recordTitle: string }
  >();
  for (const m of chosen) {
    const entry = byRecord.get(m.recordId) ?? {
      row: m,
      title: [],
      body: [],
      expectedRevision: m.expectedRevision,
      protected: m.protected,
      type: m.recordType,
      recordTitle: m.recordTitle,
    };
    if (m.field === "title") entry.title.push({ start: m.start, end: m.end });
    else entry.body.push({ start: m.start, end: m.end });
    byRecord.set(m.recordId, entry);
  }

  const protectedIds = [...byRecord.entries()].filter(([, spec]) => spec.protected).map(([id]) => id);
  if (protectedIds.length > 0 && !input.unlockProtected) {
    throw new MutationRejectedError([
      errorIssue("PROTECTED_RECORD", "One or more matches are in protected records. Confirm you intend to change them."),
    ]);
  }

  const rows = await listManuscriptInBookOrder(db, {
    projectId: input.projectId,
    draftId: input.draftId,
    hasDrafts: input.hasDrafts,
  });
  const textById = new Map(rows.map((r) => [r.id, r]));

  const mutations = [];
  for (const [recordId, spec] of byRecord) {
    const row = textById.get(recordId);
    if (!row) {
      throw new MutationRejectedError([
        errorIssue("INVALID_REFERENCE", `Record ${recordId} is no longer in this manuscript scope.`),
      ]);
    }
    const expectedRevision = input.recordRevisions[recordId] ?? spec.expectedRevision;
    if (row.currentRevision !== expectedRevision) {
      throw new MutationRejectedError([
        errorIssue("STALE_REVISION", `Record ${recordId} changed while you were reviewing. Search again.`, { recordId }),
      ]);
    }
    const newTitle = applySelectedReplacements(row.title, spec.title, preview.replace);
    const newBody = applySelectedReplacements(row.body, spec.body, preview.replace);
    if (newTitle === row.title && newBody === row.body) continue;
    mutations.push({
      kind: "update_record" as const,
      recordId,
      expectedRevision,
      changes: {
        ...(newTitle !== row.title ? { title: newTitle } : {}),
        ...(newBody !== row.body ? { body: newBody } : {}),
      },
    });
  }

  if (mutations.length === 0) {
    throw new MutationRejectedError([errorIssue("INVALID_CHANGE", "Nothing would change with the matches you selected.")]);
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
      action: "manuscript.replace",
      summary: `Replaced "${preview.find}" in ${mutations.length} record${mutations.length === 1 ? "" : "s"} (${chosen.length} match${chosen.length === 1 ? "" : "es"})`,
    },
  );
}