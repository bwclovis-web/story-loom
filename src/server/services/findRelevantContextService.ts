import { parseJsonObject } from "@/domain/json";
import { errorIssue } from "@/domain/issues";
import { isLinkableReferenceType, isManuscriptType, isRecordType } from "@/domain/recordTypes";
import { aliasesOf } from "@/writing/crossRefs";
import { listSections } from "@/writing/sections";
import type { Db, DbOrTx } from "../db";
import { listManuscriptDrafts } from "./draftService";
import { MutationRejectedError } from "./errors";
import { listLinkedReferences } from "./linkService";
import { listReadingPins, resolvePinScope } from "./readingPinService";
import { searchContextReferences } from "./searchService";

/*
 * Suggests reference context for the assistant without sending anything.
 * Ranking: selection terms → linked refs → matching pins → title/alias/section search.
 * Output pins exact revisions and passage/section bounds for preview; the author
 * must confirm into assistant selection before any API send. Pin alone never authorizes send.
 */

export type FindContextLabel = "unsaved" | "zero_draft" | "linked" | "pinned" | "search" | "selection";

export type FindContextKind = "whole" | "sections" | "passage";

export interface FindContextCandidate {
  recordId: string;
  title: string;
  kind: FindContextKind;
  sectionIds?: string[];
  offsets?: { start: number; end: number };
  revisionNumber: number;
  labels: FindContextLabel[];
  /** Preview text that would be sent for this candidate. */
  previewText: string;
  matchedIn?: string;
}

export interface FindRelevantContextInput {
  projectId: string;
  question: string;
  manuscript: {
    recordId: string;
    start?: number;
    end?: number;
    /** Editor body when different from saved; labeled unsaved. */
    unsavedBody?: string | null;
  } | null;
  /** Active Write draft id, or null/omit for resolve. */
  draftScopeId?: string | null;
  includePinnedZeroDraft: boolean;
}

export interface FindRelevantContextResult {
  scopeDraftId: string;
  candidates: FindContextCandidate[];
  /** Snapshot for review/retry: same revision numbers and bounds. */
  snapshot: {
    createdAt: string;
    scopeDraftId: string;
    includePinnedZeroDraft: boolean;
    items: Array<{
      recordId: string;
      revisionNumber: number;
      kind: FindContextKind;
      sectionIds?: string[];
      offsets?: { start: number; end: number };
      labels: FindContextLabel[];
    }>;
  };
}

function rejected(message: string): MutationRejectedError {
  return new MutationRejectedError([errorIssue("INVALID_REFERENCE", message)]);
}

