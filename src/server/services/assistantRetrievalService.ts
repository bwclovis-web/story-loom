import {
  developmentIsEmpty,
  readCharacterDevelopment,
  renderCharacterContextSlice,
  type NarrativePoint,
} from "@/domain/characterDevelopment";
import { withSeriesBookOrderFallback } from "@/domain/characterWritingContext";
import { parseJsonObject, type JsonObject } from "@/domain/json";
import { isWorldProfileRecordType } from "@/domain/worldProfile";
import { contentClassOf, isManuscriptType, isRecordType, RECORD_TYPE_LABELS, type RecordType } from "@/domain/recordTypes";
import { isAuthorityStatus } from "@/domain/statuses";
import type { ContextDocument, ContextKind } from "@/assistant/prompt";
import type { RetrievalContextState, RetrievalMeta, RetrievalOmission } from "@/assistant/retrievalMeta";
import { isAssistantToolName, type RetrievalScope } from "@/assistant/tools";
import type { OrderEdge } from "@/world/storyOrder";
import type { SeriesHomeRef } from "@/world/seriesHome";
import { aliasesOf } from "@/writing/crossRefs";
import { hasSectionStatus, listSections, sectionPath } from "@/writing/sections";
import { buildManuscriptTree } from "@/ui/manuscriptTree";
import type { Db, DbOrTx } from "../db";
import { loadFocusManuscript, narrativePointForManuscript } from "./characterWritingContextService";
import { listEstablishedFactsForSubject } from "./establishedFactService";
import { listSeriesBookProjects } from "./projectService";
import { searchContextReferences, searchManuscript, searchProjectRecords } from "./searchService";
import { listAvailableReferences, resolveAvailableReference } from "./seriesBibleService";
import {
  chapterEventSequence,
  eventReveals,
  eventsAtPlace,
  eventsBeforeManuscript,
  type TimelineAnswer,
  type TimelineSource,
} from "./storyTimelineQuery";
import { LIVE_PROJECT } from "./trashFilters";
import { draftingModeFromScope, renderWorldReferenceForAssistant } from "./worldWritingContextService";

/*
 * Read-only tool handlers for the assistant discussion loop. Reuses search,
 * section listing, established facts, and Weave rows. Never writes records.
 */

export type RetrievalContext = RetrievalContextState;

export interface ToolExecution {
  /** JSON text returned to the model. */
  output: string;
  /** Full passages that were supplied to the model (for SOURCE audit). */
  documents: ContextDocument[];
}

function omit(meta: RetrievalMeta, omission: RetrievalOmission) {
  meta.omissions.push(omission);
}

function referenceText(
  title: string,
  body: string,
  fieldsJson: string,
  recordType?: string,
  opts?: {
    scope?: RetrievalScope;
    projectId?: string;
    recordId?: string;
    point?: NarrativePoint | null;
    edges?: readonly OrderEdge[];
    bookIds?: readonly string[];
    home?: SeriesHomeRef | null;
  },
): string {
  try {
    const fields = parseJsonObject(fieldsJson) as JsonObject;
    if (recordType === "character_dossier") {
      const read = readCharacterDevelopment(fields);
      if (!developmentIsEmpty(read.profile)) {
        const drafting = opts?.scope === "chapter";
        const profile = opts?.bookIds?.length ? withSeriesBookOrderFallback(read.profile, opts.bookIds) : read.profile;
        return renderCharacterContextSlice({
          title,
          body,
          profile,
          slice: drafting ? "dialogue" : "continuity",
          bookProjectId: opts?.point?.bookProjectId ?? opts?.projectId ?? null,
          point: opts?.point,
          edges: opts?.edges,
          knowledgeHolders: drafting ? ["character", "both"] : ["character", "reader", "both"],
          includePlannedKnowledge: false,
        });
      }
    }
    const world = renderWorldReferenceForAssistant({
      title,
      recordId: opts?.recordId ?? "",
      type: recordType ?? "",
      body,
      fields,
      mode: draftingModeFromScope(opts?.scope),
      point: opts?.point,
      edges: opts?.edges,
      bookIds: opts?.bookIds,
      viewingProjectId: opts?.projectId ?? opts?.point?.bookProjectId ?? null,
      home: opts?.home,
    });
    if (world) return world.text;
    return Object.keys(fields).length ? `${body}\n\nStructured fields (JSON): ${JSON.stringify(fields)}` : body;
  } catch {
    return body;
  }
}

/** Manuscript / planning may look across series books; references use resolveAvailableReference. */
async function projectIdsForScope(db: DbOrTx, ctx: RetrievalContext): Promise<string[]> {
  if (ctx.scope === "series") {
    const siblings = await listSeriesBookProjects(db, ctx.projectId);
    if (siblings.length) return siblings.map((s) => s.id);
  }
  return [ctx.projectId];
}

function isDraftingRetrieval(ctx: RetrievalContext): boolean {
  return ctx.scope === "chapter";
}

