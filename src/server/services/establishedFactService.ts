import { newId } from "@/domain/ids";
import { errorIssue } from "@/domain/issues";
import { sha256 } from "@/domain/json";
import {
  isLinkableReferenceType,
  isManuscriptType,
  isRecordType,
  RECORD_TYPE_LABELS,
} from "@/domain/recordTypes";
import { nameFormsOf } from "@/writing/crossRefs";
import type { Db, DbOrTx, Tx } from "../db";
import { writeAudit } from "./auditService";
import { MutationRejectedError, NotFoundError } from "./errors";
import { getBoard } from "./boardService";

/*
 * Established-in facts for reference records. Facts and evidence are not
 * revisioned content: accepting/dismissing and linking passages are audited.
 * Evidence kinds stay distinct (planned | zero_draft | author_rewrite).
 * Extracted facts stay pending until the author accepts them. When a cited
 * source's current revision moves past the evidence revision, needsRecheck is set.
 */

const UI_ACTOR = "author";

export const EVIDENCE_KINDS = ["planned", "zero_draft", "author_rewrite"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const EVIDENCE_KIND_LABELS: Record<EvidenceKind, string> = {
  planned: "Planned material",
  zero_draft: "Zero-draft evidence",
  author_rewrite: "Author-rewrite evidence",
};

export const FACT_STATUSES = ["pending", "accepted", "dismissed"] as const;
export type FactStatus = (typeof FACT_STATUSES)[number];

export function isEvidenceKind(v: string): v is EvidenceKind {
  return (EVIDENCE_KINDS as readonly string[]).includes(v);
}

export function isFactStatus(v: string): v is FactStatus {
  return (FACT_STATUSES as readonly string[]).includes(v);
}

export interface FactEvidenceView {
  id: string;
  sourceRecordId: string;
  sourceTitle: string;
  sourceTypeLabel: string;
  revisionNumber: number;
  passageStart: number;
  passageEnd: number;
  passageExcerpt: string;
  evidenceKind: EvidenceKind;
  evidenceKindLabel: string;
  needsRecheck: boolean;
  createdAt: Date;
}

export interface EstablishedFactView {
  id: string;
  subjectRecordId: string;
  statement: string;
  status: FactStatus;
  evidenceKind: EvidenceKind;
  evidenceKindLabel: string;
  createdAt: Date;
  updatedAt: Date;
  evidence: FactEvidenceView[];
}

function rejected(message: string, recordId?: string): MutationRejectedError {
  return new MutationRejectedError([errorIssue("INVALID_REFERENCE", message, recordId ? { recordId } : {})]);
}

function clampPassage(body: string, start: number, end: number): { start: number; end: number; excerpt: string } {
  const s = Math.max(0, Math.min(body.length, Math.floor(start)));
  const e = Math.max(s, Math.min(body.length, Math.floor(end)));
  const excerpt = body.slice(s, e);
  return { start: s, end: e, excerpt };
}

/** Derive evidence kind from a source record's draft (or plan type). */
export async function evidenceKindForSource(tx: Tx | DbOrTx, projectId: string, sourceRecordId: string): Promise<EvidenceKind> {
  const row = await tx.record.findFirst({
    where: { id: sourceRecordId, projectId, trashedAt: null },
    select: { type: true, draftId: true, draft: { select: { kind: true } } },
  });
  if (!row || !isRecordType(row.type)) throw rejected("Source record not found.", sourceRecordId);
  if (row.type === "chapter_outline" || row.type === "story_architecture") return "planned";
  if (isManuscriptType(row.type)) {
    if (row.draft?.kind === "author_manuscript") return "author_rewrite";
    if (row.draft?.kind === "zero_draft") return "zero_draft";
    // Legacy unscoped manuscript: treat as zero-draft evidence.
    return "zero_draft";
  }
  throw rejected("Evidence must cite a manuscript chapter/scene or a plan outline.", sourceRecordId);
}

export async function listEstablishedFactsForSubject(
  db: DbOrTx,
  projectId: string,
  subjectRecordId: string,
  options?: { includeDismissed?: boolean },
): Promise<EstablishedFactView[]> {
  await refreshStaleFlagsForSubject(db, projectId, subjectRecordId);
  const rows = await db.establishedFact.findMany({
    where: {
      projectId,
      subjectRecordId,
      ...(options?.includeDismissed ? {} : { status: { not: "dismissed" } }),
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }, { id: "asc" }],
    include: {
      evidence: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: { source: { select: { id: true, title: true, type: true, trashedAt: true } } },
      },
    },
  });
  return rows.flatMap((f) => {
    if (!isFactStatus(f.status) || !isEvidenceKind(f.evidenceKind)) return [];
    return [
      {
        id: f.id,
        subjectRecordId: f.subjectRecordId,
        statement: f.statement,
        status: f.status,
        evidenceKind: f.evidenceKind,
        evidenceKindLabel: EVIDENCE_KIND_LABELS[f.evidenceKind],
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
        evidence: f.evidence.flatMap((e) => {
          if (!isEvidenceKind(e.evidenceKind) || !isRecordType(e.source.type)) return [];
          if (e.source.trashedAt) return [];
          return [
            {
              id: e.id,
              sourceRecordId: e.sourceRecordId,
              sourceTitle: e.source.title,
              sourceTypeLabel: RECORD_TYPE_LABELS[e.source.type],
              revisionNumber: e.revisionNumber,
              passageStart: e.passageStart,
              passageEnd: e.passageEnd,
              passageExcerpt: e.passageExcerpt,
              evidenceKind: e.evidenceKind,
              evidenceKindLabel: EVIDENCE_KIND_LABELS[e.evidenceKind],
              needsRecheck: e.needsRecheck,
              createdAt: e.createdAt,
            },
          ];
        }),
      },
    ];
  });
}