function termsFrom(text: string): string[] {
  const words = text
    .normalize("NFC")
    .split(/[^\p{L}\p{N}'\u2019-]+/u)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3);
  return [...new Set(words.map((w) => w.toLocaleLowerCase()))].slice(0, 24);
}

function textMatchesTerms(haystack: string, terms: readonly string[]): boolean {
  if (!terms.length) return false;
  const h = haystack.toLocaleLowerCase();
  return terms.some((t) => h.includes(t));
}

async function loadRecord(db: DbOrTx, projectId: string, recordId: string) {
  return db.record.findFirst({
    where: { id: recordId, projectId, trashedAt: null },
    select: {
      id: true,
      title: true,
      type: true,
      body: true,
      fields: true,
      draftId: true,
      currentRevision: true,
      authorityStatus: true,
    },
  });
}

/** Discover ranked context candidates; nothing is sent to the provider. */
export async function findRelevantContext(db: Db, input: FindRelevantContextInput): Promise<FindRelevantContextResult> {
  const question = input.question.normalize("NFC").trim();
  if (!question && !input.manuscript) {
    throw rejected("Ask a question or open a manuscript passage first.");
  }

  const drafts = await listManuscriptDrafts(db, input.projectId);
  const scopeDraftId = await resolvePinScope(db, input.projectId, input.draftScopeId);
  const zeroDraft = drafts.find((d) => d.kind === "zero_draft");

  const byId = new Map<string, FindContextCandidate>();
  const bump = (c: FindContextCandidate, label?: FindContextLabel) => {
    const existing = byId.get(c.recordId);
    if (!existing) {
      byId.set(c.recordId, c);
      return;
    }
    const labels = new Set([...existing.labels, ...c.labels, ...(label ? [label] : [])]);
    // Prefer more specific kind already chosen; keep earlier (higher-rank) kind.
    byId.set(c.recordId, {
      ...existing,
      labels: [...labels] as FindContextLabel[],
      previewText: existing.previewText || c.previewText,
      sectionIds: existing.sectionIds ?? c.sectionIds,
      offsets: existing.offsets ?? c.offsets,
    });
  };

  let selectionText = "";
  let manuscriptBody = "";
  let manuscriptUnsaved = false;

  if (input.manuscript) {
    const ms = await loadRecord(db, input.projectId, input.manuscript.recordId);
    if (!ms || !isRecordType(ms.type) || !isManuscriptType(ms.type)) {
      throw rejected("Manuscript seed must be a chapter or scene in this project.");
    }
    if (drafts.length > 0) {
      if (ms.draftId !== scopeDraftId && !(input.includePinnedZeroDraft && zeroDraft && ms.draftId === zeroDraft.id)) {
        throw rejected("Manuscript seed must belong to the active Write draft.");
      }
    }
    manuscriptUnsaved =
      typeof input.manuscript.unsavedBody === "string" &&
      input.manuscript.unsavedBody.normalize("NFC") !== ms.body.normalize("NFC");
    manuscriptBody = manuscriptUnsaved ? input.manuscript.unsavedBody! : ms.body;
    const start = input.manuscript.start;
    const end = input.manuscript.end;
    if (typeof start === "number" && typeof end === "number" && end > start) {
      selectionText = manuscriptBody.slice(start, end);
    }
  }

  const selectionTerms = termsFrom(selectionText);
  const questionTerms = termsFrom(question);
  const searchQuery = [question, selectionText].filter(Boolean).join(" ").trim();

  // (1) Selection-weighted: linked refs and pins that match selection terms first.
  if (input.manuscript) {
    const linked = await listLinkedReferences(db, input.projectId, input.manuscript.recordId);
    for (const l of linked) {
      const rec = await loadRecord(db, input.projectId, l.recordId);
      if (!rec) continue;
      let fields: Record<string, unknown> = {};
      try {
        fields = parseJsonObject(rec.fields);
      } catch {
        fields = {};
      }
      const hay = [rec.title, typeof fields.name === "string" ? fields.name : "", ...aliasesOf(fields), rec.body].join("\n");
      const fromSelection = selectionTerms.length > 0 && textMatchesTerms(hay, selectionTerms);
      const labels: FindContextLabel[] = ["linked"];
      if (fromSelection) labels.unshift("selection");
      if (!fromSelection && selectionTerms.length > 0) {
        // Still include linked refs (rank 2) even without selection match.
      }
      bump({
        recordId: rec.id,
        title: rec.title,
        kind: "whole",
        revisionNumber: rec.currentRevision,
        labels,
        previewText: rec.body,
      });
    }
  }

  // (3) Pins in scope that match question/selection.
  const pins = await listReadingPins(db, input.projectId, scopeDraftId);
  const zeroPins =
    input.includePinnedZeroDraft && zeroDraft && zeroDraft.id !== scopeDraftId
      ? await listReadingPins(db, input.projectId, zeroDraft.id)
      : [];

  for (const pin of [...pins, ...zeroPins]) {
    const rec = await loadRecord(db, input.projectId, pin.recordId);
    if (!rec || !isRecordType(rec.type) || !isLinkableReferenceType(rec.type)) continue;
    let fields: Record<string, unknown> = {};
    try {
      fields = parseJsonObject(rec.fields);
    } catch {
      fields = {};
    }
    const hay = [rec.title, typeof fields.name === "string" ? fields.name : "", ...aliasesOf(fields), ...listSections(rec.body).map((s) => s.title)].join(
      "\n",
    );
    const terms = selectionTerms.length ? selectionTerms : questionTerms;
    if (terms.length && !textMatchesTerms(hay, terms) && !textMatchesTerms(hay, questionTerms)) continue;
    const labels: FindContextLabel[] = ["pinned"];
    if (zeroDraft && zeroPins.some((p) => p.recordId === pin.recordId)) labels.push("zero_draft");
    if (selectionTerms.length && textMatchesTerms(hay, selectionTerms)) labels.unshift("selection");
    bump({
      recordId: rec.id,
      title: rec.title,
      kind: "whole",
      revisionNumber: rec.currentRevision,
      labels,
      previewText: rec.body,
    });
  }

  // (4) Title/alias/section search on question (+ selection text).
  if (searchQuery) {
    const hits = await searchContextReferences(db, { projectId: input.projectId, query: searchQuery, limit: 16 });
    for (const hit of hits) {
      const rec = await loadRecord(db, input.projectId, hit.id);
      if (!rec) continue;
      const sections = hit.sectionId ? [hit.sectionId] : undefined;
      let previewText = rec.body;
      if (hit.sectionId) {
        const sec = listSections(rec.body).find((s) => s.id === hit.sectionId);
        if (sec) previewText = rec.body.slice(sec.start, sec.end);
      }
      bump({
        recordId: rec.id,
        title: rec.title,
        kind: hit.sectionId ? "sections" : "whole",
        sectionIds: sections,
        revisionNumber: hit.currentRevision,
        labels: ["search"],
        previewText,
        matchedIn: hit.matchedIn,
      });
    }
  }

  // Optional: include manuscript passage itself as a labeled candidate for the preview list.
  if (input.manuscript && selectionText) {
    const ms = await loadRecord(db, input.projectId, input.manuscript.recordId);
    if (ms) {
      const labels: FindContextLabel[] = ["selection"];
      if (manuscriptUnsaved) labels.push("unsaved");
      if (zeroDraft && ms.draftId === zeroDraft.id) labels.push("zero_draft");
      // Manuscript is seed, not a reference candidate for selectedRefs — omit from byId.
    }
  }

  // Stable order: selection > linked > pinned > search, then title.
  const rank = (labels: FindContextLabel[]) => {
    if (labels.includes("selection")) return 0;
    if (labels.includes("linked")) return 1;
    if (labels.includes("pinned")) return 2;
    return 3;
  };
  const candidates = [...byId.values()].sort((a, b) => rank(a.labels) - rank(b.labels) || a.title.localeCompare(b.title));

  const snapshot = {
    createdAt: new Date().toISOString(),
    scopeDraftId,
    includePinnedZeroDraft: input.includePinnedZeroDraft,
    items: candidates.map((c) => ({
      recordId: c.recordId,
      revisionNumber: c.revisionNumber,
      kind: c.kind,
      sectionIds: c.sectionIds,
      offsets: c.offsets,
      labels: c.labels,
    })),
  };

  return { scopeDraftId, candidates, snapshot };
}

/** Rehydrate preview text for a saved snapshot (same revisions). */
export async function previewFindContextSnapshot(
  db: DbOrTx,
  projectId: string,
  snapshot: FindRelevantContextResult["snapshot"],
): Promise<FindContextCandidate[]> {
  const out: FindContextCandidate[] = [];
  for (const item of snapshot.items) {
    const rev = await db.revision.findUnique({
      where: { recordId_revisionNumber: { recordId: item.recordId, revisionNumber: item.revisionNumber } },
    });
    if (!rev) continue;
    let previewText = rev.body;
    if (item.kind === "sections" && item.sectionIds?.length) {
      const sections = listSections(rev.body);
      const parts = item.sectionIds.flatMap((id) => {
        const s = sections.find((x) => x.id === id);
        return s ? [rev.body.slice(s.start, s.end)] : [];
      });
      if (parts.length) previewText = parts.join("\n\n");
    } else if (item.kind === "passage" && item.offsets) {
      previewText = rev.body.slice(item.offsets.start, item.offsets.end);
    }
    out.push({
      recordId: item.recordId,
      title: rev.title,
      kind: item.kind,
      sectionIds: item.sectionIds,
      offsets: item.offsets,
      revisionNumber: item.revisionNumber,
      labels: item.labels,
      previewText,
    });
  }
  return out;
}