async function resolveToolReference(db: DbOrTx, ctx: RetrievalContext, recordId: string) {
  return resolveAvailableReference(db, ctx.projectId, recordId);
}

async function chapterTreeIds(db: DbOrTx, projectId: string, focusRecordId: string | null, draftId: string | null): Promise<string[] | null> {
  if (!focusRecordId) return null;
  const focus = await db.record.findFirst({
    where: { id: focusRecordId, projectId, trashedAt: null },
    select: { id: true, type: true, parentRecordId: true, draftId: true },
  });
  if (!focus || !isRecordType(focus.type) || !isManuscriptType(focus.type)) return null;
  const chapterId =
    focus.type === "manuscript_chapter" ? focus.id : focus.type === "manuscript_scene" ? focus.parentRecordId : focus.parentRecordId;
  if (!chapterId) return [focus.id];
  const rows = await db.record.findMany({
    where: {
      projectId,
      trashedAt: null,
      type: { in: ["manuscript_chapter", "manuscript_scene", "scene_note"] },
      ...(draftId ? { draftId } : {}),
      OR: [{ id: chapterId }, { parentRecordId: chapterId }, { parentRecordId: { in: await sceneIds(db, projectId, chapterId) } }],
    },
    select: { id: true },
  });
  return [...new Set([chapterId, ...rows.map((r) => r.id)])];
}

async function sceneIds(db: DbOrTx, projectId: string, chapterId: string): Promise<string[]> {
  const scenes = await db.record.findMany({
    where: { projectId, parentRecordId: chapterId, type: "manuscript_scene", trashedAt: null },
    select: { id: true },
  });
  return scenes.map((s) => s.id);
}

function normName(s: string): string {
  return s.normalize("NFC").trim().toLowerCase();
}

async function searchProjectTool(db: DbOrTx, ctx: RetrievalContext, args: Record<string, unknown>): Promise<ToolExecution> {
  const query = String(args.query ?? "").trim();
  if (!query) return { output: JSON.stringify({ error: "query_required" }), documents: [] };
  const includeManuscript = Boolean(args.includeManuscript);
  const includeReferences = Boolean(args.includeReferences);
  const includeFacts = Boolean(args.includeFacts);
  let includePlanning = Boolean(args.includePlanning);
  const drafting = isDraftingRetrieval(ctx);
  if (drafting && includePlanning) {
    omit(ctx.meta, {
      label: "Planning search",
      reason: "Planning (Weave) results are omitted while drafting at chapter scope.",
    });
    includePlanning = false;
  }
  const projectIds = await projectIdsForScope(db, ctx);
  const chapterIds = ctx.scope === "chapter" ? await chapterTreeIds(db, ctx.projectId, ctx.focusRecordId, ctx.draftId) : null;

  const hits: object[] = [];
  const omitted: RetrievalOmission[] = [];
  const seenRefIds = new Set<string>();

  if (includeReferences) {
    // Search viewing project only — searchContextReferences already includes series-shared.
    const refHits = await searchContextReferences(db, { projectId: ctx.projectId, query, limit: 24 });
    for (const h of refHits) {
      if (seenRefIds.has(h.id)) continue;
      seenRefIds.add(h.id);
      if (ctx.excludeRecordIds.has(h.id)) {
        omitted.push({ label: h.title, recordId: h.id, reason: "Excluded by the author for this question." });
        continue;
      }
      const available = await resolveToolReference(db, ctx, h.id);
      if (!available) {
        omitted.push({
          label: h.title,
          recordId: h.id,
          reason: "Book-local or unavailable reference omitted from this book's scope.",
        });
        continue;
      }
      hits.push({
        corpus: "reference",
        projectId: available.home?.projectId ?? ctx.projectId,
        recordId: h.id,
        title: h.title,
        type: h.type,
        revision: h.currentRevision,
        matchedIn: h.matchedIn,
        excerpt: h.excerpt,
        sectionId: h.sectionId,
        sectionTitle: h.sectionTitle,
        seriesHome: available.home,
      });
    }
  }

  for (const projectId of projectIds) {
    if (includeManuscript) {
      const ms = await searchManuscript(db, {
        projectId,
        query,
        matchCase: false,
        draftId: ctx.draftId,
        hasDrafts: ctx.draftId != null,
      });
      for (const h of ms.hits) {
        if (chapterIds && !chapterIds.includes(h.id)) continue;
        if (ctx.excludeRecordIds.has(h.id)) {
          omitted.push({ label: h.title, recordId: h.id, reason: "Excluded by the author for this question." });
          continue;
        }
        hits.push({
          corpus: "manuscript",
          projectId,
          recordId: h.id,
          title: h.title,
          type: h.type,
          parentTitle: h.parentTitle,
          matchCount: h.count,
          excerpts: h.excerpts.slice(0, 3).map((e) => ({
            text: `${e.cutBefore ? "…" : ""}${e.before}${e.match}${e.after}${e.cutAfter ? "…" : ""}`,
          })),
          orderNote: "Matches are in manuscript book order, not story chronology.",
        });
      }
    }
    if (includeFacts) {
      const facts = await db.establishedFact.findMany({
        where: { projectId, status: "accepted", statement: { contains: query } },
        take: 12,
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          subjectRecordId: true,
          statement: true,
          evidenceKind: true,
          subject: { select: { title: true } },
        },
      });
      for (const f of facts) {
        if (ctx.excludeRecordIds.has(f.subjectRecordId)) continue;
        const available = await resolveToolReference(db, ctx, f.subjectRecordId);
        if (!available) {
          omitted.push({
            label: f.subject.title,
            recordId: f.subjectRecordId,
            reason: "Accepted fact subject is not available from this book.",
          });
          continue;
        }
        if (drafting && f.evidenceKind === "planned") {
          omitted.push({
            label: f.statement.slice(0, 80),
            recordId: f.subjectRecordId,
            reason: "Planned fact evidence omitted from drafting context.",
          });
          continue;
        }
        hits.push({
          corpus: "accepted_fact",
          projectId,
          factId: f.id,
          subjectRecordId: f.subjectRecordId,
          subjectTitle: f.subject.title,
          statement: f.statement,
          evidenceKind: f.evidenceKind,
          evidenceLabel:
            f.evidenceKind === "zero_draft"
              ? "Zero-draft evidence (not author manuscript)"
              : f.evidenceKind === "planned"
                ? "Planned / future evidence"
                : "Author-rewrite evidence",
        });
      }
    }
    if (includePlanning) {
      const planHits = await searchPlanningInProject(db, projectId, query, 12);
      hits.push(...planHits.map((h) => ({ ...h, projectId, corpus: "planning" })));
    }
  }

  for (const o of omitted) omit(ctx.meta, o);
  if (!hits.length) {
    omit(ctx.meta, { label: query, reason: "Search returned no matches in the chosen scope." });
  }

  return {
    output: JSON.stringify({
      scope: ctx.scope,
      query,
      hitCount: hits.length,
      hits: hits.slice(0, 40),
      note: "Excerpts only. Call read_passage or list_sections for full text. Planning and zero-draft hits are not settled manuscript canon.",
    }),
    documents: [],
  };
}