/** Mark evidence stale when the cited source has moved past the linked revision. */
export async function refreshStaleFlagsForSubject(db: DbOrTx, projectId: string, subjectRecordId: string): Promise<number> {
  const evidence = await db.factEvidence.findMany({
    where: { projectId, fact: { subjectRecordId }, needsRecheck: false },
    select: { id: true, sourceRecordId: true, revisionNumber: true },
  });
  if (!evidence.length) return 0;
  const sourceIds = [...new Set(evidence.map((e) => e.sourceRecordId))];
  const sources = await db.record.findMany({
    where: { id: { in: sourceIds }, projectId },
    select: { id: true, currentRevision: true },
  });
  const rev = new Map(sources.map((s) => [s.id, s.currentRevision]));
  const staleIds = evidence.filter((e) => (rev.get(e.sourceRecordId) ?? 0) > e.revisionNumber).map((e) => e.id);
  if (!staleIds.length) return 0;
  await db.factEvidence.updateMany({ where: { id: { in: staleIds } }, data: { needsRecheck: true } });
  return staleIds.length;
}

/** Called after a manuscript/plan record gains a new revision. */
export async function markEvidenceNeedsRecheckForSourceInTx(
  tx: Tx,
  projectId: string,
  sourceRecordId: string,
  newRevision: number,
): Promise<void> {
  await tx.factEvidence.updateMany({
    where: {
      projectId,
      sourceRecordId,
      revisionNumber: { lt: newRevision },
      needsRecheck: false,
    },
    data: { needsRecheck: true },
  });
}

