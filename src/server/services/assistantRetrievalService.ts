import { parseJsonObject } from "@/domain/json";
import { contentClassOf, isManuscriptType, isRecordType, RECORD_TYPE_LABELS, type RecordType } from "@/domain/recordTypes";
import { isAuthorityStatus } from "@/domain/statuses";
import type { ContextDocument, ContextKind } from "@/assistant/prompt";
import type { RetrievalContextState, RetrievalMeta, RetrievalOmission } from "@/assistant/retrievalMeta";
import { isAssistantToolName, type RetrievalScope } from "@/assistant/tools";
import { aliasesOf } from "@/writing/crossRefs";
import { hasSectionStatus, listSections, sectionPath } from "@/writing/sections";
import { buildManuscriptTree } from "@/ui/manuscriptTree";
import type { Db, DbOrTx } from "../db";
import { listEstablishedFactsForSubject } from "./establishedFactService";
import { listSeriesBookProjects } from "./projectService";
import { searchContextReferences, searchManuscript, searchProjectRecords } from "./searchService";
import { LIVE_PROJECT } from "./trashFilters";

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

function referenceText(body: string, fieldsJson: string): string {
  try {
    const fields = parseJsonObject(fieldsJson);
    return Object.keys(fields).length ? `${body}\n\nStructured fields (JSON): ${JSON.stringify(fields)}` : body;
  } catch {
    return body;
  }
}

async function projectIdsForScope(db: DbOrTx, ctx: RetrievalContext): Promise<string[]> {
  if (ctx.scope === "series") {
    const siblings = await listSeriesBookProjects(db, ctx.projectId);
    if (siblings.length) return siblings.map((s) => s.id);
  }
  return [ctx.projectId];
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
  const includePlanning = Boolean(args.includePlanning);
  const projectIds = await projectIdsForScope(db, ctx);
  const chapterIds = ctx.scope === "chapter" ? await chapterTreeIds(db, ctx.projectId, ctx.focusRecordId, ctx.draftId) : null;

  const hits: object[] = [];
  const omitted: RetrievalOmission[] = [];

  for (const projectId of projectIds) {
    if (includeReferences) {
      const refHits = await searchContextReferences(db, { projectId, query, limit: 16 });
      for (const h of refHits) {
        if (ctx.excludeRecordIds.has(h.id)) {
          omitted.push({ label: h.title, recordId: h.id, reason: "Excluded by the author for this question." });
          continue;
        }
        hits.push({
          corpus: "reference",
          projectId,
          recordId: h.id,
          title: h.title,
          type: h.type,
          revision: h.currentRevision,
          matchedIn: h.matchedIn,
          excerpt: h.excerpt,
          sectionId: h.sectionId,
          sectionTitle: h.sectionTitle,
        });
      }
    }
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

  const projectIds = await projectIdsForScope(db, ctx);
  const record = await db.record.findFirst({
    where: { id: recordId, projectId: { in: projectIds }, trashedAt: null },
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

  let text = contentClassOf(record.type) === "reference" ? referenceText(record.body, record.fields) : record.body;
  let kind: ContextKind = contentClassOf(record.type) === "reference" ? "reference" : "manuscript";
  let passage: { start: number; end: number } | undefined;
  let section: ContextDocument["section"];

  if (sectionId) {
    const sections = listSections(record.body);
    const match = sections.find((s) => s.id === sectionId);
    if (!match) return { output: JSON.stringify({ error: "section_not_found", sectionId }), documents: [] };
    text = record.body.slice(match.start, match.end);
    kind = "section";
    passage = { start: match.start, end: match.end };
    section = { path: sectionPath(sections, match.id).map((h) => h.title), statusTag: match.statusTag };
  } else if (start != null && end != null) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > record.body.length) {
      return { output: JSON.stringify({ error: "invalid_passage_bounds" }), documents: [] };
    }
    text = record.body.slice(start, end);
    kind = "passage";
    passage = { start, end };
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
  const projectIds = await projectIdsForScope(db, ctx);
  const record = await db.record.findFirst({ where: { id: recordId, projectId: { in: projectIds }, trashedAt: null } });
  if (!record || !isRecordType(record.type)) return { output: JSON.stringify({ error: "not_found" }), documents: [] };
  const sections = listSections(record.body).map((s) => ({
    id: s.id,
    parentId: s.parentId,
    level: s.level,
    title: s.title,
    statusTag: s.statusTag,
    chars: s.end - s.start,
    start: s.start,
    end: s.end,
  }));
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
  const projectIds = await projectIdsForScope(db, ctx);
  const rows = await db.record.findMany({
    where: {
      projectId: { in: projectIds },
      trashedAt: null,
      type: { in: ["character_dossier", "worldbuilding"] },
    },
    select: { id: true, title: true, type: true, fields: true, currentRevision: true, projectId: true, authorityStatus: true },
  });

  const matches: Array<{
    recordId: string;
    title: string;
    type: RecordType;
    revision: number;
    projectId: string;
    matchedAs: string;
  }> = [];

  for (const row of rows) {
    if (!isRecordType(row.type) || ctx.excludeRecordIds.has(row.id)) continue;
    let fields: Record<string, unknown> = {};
    try {
      fields = parseJsonObject(row.fields);
    } catch {
      fields = {};
    }
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
        projectId: row.projectId,
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
  const facts = await listEstablishedFactsForSubject(db, ctx.projectId, subjectRecordId);
  const accepted = facts.filter((f) => f.status === "accepted");
  return {
    output: JSON.stringify({
      subjectRecordId,
      facts: accepted.map((f) => ({
        id: f.id,
        statement: f.statement,
        evidenceKind: f.evidenceKind,
        evidenceKindLabel: f.evidenceKindLabel,
        evidence: f.evidence.map((e) => ({
          sourceRecordId: e.sourceRecordId,
          sourceTitle: e.sourceTitle,
          revisionNumber: e.revisionNumber,
          passageStart: e.passageStart,
          passageEnd: e.passageEnd,
          excerpt: e.passageExcerpt,
          evidenceKind: e.evidenceKind,
          evidenceKindLabel: e.evidenceKindLabel,
          needsRecheck: e.needsRecheck,
          staleNotice: e.needsRecheck ? "Source revised after this evidence was linked." : null,
        })),
      })),
      note: "Zero-draft and planned evidence are labeled; do not treat them as author-manuscript canon.",
    }),
    documents: [],
  };
}

async function searchPlanningTool(db: DbOrTx, ctx: RetrievalContext, args: Record<string, unknown>): Promise<ToolExecution> {
  const query = String(args.query ?? "").trim();
  if (!query) return { output: JSON.stringify({ error: "query_required" }), documents: [] };
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