async function searchPlanningInProject(db: DbOrTx, projectId: string, query: string, limit: number) {
  const q = query.normalize("NFC").toLowerCase();
  const grids = await db.weaveGrid.findMany({
    where: { projectId },
    select: {
      id: true,
      title: true,
      viewKind: true,
      threads: { select: { id: true, title: true } },
      beats: { select: { id: true, title: true, body: true, decision: true } },
    },
  });
  const out: object[] = [];
  for (const g of grids) {
    if (g.title.toLowerCase().includes(q)) {
      out.push({
        kind: "weave_grid",
        gridId: g.id,
        title: g.title,
        viewKind: g.viewKind,
        label: "Planning (Weave grid) — not manuscript prose",
      });
    }
    for (const t of g.threads) {
      if (t.title.toLowerCase().includes(q)) {
        out.push({
          kind: "weave_thread",
          gridId: g.id,
          threadId: t.id,
          title: t.title,
          label: "Planning (story thread) — not manuscript prose",
        });
      }
    }
    for (const b of g.beats) {
      if (b.title.toLowerCase().includes(q) || b.body.toLowerCase().includes(q)) {
        out.push({
          kind: "weave_beat",
          gridId: g.id,
          beatId: b.id,
          title: b.title,
          bodyExcerpt: b.body.slice(0, 200),
          decision: b.decision,
          label: "Planning (beat) — future plan unless linked to a scene",
        });
      }
    }
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}

async function readPassageTool(db: DbOrTx, ctx: RetrievalContext, args: Record<string, unknown>): Promise<ToolExecution> {
  const recordId = String(args.recordId ?? "");
  const revision = Number(args.revision);
  const sectionId = args.sectionId == null ? null : String(args.sectionId);
  const start = args.start == null ? null : Number(args.start);
  const end = args.end == null ? null : Number(args.end);

  if (ctx.excludeRecordIds.has(recordId)) {
    omit(ctx.meta, { label: recordId, recordId, reason: "Excluded by the author for this question." });
    return { output: JSON.stringify({ error: "excluded", recordId }), documents: [] };
  }

  const available = await resolveToolReference(db, ctx, recordId);
  if (!available) {
    // Manuscript chapters remain local-only (and series-scope siblings via projectIds).
    const projectIds = await projectIdsForScope(db, ctx);
    const localMs = await db.record.findFirst({
      where: { id: recordId, projectId: { in: projectIds }, trashedAt: null },
    });
    if (!localMs || contentClassOf(localMs.type as RecordType) !== "manuscript") {
      return { output: JSON.stringify({ error: "not_found", recordId }), documents: [] };
    }
  }
  const record =
    available != null
      ? await db.record.findFirst({ where: { id: available.record.id, trashedAt: null } })
      : await db.record.findFirst({
          where: { id: recordId, projectId: { in: await projectIdsForScope(db, ctx) }, trashedAt: null },
        });
  if (!record || !isRecordType(record.type) || !isAuthorityStatus(record.authorityStatus)) {
    return { output: JSON.stringify({ error: "not_found", recordId }), documents: [] };
  }
  if (revision !== record.currentRevision) {
    return {
      output: JSON.stringify({
        error: "stale_revision",
        recordId,
        expected: revision,
        current: record.currentRevision,
        note: "Re-read at the current revision.",
      }),
      documents: [],
    };
  }

  const focus = await loadFocusManuscript(db, ctx.projectId, ctx.focusRecordId);
  const { point, edges, bookIds } = await narrativePointForManuscript(db, ctx.projectId, focus);
  const drafting = isDraftingRetrieval(ctx);
  let text =
    contentClassOf(record.type) === "reference"
      ? referenceText(record.title, record.body, record.fields, record.type, {
          scope: ctx.scope,
          projectId: ctx.projectId,
          recordId: record.id,
          point,
          edges,
          bookIds,
          home: available?.home ?? null,
        })
      : record.body;
  let kind: ContextKind = contentClassOf(record.type) === "reference" ? "reference" : "manuscript";
  let passage: { start: number; end: number } | undefined;
  let section: ContextDocument["section"];

  if (sectionId) {
    const sections = listSections(record.body);
    const match = sections.find((s) => s.id === sectionId);
    if (!match) return { output: JSON.stringify({ error: "section_not_found", sectionId }), documents: [] };
    if (drafting && match.statusTag) {
      const upper = match.statusTag.toUpperCase();
      if (
        upper.includes("PROPOSED") ||
        upper.includes("WORKING") ||
        upper.includes("OPEN") ||
        upper.includes("SELECTED")
      ) {
        omit(ctx.meta, {
          label: match.title,
          recordId,
          reason: "Unsettled section omitted from drafting read.",
        });
        return { output: JSON.stringify({ error: "section_omitted", sectionId, reason: "unsettled" }), documents: [] };
      }
    }
    if (drafting && isWorldProfileRecordType(record.type)) {
      // Prefer point-scoped slice over raw section body for world profiles.
      text = referenceText(record.title, record.body, record.fields, record.type, {
        scope: ctx.scope,
        projectId: ctx.projectId,
        recordId: record.id,
        point,
        edges,
        bookIds,
        home: available?.home ?? null,
      });
      kind = "reference";
    } else {
      text = record.body.slice(match.start, match.end);
      kind = "section";
      passage = { start: match.start, end: match.end };
      section = { path: sectionPath(sections, match.id).map((h) => h.title), statusTag: match.statusTag };
    }
  } else if (start != null && end != null) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > record.body.length) {
      return { output: JSON.stringify({ error: "invalid_passage_bounds" }), documents: [] };
    }
    if (drafting && isWorldProfileRecordType(record.type)) {
      omit(ctx.meta, {
        label: record.title,
        recordId,
        reason: "Raw body passage reads of world profiles are omitted while drafting; use the point-scoped slice.",
      });
      text = referenceText(record.title, record.body, record.fields, record.type, {
        scope: ctx.scope,
        projectId: ctx.projectId,
        recordId: record.id,
        point,
        edges,
        bookIds,
        home: available?.home ?? null,
      });
      kind = "reference";
    } else {
      text = record.body.slice(start, end);
      kind = "passage";
      passage = { start, end };
    }
  }

  if (text.length > ctx.maxResultChars) {
    omit(ctx.meta, {
      label: record.title,
      recordId,
      reason: `Read refused: ${text.length.toLocaleString("en-US")} characters exceeds the tool result limit (${ctx.maxResultChars.toLocaleString("en-US")}). Use a section or shorter passage.`,
    });
    return {
      output: JSON.stringify({
        error: "too_large",
        recordId,
        chars: text.length,
        limit: ctx.maxResultChars,
        hint: "Call list_sections and read one section, or pass a smaller start/end.",
      }),
      documents: [],
    };
  }

  const draftLabel =
    record.draftId &&
    (await db.manuscriptDraft.findFirst({ where: { id: record.draftId }, select: { kind: true } }))?.kind === "zero_draft"
      ? "Zero-draft manuscript (not author manuscript)"
      : undefined;

  const doc: ContextDocument = {
    recordId: record.id,
    title: record.title,
    type: record.type,
    authorityStatus: record.authorityStatus,
    revision: record.currentRevision,
    kind,
    text,
    passage,
    section,
    statusMarkedInText: hasSectionStatus(record.body) || undefined,
  };
  ctx.meta.sources.push({
    recordId: doc.recordId,
    title: doc.title,
    kind: doc.kind,
    revision: doc.revision,
    passageStart: passage?.start ?? null,
    passageEnd: passage?.end ?? null,
    origin: "tool",
    evidenceLabel: draftLabel,
  });

  return {
    output: JSON.stringify({
      recordId: record.id,
      title: record.title,
      type: RECORD_TYPE_LABELS[record.type],
      revision: record.currentRevision,
      kind,
      passage,
      sectionPath: section?.path,
      sectionStatus: section?.statusTag ?? null,
      evidenceLabel: draftLabel ?? null,
      text,
      chars: text.length,
    }),
    documents: [doc],
  };
}