export async function proposeExtractedFacts(
  db: Db,
  projectId: string,
  input: {
    subjectRecordId: string;
    evidenceKind: EvidenceKind;
    statements: string[];
  },
): Promise<EstablishedFactView[]> {
  if (!isEvidenceKind(input.evidenceKind)) throw rejected("Unknown evidence kind.");
  const statements = [...new Set(input.statements.map((s) => s.trim()).filter((s) => s.length > 0))];
  if (!statements.length) throw rejected("No facts to extract.");

  return db.$transaction(async (tx) => {
    const subject = await tx.record.findFirst({
      where: { id: input.subjectRecordId, projectId, trashedAt: null },
      select: { id: true, title: true, type: true },
    });
    if (!subject || !isRecordType(subject.type) || !isLinkableReferenceType(subject.type)) {
      throw rejected("Facts belong on a reference record.", input.subjectRecordId);
    }
    const created: string[] = [];
    for (const statement of statements) {
      const id = newId("fct");
      await tx.establishedFact.create({
        data: {
          id,
          projectId,
          subjectRecordId: subject.id,
          statement,
          status: "pending",
          evidenceKind: input.evidenceKind,
        },
      });
      created.push(id);
    }
    await writeAudit(tx, {
      projectId,
      action: "established_fact.extract",
      actor: UI_ACTOR,
      summary: `Offered ${created.length} extracted fact(s) for "${subject.title}"`,
      details: { subjectRecordId: subject.id, factIds: created, evidenceKind: input.evidenceKind },
    });
    return listEstablishedFactsForSubject(tx, projectId, subject.id, { includeDismissed: false });
  });
}

export async function acceptEstablishedFact(db: Db, projectId: string, factId: string): Promise<EstablishedFactView> {
  return setFactStatus(db, projectId, factId, "accepted");
}

export async function dismissEstablishedFact(db: Db, projectId: string, factId: string): Promise<EstablishedFactView> {
  return setFactStatus(db, projectId, factId, "dismissed");
}

async function setFactStatus(db: Db, projectId: string, factId: string, status: FactStatus) {
  return db.$transaction(async (tx) => {
    const fact = await tx.establishedFact.findFirst({ where: { id: factId, projectId } });
    if (!fact) throw rejected("That fact is not in this project.");
    await tx.establishedFact.update({ where: { id: factId }, data: { status } });
    await writeAudit(tx, {
      projectId,
      action: status === "accepted" ? "established_fact.accept" : "established_fact.dismiss",
      actor: UI_ACTOR,
      summary: `${status === "accepted" ? "Accepted" : "Dismissed"} fact "${fact.statement.slice(0, 80)}"`,
      details: { factId, status, subjectRecordId: fact.subjectRecordId },
    });
    const list = await listEstablishedFactsForSubject(tx, projectId, fact.subjectRecordId, { includeDismissed: true });
    return list.find((f) => f.id === factId)!;
  });
}

export async function addFactEvidence(
  db: Db,
  projectId: string,
  factId: string,
  input: { sourceRecordId: string; passageStart: number; passageEnd: number; revisionNumber?: number },
): Promise<EstablishedFactView> {
  return db.$transaction(async (tx) => {
    const fact = await tx.establishedFact.findFirst({ where: { id: factId, projectId } });
    if (!fact) throw rejected("That fact is not in this project.");
    const source = await tx.record.findFirst({
      where: { id: input.sourceRecordId, projectId, trashedAt: null },
      select: { id: true, title: true, type: true, body: true, currentRevision: true },
    });
    if (!source) throw rejected("Source record not found.", input.sourceRecordId);
    const kind = await evidenceKindForSource(tx, projectId, source.id);
    const revisionNumber = input.revisionNumber ?? source.currentRevision;
    let body = source.body;
    if (revisionNumber !== source.currentRevision) {
      const rev = await tx.revision.findUnique({
        where: { recordId_revisionNumber: { recordId: source.id, revisionNumber } },
        select: { body: true },
      });
      if (!rev) throw rejected(`Revision ${revisionNumber} was not found for that source.`);
      body = rev.body;
    }
    const { start, end, excerpt } = clampPassage(body, input.passageStart, input.passageEnd);
    if (!excerpt.trim()) throw rejected("Choose a non-empty passage.");
    const id = newId("fev");
    await tx.factEvidence.create({
      data: {
        id,
        factId,
        projectId,
        sourceRecordId: source.id,
        revisionNumber,
        passageStart: start,
        passageEnd: end,
        passageExcerpt: excerpt,
        contentHash: sha256(excerpt),
        evidenceKind: kind,
        needsRecheck: false,
      },
    });
    await writeAudit(tx, {
      projectId,
      action: "fact_evidence.add",
      actor: UI_ACTOR,
      summary: `Linked evidence in "${source.title}" (rev ${revisionNumber}) to a fact`,
      details: { factId, evidenceId: id, sourceRecordId: source.id, revisionNumber, evidenceKind: kind },
    });
    const list = await listEstablishedFactsForSubject(tx, projectId, fact.subjectRecordId, { includeDismissed: true });
    return list.find((f) => f.id === factId)!;
  });
}