async function listSectionsTool(db: DbOrTx, ctx: RetrievalContext, args: Record<string, unknown>): Promise<ToolExecution> {
  const recordId = String(args.recordId ?? "");
  if (ctx.excludeRecordIds.has(recordId)) {
    return { output: JSON.stringify({ error: "excluded", recordId }), documents: [] };
  }
  const available = await resolveToolReference(db, ctx, recordId);
  let record = available
    ? await db.record.findFirst({ where: { id: available.record.id, trashedAt: null } })
    : null;
  if (!record) {
    const projectIds = await projectIdsForScope(db, ctx);
    record = await db.record.findFirst({ where: { id: recordId, projectId: { in: projectIds }, trashedAt: null } });
  }
  if (!record || !isRecordType(record.type)) return { output: JSON.stringify({ error: "not_found" }), documents: [] };
  const drafting = isDraftingRetrieval(ctx);
  const sections = listSections(record.body).flatMap((s) => {
    if (drafting && s.statusTag) {
      const upper = s.statusTag.toUpperCase();
      if (
        upper.includes("PROPOSED") ||
        upper.includes("WORKING") ||
        upper.includes("OPEN") ||
        upper.includes("SELECTED")
      ) {
        omit(ctx.meta, {
          label: s.title,
          recordId,
          reason: "Unsettled section omitted from drafting section list.",
        });
        return [];
      }
    }
    return [
      {
        id: s.id,
        parentId: s.parentId,
        level: s.level,
        title: s.title,
        statusTag: s.statusTag,
        chars: s.end - s.start,
        start: s.start,
        end: s.end,
      },
    ];
  });
  return {
    output: JSON.stringify({
      recordId,
      title: record.title,
      revision: record.currentRevision,
      sections,
      note: "A section runs to the next heading of the same or higher level.",
    }),
    documents: [],
  };
}

async function resolveNameTool(db: DbOrTx, ctx: RetrievalContext, args: Record<string, unknown>): Promise<ToolExecution> {
  const name = String(args.name ?? "").trim();
  if (!name) return { output: JSON.stringify({ error: "name_required" }), documents: [] };
  const needle = normName(name);
  const available = await listAvailableReferences(db, ctx.projectId, {
    types: ["character_dossier", "worldbuilding"],
  });

  const matches: Array<{
    recordId: string;
    title: string;
    type: RecordType;
    revision: number;
    projectId: string;
    matchedAs: string;
  }> = [];

  for (const entry of available) {
    const row = entry.record;
    if (ctx.excludeRecordIds.has(row.id)) continue;
    const fields = row.fields;
    const candidates = [
      row.title,
      typeof fields.name === "string" ? fields.name : "",
      ...aliasesOf(fields),
    ].filter(Boolean);
    const hit = candidates.find((c) => normName(c) === needle || normName(c).includes(needle));
    if (hit) {
      matches.push({
        recordId: row.id,
        title: row.title,
        type: row.type,
        revision: row.currentRevision,
        projectId: entry.home?.projectId ?? ctx.projectId,
        matchedAs: hit,
      });
    }
  }

  if (matches.length === 0) {
    omit(ctx.meta, { label: name, reason: "No character or place record matched that name or alias." });
    return { output: JSON.stringify({ name, matches: [], ambiguous: false }), documents: [] };
  }
  if (matches.length > 1) {
    ctx.meta.ambiguousNames.push(name);
    return {
      output: JSON.stringify({
        name,
        ambiguous: true,
        matches,
        instruction: "Ask the author which record they mean. Do not guess.",
      }),
      documents: [],
    };
  }
  return { output: JSON.stringify({ name, ambiguous: false, matches }), documents: [] };
}