export async function removeFactEvidence(db: Db, projectId: string, evidenceId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const row = await tx.factEvidence.findFirst({ where: { id: evidenceId, projectId } });
    if (!row) throw rejected("That evidence is not in this project.");
    await tx.factEvidence.delete({ where: { id: evidenceId } });
    await writeAudit(tx, {
      projectId,
      action: "fact_evidence.remove",
      actor: UI_ACTOR,
      summary: `Removed fact evidence`,
      details: { evidenceId, factId: row.factId, sourceRecordId: row.sourceRecordId },
    });
  });
}

export async function clearRecheckFlag(db: Db, projectId: string, evidenceId: string): Promise<FactEvidenceView> {
  return db.$transaction(async (tx) => {
    const row = await tx.factEvidence.findFirst({
      where: { id: evidenceId, projectId },
      include: { source: { select: { title: true, type: true } } },
    });
    if (!row || !isEvidenceKind(row.evidenceKind) || !isRecordType(row.source.type)) {
      throw rejected("That evidence is not in this project.");
    }
    await tx.factEvidence.update({ where: { id: evidenceId }, data: { needsRecheck: false } });
    await writeAudit(tx, {
      projectId,
      action: "fact_evidence.recheck_cleared",
      actor: UI_ACTOR,
      summary: `Cleared recheck on evidence in "${row.source.title}"`,
      details: { evidenceId, factId: row.factId },
    });
    return {
      id: row.id,
      sourceRecordId: row.sourceRecordId,
      sourceTitle: row.source.title,
      sourceTypeLabel: RECORD_TYPE_LABELS[row.source.type],
      revisionNumber: row.revisionNumber,
      passageStart: row.passageStart,
      passageEnd: row.passageEnd,
      passageExcerpt: row.passageExcerpt,
      evidenceKind: row.evidenceKind,
      evidenceKindLabel: EVIDENCE_KIND_LABELS[row.evidenceKind],
      needsRecheck: false,
      createdAt: row.createdAt,
    };
  });
}

export interface KnowledgePassage {
  recordId: string;
  title: string;
  start: number;
  end: number;
  excerpt: string;
  matchedName: string;
}

export interface CharacterKnowledgeCheckResult {
  subjectRecordId: string;
  subjectTitle: string;
  draftId: string | null;
  draftLabel: string | null;
  sceneId: string;
  sceneTitle: string;
  evidenceKind: EvidenceKind;
  passagesChecked: KnowledgePassage[];
  coveredFactIds: string[];
  /** Accepted facts with linked evidence citing this scene (same evidence kind). */
  coveredByEvidence: Array<{ factId: string; statement: string }>;
  /** Accepted facts matched by keyword overlap only (no linked evidence in this scene). */
  coveredByKeywords: Array<{ factId: string; statement: string }>;
  gaps: Array<{ factId: string; statement: string; evidenceKind: EvidenceKind }>;
  nameFormsUsed: string[];
}