async function listAcceptedFactsTool(db: DbOrTx, ctx: RetrievalContext, args: Record<string, unknown>): Promise<ToolExecution> {
  const subjectRecordId = String(args.subjectRecordId ?? "");
  if (ctx.excludeRecordIds.has(subjectRecordId)) {
    return { output: JSON.stringify({ error: "excluded" }), documents: [] };
  }
  const available = await resolveToolReference(db, ctx, subjectRecordId);
  if (!available) {
    omit(ctx.meta, {
      label: subjectRecordId,
      recordId: subjectRecordId,
      reason: "Fact subject is not available from this book.",
    });
    return { output: JSON.stringify({ error: "not_found", subjectRecordId }), documents: [] };
  }
  const homeProjectId = available.home?.projectId ?? ctx.projectId;
  const facts = await listEstablishedFactsForSubject(db, homeProjectId, subjectRecordId);
  const drafting = isDraftingRetrieval(ctx);
  const focus = drafting ? await loadFocusManuscript(db, ctx.projectId, ctx.focusRecordId) : null;
  const narrative = drafting ? await narrativePointForManuscript(db, ctx.projectId, focus) : null;
  const accepted = facts.filter((f) => f.status === "accepted");
  const filtered = accepted.flatMap((f) => {
    if (drafting && f.evidenceKind === "planned") {
      omit(ctx.meta, {
        label: f.statement.slice(0, 80),
        recordId: subjectRecordId,
        reason: "Planned fact omitted from drafting context.",
      });
      return [];
    }
    const evidence = f.evidence.flatMap((e) => {
      if (drafting && e.evidenceKind === "planned") {
        omit(ctx.meta, {
          label: e.sourceTitle,
          recordId: e.sourceRecordId,
          reason: "Planned fact evidence excerpt omitted from drafting context.",
        });
        return [];
      }
      return [
        {
          sourceRecordId: e.sourceRecordId,
          sourceTitle: e.sourceTitle,
          revisionNumber: e.revisionNumber,
          passageStart: e.passageStart,
          passageEnd: e.passageEnd,
          excerpt: drafting && e.evidenceKind === "planned" ? "" : e.passageExcerpt,
          evidenceKind: e.evidenceKind,
          evidenceKindLabel: e.evidenceKindLabel,
          needsRecheck: e.needsRecheck,
          staleNotice: e.needsRecheck ? "Source revised after this evidence was linked." : null,
        },
      ];
    });
    // When anchored, drop facts whose evidence sources are scenes after the point (best-effort).
    if (drafting && narrative?.point.storyEventId) {
      // Keep facts; world chronology is handled by world slice. Manuscript after-point filtering
      // is limited to planned evidence above.
      void narrative;
    }
    return [
      {
        id: f.id,
        statement: f.statement,
        evidenceKind: f.evidenceKind,
        evidenceKindLabel: f.evidenceKindLabel,
        passageEvidenceCount: evidence.length,
        missingPassageEvidence: evidence.length === 0,
        evidence,
      },
    ];
  });
  return {
    output: JSON.stringify({
      subjectRecordId,
      facts: filtered,
      note: "Zero-draft and planned evidence are labeled; do not treat them as author-manuscript canon. missingPassageEvidence means no passage is pinned. Acceptance alone is not evidence.",
    }),
    documents: [],
  };
}

async function searchPlanningTool(db: DbOrTx, ctx: RetrievalContext, args: Record<string, unknown>): Promise<ToolExecution> {
  const query = String(args.query ?? "").trim();
  if (!query) return { output: JSON.stringify({ error: "query_required" }), documents: [] };
  if (isDraftingRetrieval(ctx)) {
    omit(ctx.meta, {
      label: "Planning search",
      reason: "Planning (Weave) search is omitted while drafting at chapter scope.",
    });
    return {
      output: JSON.stringify({
        hits: [],
        omitted: true,
        note: "Planning search is not available while drafting.",
      }),
      documents: [],
    };
  }
  const projectIds = await projectIdsForScope(db, ctx);
  const hits: object[] = [];
  for (const projectId of projectIds) {
    hits.push(...(await searchPlanningInProject(db, projectId, query, 20)).map((h) => ({ ...h, projectId })));
  }
  if (!hits.length) omit(ctx.meta, { label: query, reason: "No planning (Weave) matches in scope." });
  return {
    output: JSON.stringify({
      hits,
      note: "These are future plans / story maps, not settled manuscript text.",
    }),
    documents: [],
  };
}

async function listEarlierScenesTool(db: DbOrTx, ctx: RetrievalContext, args: Record<string, unknown>): Promise<ToolExecution> {
  const beforeRecordId = String(args.beforeRecordId ?? ctx.focusRecordId ?? "");
  const draftId = args.draftId == null ? ctx.draftId : String(args.draftId);
  if (!beforeRecordId) {
    return {
      output: JSON.stringify({
        error: "no_focus",
        note: "No open chapter/scene. Ask the author which scene to use as the knowledge cutoff.",
      }),
      documents: [],
    };
  }

  const rows = await db.record.findMany({
    where: {
      projectId: ctx.projectId,
      trashedAt: null,
      type: { in: ["manuscript_chapter", "manuscript_scene"] },
      ...(draftId ? { draftId } : {}),
    },
    select: {
      id: true,
      title: true,
      type: true,
      parentRecordId: true,
      position: true,
      currentRevision: true,
      draftId: true,
      createdAt: true,
    },
  });
  const tree = buildManuscriptTree(
    rows.map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type as "manuscript_chapter" | "manuscript_scene",
      parentRecordId: r.parentRecordId,
      position: r.position,
      createdAt: r.createdAt.toISOString(),
      draftId: r.draftId,
    })),
  );
  type Ordered = { id: string; title: string; type: "manuscript_chapter" | "manuscript_scene" };
  const ordered: Ordered[] = [];
  for (const ch of tree.chapters) {
    ordered.push({ id: ch.id, title: ch.title, type: "manuscript_chapter" });
    for (const s of ch.scenes) ordered.push({ id: s.id, title: s.title, type: "manuscript_scene" });
  }
  for (const s of tree.unplaced) ordered.push({ id: s.id, title: s.title, type: "manuscript_scene" });
  const idx = ordered.findIndex((r) => r.id === beforeRecordId);
  if (idx < 0) {
    return { output: JSON.stringify({ error: "not_in_manuscript", beforeRecordId }), documents: [] };
  }
  const earlier = ordered.slice(0, idx).map((r, i) => {
    const row = rows.find((x) => x.id === r.id)!;
    return {
      recordId: r.id,
      title: r.title,
      type: r.type,
      revision: row.currentRevision,
      manuscriptOrderIndex: i,
    };
  });
  return {
    output: JSON.stringify({
      beforeRecordId,
      earlierCount: earlier.length,
      earlier,
      orderNote:
        "Order is manuscript book order (Write → Book order), not story chronology. A character may know events from later manuscript pages if those events are earlier in story time — say when you cannot tell.",
    }),
    documents: [],
  };
}

function noteTimeline(ctx: RetrievalContext, sources: TimelineSource[]) {
  for (const source of sources) {
    ctx.meta.sources.push({
      recordId: source.recordId ?? "",
      title: source.title,
      kind: source.evidenceLabel?.startsWith("Revealing") || source.evidenceLabel === "Chapter" || source.evidenceLabel === "Scene" ? "manuscript" : "reference",
      revision: source.revision,
      passageStart: source.passageStart,
      passageEnd: source.passageEnd,
      origin: "tool",
      evidenceLabel: source.evidenceLabel,
      eventId: source.eventId,
      mapId: source.mapId,
      pinId: source.pinId,
      stale: source.stale,
    });
  }
}

function answerOf(ctx: RetrievalContext, result: TimelineAnswer): ToolExecution {
  for (const title of result.omittedManuscript) {
    omit(ctx.meta, { label: title, reason: "Outside the open chapter." });
  }
  const output = JSON.stringify(result.payload);
  if (output.length > ctx.maxResultChars) {
    omit(ctx.meta, {
      label: "Story timeline",
      reason: `Read refused: ${output.length.toLocaleString("en-US")} characters exceeds the tool result limit.`,
    });
    return {
      output: JSON.stringify({ error: "too_large", chars: output.length, limit: ctx.maxResultChars }),
      documents: [],
    };
  }
  noteTimeline(ctx, result.sources);
  return { output, documents: [] };
}

async function draftForTools(ctx: RetrievalContext): Promise<string> {
  return ctx.draftId ?? "all";
}

async function chapterLimit(db: DbOrTx, ctx: RetrievalContext): Promise<ReadonlySet<string> | null> {
  if (ctx.scope !== "chapter") return null;
  const ids = await chapterTreeIds(db, ctx.projectId, ctx.focusRecordId, ctx.draftId);
  return ids ? new Set(ids) : new Set();
}

async function eventsAtPlaceTool(db: DbOrTx, ctx: RetrievalContext, args: Record<string, unknown>): Promise<ToolExecution> {
  const locationRecordId = String(args.locationRecordId ?? "");
  if (!locationRecordId) return { output: JSON.stringify({ error: "location_required" }), documents: [] };
  if (ctx.excludeRecordIds.has(locationRecordId)) {
    omit(ctx.meta, { label: locationRecordId, recordId: locationRecordId, reason: "Excluded by the author for this question." });
    return { output: JSON.stringify({ error: "excluded", locationRecordId }), documents: [] };
  }
  const available = await resolveToolReference(db, ctx, locationRecordId);
  if (!available) return { output: JSON.stringify({ error: "not_found", locationRecordId }), documents: [] };
  const drafting = isDraftingRetrieval(ctx);
  const focus = drafting ? await loadFocusManuscript(db, ctx.projectId, ctx.focusRecordId) : null;
  const narrative = drafting ? await narrativePointForManuscript(db, ctx.projectId, focus) : null;
  const result = await eventsAtPlace(db, ctx.projectId, locationRecordId, await draftForTools(ctx), await chapterLimit(db, ctx), {
    allowSeriesShared: true,
    omitPlanned: drafting,
    point: narrative?.point ?? null,
    edges: narrative?.edges ?? [],
  });
  if ("error" in result) return { output: JSON.stringify({ error: result.error, locationRecordId }), documents: [] };
  return answerOf(ctx, result);
}