/** On-demand: scan the chosen draft's scene for the character's names; report coverage vs accepted facts. */
export async function runCharacterKnowledgeCheck(
  db: DbOrTx,
  projectId: string,
  input: { subjectRecordId: string; sceneId: string; draftId: string | null },
): Promise<CharacterKnowledgeCheckResult> {
  const subject = await db.record.findFirst({
    where: { id: input.subjectRecordId, projectId, trashedAt: null },
    select: { id: true, title: true, type: true, fields: true },
  });
  if (!subject || subject.type !== "character_dossier") {
    throw rejected("Character knowledge check requires a character dossier.", input.subjectRecordId);
  }
  const scene = await db.record.findFirst({
    where: { id: input.sceneId, projectId, trashedAt: null },
    select: { id: true, title: true, type: true, body: true, draftId: true },
  });
  if (!scene || (scene.type !== "manuscript_scene" && scene.type !== "manuscript_chapter")) {
    throw rejected("Choose a manuscript chapter or scene.", input.sceneId);
  }
  if (input.draftId && scene.draftId && scene.draftId !== input.draftId) {
    throw rejected("That scene is not in the chosen draft.", input.sceneId);
  }

  let draftLabel: string | null = null;
  let evidenceKind: EvidenceKind = "zero_draft";
  if (input.draftId) {
    const draft = await db.manuscriptDraft.findFirst({ where: { id: input.draftId, projectId } });
    if (!draft) throw rejected("That draft was not found.");
    draftLabel = draft.label;
    evidenceKind = draft.kind === "author_manuscript" ? "author_rewrite" : "zero_draft";
  }

  let fields: Record<string, unknown> = {};
  try {
    fields = JSON.parse(subject.fields) as Record<string, unknown>;
  } catch {
    fields = {};
  }
  const names = nameFormsOf({ title: subject.title, type: subject.type, fields });
  const forms = [...new Set([...names.full, ...names.parts])].sort((a, b) => b.length - a.length);
  const passages: KnowledgePassage[] = [];
  const body = scene.body;
  for (const name of forms) {
    const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, "gi");
    let match: RegExpExecArray | null;
    while ((match = re.exec(body))) {
      const start = match.index;
      const end = start + match[0].length;
      const windowStart = Math.max(0, start - 80);
      const windowEnd = Math.min(body.length, end + 80);
      passages.push({
        recordId: scene.id,
        title: scene.title,
        start: windowStart,
        end: windowEnd,
        excerpt: body.slice(windowStart, windowEnd),
        matchedName: match[0],
      });
      if (passages.length >= 40) break;
    }
    if (passages.length >= 40) break;
  }

  const facts = await listEstablishedFactsForSubject(db, projectId, subject.id);
  const accepted = facts.filter((f) => f.status === "accepted");
  const hay = passages.map((p) => p.excerpt).join("\n").toLowerCase();
  const covered: string[] = [];
  const gaps: CharacterKnowledgeCheckResult["gaps"] = [];
  const coveredByEvidence: CharacterKnowledgeCheckResult["coveredByEvidence"] = [];
  const coveredByKeywords: CharacterKnowledgeCheckResult["coveredByKeywords"] = [];
  for (const fact of accepted) {
    // Heuristic only: linked evidence in this scene, and/or keyword overlap — not proof of knowledge.
    const hasSceneEvidence = fact.evidence.some((e) => e.sourceRecordId === scene.id && e.evidenceKind === evidenceKind);
    const keywords = fact.statement
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .filter((w) => w.length >= 4);
    const overlap = keywords.length > 0 && keywords.filter((w) => hay.includes(w)).length >= Math.min(2, keywords.length);
    if (hasSceneEvidence) {
      covered.push(fact.id);
      coveredByEvidence.push({ factId: fact.id, statement: fact.statement });
    } else if (overlap) {
      covered.push(fact.id);
      coveredByKeywords.push({ factId: fact.id, statement: fact.statement });
    } else {
      gaps.push({ factId: fact.id, statement: fact.statement, evidenceKind: fact.evidenceKind });
    }
  }

  return {
    subjectRecordId: subject.id,
    subjectTitle: subject.title,
    draftId: input.draftId,
    draftLabel,
    sceneId: scene.id,
    sceneTitle: scene.title,
    evidenceKind,
    passagesChecked: passages,
    coveredFactIds: covered,
    coveredByEvidence,
    coveredByKeywords,
    gaps,
    nameFormsUsed: forms,
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface BoardAskPreview {
  boardId: string;
  boardTitle: string;
  records: Array<{
    recordId: string;
    title: string;
    typeLabel: string;
    sections: Array<{ id: string; title: string; level: number }>;
  }>;
  noteCards: Array<{ cardId: string; title: string; bodyPreview: string }>;
  suggestedPrompt: string;
}

/** Preview of linked board records/sections for "Ask about this board". */
export async function previewBoardAskContext(db: DbOrTx, projectId: string, boardId: string): Promise<BoardAskPreview> {
  const board = await getBoard(db, projectId, boardId);
  const { listSections } = await import("@/writing/sections");
  const records: BoardAskPreview["records"] = [];
  const seen = new Set<string>();
  for (const card of board.cards) {
    if (card.kind !== "record" || !card.recordId || seen.has(card.recordId)) continue;
    seen.add(card.recordId);
    const row = await db.record.findFirst({
      where: { id: card.recordId, projectId, trashedAt: null },
      select: { id: true, title: true, type: true, body: true },
    });
    if (!row || !isRecordType(row.type)) continue;
    records.push({
      recordId: row.id,
      title: row.title,
      typeLabel: RECORD_TYPE_LABELS[row.type],
      sections: listSections(row.body).map((s) => ({ id: s.id, title: s.title, level: s.level })),
    });
  }
  const noteCards = board.cards
    .filter((c) => c.kind === "note")
    .map((c) => ({
      cardId: c.id,
      title: c.noteTitle || "Note",
      bodyPreview: c.noteBody.slice(0, 240),
    }));
  return {
    boardId: board.id,
    boardTitle: board.title,
    records,
    noteCards,
    suggestedPrompt: `Looking at the World board "${board.title}", help me with continuity among these references. Propose reference updates only through the usual Review and Apply flow.`,
  };
}

export async function deleteFactsForRecordsInTx(tx: Tx, recordIds: readonly string[]): Promise<void> {
  if (!recordIds.length) return;
  const ids = { in: [...recordIds] };
  await tx.factEvidence.deleteMany({ where: { sourceRecordId: ids } });
  const facts = await tx.establishedFact.findMany({ where: { subjectRecordId: ids }, select: { id: true } });
  if (facts.length) {
    await tx.factEvidence.deleteMany({ where: { factId: { in: facts.map((f) => f.id) } } });
    await tx.establishedFact.deleteMany({ where: { id: { in: facts.map((f) => f.id) } } });
  }
}

/** Heuristic extract: statements from dossier body lines / field aliases offered for review. */
export async function extractCandidateFactsFromSubject(
  db: Db,
  projectId: string,
  subjectRecordId: string,
  evidenceKind: EvidenceKind,
): Promise<EstablishedFactView[]> {
  const subject = await db.record.findFirst({
    where: { id: subjectRecordId, projectId, trashedAt: null },
    select: { id: true, title: true, type: true, body: true, fields: true },
  });
  if (!subject || !isRecordType(subject.type) || !isLinkableReferenceType(subject.type)) {
    throw rejected("Facts belong on a reference record.", subjectRecordId);
  }
  const statements: string[] = [];
  for (const line of subject.body.split(/\n+/)) {
    const t = line.replace(/^#+\s*/, "").replace(/^[-*]\s+/, "").trim();
    if (t.length >= 12 && t.length <= 240 && !t.startsWith("http")) statements.push(t);
  }
  try {
    const fields = JSON.parse(subject.fields) as Record<string, unknown>;
    if (typeof fields.age === "number") statements.push(`${subject.title} is ${fields.age} years old.`);
    if (typeof fields.role === "string" && fields.role.trim()) statements.push(`${subject.title}: ${fields.role.trim()}`);
  } catch {
    /* ignore */
  }
  return proposeExtractedFacts(db, projectId, {
    subjectRecordId,
    evidenceKind,
    statements: statements.slice(0, 12),
  });
}