async function eventRevealsTool(db: DbOrTx, ctx: RetrievalContext, args: Record<string, unknown>): Promise<ToolExecution> {
  const eventId = String(args.eventId ?? "");
  if (!eventId) return { output: JSON.stringify({ error: "event_required" }), documents: [] };
  const projectIds = await projectIdsForScope(db, ctx);
  const event = await db.storyEvent.findFirst({ where: { id: eventId, projectId: { in: projectIds } }, select: { projectId: true } });
  if (!event) return { output: JSON.stringify({ error: "not_found", eventId }), documents: [] };
  const result = await eventReveals(db, event.projectId, eventId, await draftForTools(ctx), await chapterLimit(db, ctx));
  if ("error" in result) return { output: JSON.stringify({ error: result.error, eventId }), documents: [] };
  return answerOf(ctx, result);
}

async function eventsBeforeSceneTool(db: DbOrTx, ctx: RetrievalContext, args: Record<string, unknown>): Promise<ToolExecution> {
  return manuscriptTimelineTool(db, ctx, args, "before");
}

async function chapterSequenceTool(db: DbOrTx, ctx: RetrievalContext, args: Record<string, unknown>): Promise<ToolExecution> {
  return manuscriptTimelineTool(db, ctx, args, "sequence");
}

async function manuscriptTimelineTool(
  db: DbOrTx,
  ctx: RetrievalContext,
  args: Record<string, unknown>,
  kind: "before" | "sequence",
): Promise<ToolExecution> {
  const manuscriptRecordId = String(args.manuscriptRecordId ?? ctx.focusRecordId ?? "");
  if (!manuscriptRecordId) {
    return { output: JSON.stringify({ error: "no_focus", note: "No chapter or scene was given." }), documents: [] };
  }
  if (ctx.excludeRecordIds.has(manuscriptRecordId)) {
    omit(ctx.meta, { label: manuscriptRecordId, recordId: manuscriptRecordId, reason: "Excluded by the author for this question." });
    return { output: JSON.stringify({ error: "excluded", manuscriptRecordId }), documents: [] };
  }
  const projectIds = await projectIdsForScope(db, ctx);
  const projectId = await ownerProject(db, projectIds, manuscriptRecordId);
  if (!projectId) return { output: JSON.stringify({ error: "not_found", manuscriptRecordId }), documents: [] };
  const limit = await chapterLimit(db, ctx);
  const draft = await draftForTools(ctx);
  const result =
    kind === "before"
      ? await eventsBeforeManuscript(db, projectId, manuscriptRecordId, draft, limit)
      : await chapterEventSequence(db, projectId, manuscriptRecordId, draft, limit);
  if ("error" in result) return { output: JSON.stringify({ error: result.error, manuscriptRecordId }), documents: [] };
  return answerOf(ctx, result);
}

async function ownerProject(db: DbOrTx, projectIds: string[], recordId: string): Promise<string | null> {
  const row = await db.record.findFirst({
    where: { id: recordId, projectId: { in: projectIds }, trashedAt: null },
    select: { projectId: true },
  });
  return row?.projectId ?? null;
}

export async function executeAssistantTool(
  db: Db,
  ctx: RetrievalContext,
  name: string,
  rawArgs: string,
): Promise<ToolExecution> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(rawArgs || "{}") as Record<string, unknown>;
  } catch {
    return { output: JSON.stringify({ error: "invalid_json_arguments" }), documents: [] };
  }
  if (!isAssistantToolName(name)) {
    return { output: JSON.stringify({ error: "unknown_tool", name }), documents: [] };
  }
  switch (name) {
    case "search_project":
      return searchProjectTool(db, ctx, args);
    case "read_passage":
      return readPassageTool(db, ctx, args);
    case "list_sections":
      return listSectionsTool(db, ctx, args);
    case "resolve_name":
      return resolveNameTool(db, ctx, args);
    case "list_accepted_facts":
      return listAcceptedFactsTool(db, ctx, args);
    case "search_planning":
      return searchPlanningTool(db, ctx, args);
    case "list_earlier_scenes":
      return listEarlierScenesTool(db, ctx, args);
    case "events_at_place":
      return eventsAtPlaceTool(db, ctx, args);
    case "event_reveals":
      return eventRevealsTool(db, ctx, args);
    case "events_before_scene":
      return eventsBeforeSceneTool(db, ctx, args);
    case "chapter_event_sequence":
      return chapterSequenceTool(db, ctx, args);
  }
}

/** Resolve project ids that exist (guards LIVE). */
export async function assertProjectLive(db: DbOrTx, projectId: string): Promise<boolean> {
  return Boolean(await db.project.findFirst({ where: { id: projectId, ...LIVE_PROJECT }, select: { id: true } }));
}

/** Unused import guard helper for searchProjectRecords in broader corpus search. */
export async function searchBodies(
  db: DbOrTx,
  projectId: string,
  query: string,
  includeManuscript: boolean,
) {
  return searchProjectRecords(db, { projectId, query, includeManuscript });
}
