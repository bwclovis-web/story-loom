import { newId } from "@/domain/ids";
import { errorIssue } from "@/domain/issues";
import { isManuscriptType, isRecordType, RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import { isAuthorityStatus } from "@/domain/statuses";
import { openQuestionsExcerpt } from "@/world/referenceInfobox";
import { crossRefReport } from "@/writing/crossRefs";
import { SERIES_REFERENCE_TYPES } from "@/server/services/seriesBibleService";
import type { Db, DbOrTx } from "../db";
import { writeAudit } from "./auditService";
import { loadCrossRefIndex } from "./crossRefService";
import { MutationRejectedError, NotFoundError } from "./errors";
import { chapterEventSequence } from "./storyTimelineQuery";
import { characterContinuityFindingsForProject } from "./characterWritingContextService";
import { LIVE_PROJECT } from "./trashFilters";

export type ContinuityKind =
  | "unresolved"
  | "open_question"
  | "fact"
  | "story_evidence"
  | "comment"
  | "review"
  | "draft_in_canon"
  | "missing_ref"
  | "timeline_order"
  | "timeline_cycle"
  | "dangling_weave"
  | "continuity_note"
  | "character_state_conflict"
  | "character_knowledge"
  | "character_limitation"
  | "forgotten_arc"
  | "character_identity"
  | "world_contradiction";

export type ContinuityCategory = "bible" | "manuscript" | "timeline" | "weave" | "stale";
export type ContinuitySeverity = "info" | "warn" | "error";
export type ContinuitySuppressReason = "intentional" | "resolved" | "ignored";

export interface ContinuityItem {
  key: string;
  kind: ContinuityKind;
  title: string;
  detail: string;
  href: string;
  category: ContinuityCategory;
  severity: ContinuitySeverity;
  recordId: string | null;
  suppressed: boolean;
  suppressReason: ContinuitySuppressReason | null;
  evidence?: string;
  applicableCanon?: string;
  storyLocation?: string;
  explanation?: string;
  suggestion?: string;
  /** Secondary link to the world record when kind is world_contradiction. */
  worldHref?: string;
  needsRecheck?: boolean;
}

function recordHref(projectId: string, recordId: string, find?: string): string {
  const base = `/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(recordId)}`;
  if (!find) return base;
  return `${base}?find=${encodeURIComponent(find.slice(0, 120))}`;
}

function categoryOf(kind: ContinuityKind): ContinuityCategory {
  switch (kind) {
    case "timeline_order":
    case "timeline_cycle":
      return "timeline";
    case "dangling_weave":
      return "weave";
    case "fact":
    case "story_evidence":
      return "stale";
    case "comment":
    case "review":
      return "manuscript";
    case "character_state_conflict":
    case "character_knowledge":
    case "character_limitation":
    case "forgotten_arc":
    case "character_identity":
    case "world_contradiction":
      return "bible";
    case "continuity_note":
      return "bible";
    default:
      return "bible";
  }
}

function severityOf(kind: ContinuityKind): ContinuitySeverity {
  switch (kind) {
    case "timeline_cycle":
      return "error";
    case "draft_in_canon":
    case "dangling_weave":
    case "fact":
    case "story_evidence":
    case "character_state_conflict":
    case "world_contradiction":
      return "warn";
    default:
      return "info";
  }
}

function item(
  partial: Omit<ContinuityItem, "category" | "severity" | "suppressed" | "suppressReason" | "recordId"> & {
    recordId?: string | null;
    severity?: ContinuitySeverity;
  },
): ContinuityItem {
  return {
    ...partial,
    recordId: partial.recordId ?? null,
    category: categoryOf(partial.kind),
    severity: partial.severity ?? severityOf(partial.kind),
    suppressed: false,
    suppressReason: null,
  };
}

/**
 * Full Continuity Ledger. Read-only except when reading suppressions.
 * Does not write records, revisions, or canon.
 */
export async function listContinuityLedger(
  db: DbOrTx,
  projectId: string,
  options: { includeSuppressed?: boolean; recordId?: string | null } = {},
): Promise<ContinuityItem[]> {
  const project = await db.project.findFirst({ where: { id: projectId, ...LIVE_PROJECT }, select: { id: true } });
  if (!project) throw new NotFoundError(`Project ${projectId} not found`);

  const [
    unresolved,
    references,
    facts,
    storyEvidence,
    comments,
    reviews,
    chapters,
    continuityNotes,
    eventCount,
    setups,
    suppressions,
    xrefIndex,
    worldContradictions,
  ] = await Promise.all([
    db.record.findMany({
      where: { projectId, trashedAt: null, authorityStatus: "unresolved" },
      orderBy: [{ title: "asc" }, { id: "asc" }],
      select: { id: true, title: true, type: true },
    }),
    db.record.findMany({
      where: { projectId, trashedAt: null, type: { in: [...SERIES_REFERENCE_TYPES] } },
      orderBy: [{ title: "asc" }, { id: "asc" }],
      select: { id: true, title: true, body: true },
    }),
    db.establishedFact.findMany({
      where: {
        projectId,
        subject: { trashedAt: null },
        OR: [{ status: "pending" }, { evidence: { some: { needsRecheck: true } } }],
      },
      orderBy: [{ statement: "asc" }, { id: "asc" }],
      select: {
        id: true,
        statement: true,
        status: true,
        subjectRecordId: true,
        subject: { select: { title: true } },
        evidence: { where: { needsRecheck: true }, select: { id: true }, take: 1 },
      },
    }),
    db.storyEventEvidence.findMany({
      where: { projectId, needsRecheck: true },
      orderBy: { id: "asc" },
      select: {
        id: true,
        passageExcerpt: true,
        sourceRecordId: true,
        event: { select: { id: true, title: true } },
      },
    }),
    db.manuscriptAnnotation.findMany({
      where: { projectId, kind: "comment", needsRecheck: true, resolvedAt: null, record: { trashedAt: null } },
      orderBy: { id: "asc" },
      select: { id: true, body: true, passageExcerpt: true, recordId: true, record: { select: { title: true } } },
    }),
    db.reviewItem.findMany({
      where: { projectId, status: "open", record: { trashedAt: null } },
      orderBy: { createdAt: "asc" },
      select: { id: true, note: true, recordId: true, record: { select: { title: true } } },
    }),
    db.record.findMany({
      where: { projectId, trashedAt: null, type: "manuscript_chapter" },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { id: true, title: true, draftId: true },
    }),
    db.record.findMany({
      where: {
        projectId,
        trashedAt: null,
        type: "continuity_note",
        authorityStatus: { in: ["draft", "proposed", "unresolved"] },
      },
      orderBy: [{ title: "asc" }, { id: "asc" }],
      select: { id: true, title: true, authorityStatus: true },
    }),
    db.storyEvent.count({ where: { projectId } }),
    db.weaveSetupPayoff.findMany({
      where: { fromBeat: { projectId } },
      select: {
        id: true,
        note: true,
        fromBeat: {
          select: {
            id: true,
            title: true,
            gridId: true,
            manuscriptRecordId: true,
            grid: { select: { title: true } },
          },
        },
        toBeat: {
          select: {
            id: true,
            title: true,
            manuscriptRecordId: true,
          },
        },
      },
    }),
    db.continuitySuppression.findMany({
      where: { projectId },
      select: { issueKey: true, reason: true },
    }),
    loadCrossRefIndex(db, projectId),
    "worldContradictionCheck" in db
      ? db.worldContradictionCheck.findMany({
          where: {
            projectId,
            ...(options.recordId ? { manuscriptRecordId: options.recordId } : {}),
          },
          orderBy: [{ checkedAt: "desc" }, { id: "asc" }],
        })
      : Promise.resolve([]),
  ]);

  const worldRecordIds = [...new Set(worldContradictions.map((row) => row.worldRecordId))];
  const manuscriptIds = [...new Set(worldContradictions.map((row) => row.manuscriptRecordId))];
  const titleRows =
    worldRecordIds.length || manuscriptIds.length
      ? await db.record.findMany({
          where: { id: { in: [...worldRecordIds, ...manuscriptIds] } },
          select: { id: true, title: true },
        })
      : [];
  const titleById = new Map(titleRows.map((row) => [row.id, row.title]));

  const items: ContinuityItem[] = [];

  for (const row of unresolved) {
    if (!isRecordType(row.type) || !isAuthorityStatus("unresolved")) continue;
    items.push(
      item({
        key: `unresolved:${row.id}`,
        kind: "unresolved",
        title: row.title,
        detail: RECORD_TYPE_LABELS[row.type],
        href: recordHref(projectId, row.id),
        recordId: row.id,
      }),
    );
  }
  for (const row of references) {
    const excerpt = openQuestionsExcerpt(row.body);
    if (!excerpt) continue;
    items.push(
      item({
        key: `question:${row.id}`,
        kind: "open_question",
        title: row.title,
        detail: excerpt,
        href: recordHref(projectId, row.id),
        recordId: row.id,
      }),
    );
  }
  for (const fact of facts) {
    const pending = fact.status === "pending";
    const stale = fact.evidence.length > 0;
    const prefix = [pending ? "Pending." : "", stale ? "Evidence needs a recheck." : ""].filter(Boolean).join(" ");
    const detail = prefix ? `${prefix} ${fact.statement}` : fact.statement;
    items.push(
      item({
        key: `fact:${fact.id}`,
        kind: "fact",
        title: fact.subject.title,
        detail,
        href: recordHref(projectId, fact.subjectRecordId),
        recordId: fact.subjectRecordId,
      }),
    );
  }
  for (const evidence of storyEvidence) {
    items.push(
      item({
        key: `story:${evidence.id}`,
        kind: "story_evidence",
        title: evidence.event.title,
        detail: evidence.passageExcerpt,
        href: evidence.sourceRecordId
          ? recordHref(projectId, evidence.sourceRecordId, evidence.passageExcerpt)
          : `/projects/${encodeURIComponent(projectId)}/world/events`,
        recordId: evidence.sourceRecordId,
      }),
    );
  }
  for (const comment of comments) {
    items.push(
      item({
        key: `comment:${comment.id}`,
        kind: "comment",
        title: comment.record.title,
        detail: comment.passageExcerpt || comment.body,
        href: recordHref(projectId, comment.recordId, comment.passageExcerpt || undefined),
        recordId: comment.recordId,
      }),
    );
  }
  for (const review of reviews) {
    items.push(
      item({
        key: `review:${review.id}`,
        kind: "review",
        title: review.record.title,
        detail: review.note,
        href: recordHref(projectId, review.recordId),
        recordId: review.recordId,
      }),
    );
  }

  // Draft / unresolved / superseded dossiers cited from manuscript (especially approved prose).
  const report = crossRefReport(xrefIndex);
  for (const mention of report.flaggedMentions) {
    const from = xrefIndex.records.get(mention.from.recordId);
    if (!from || !isManuscriptType(from.type)) continue;
    const targetStatus = mention.target.status;
    if (targetStatus !== "draft" && targetStatus !== "superseded" && targetStatus !== "unresolved") continue;
    const approved = from.status === "approved";
    items.push(
      item({
        key: `draft_in_canon:${mention.from.recordId}:${mention.target.recordId}:${mention.token}`,
        kind: "draft_in_canon",
        title: mention.from.title,
        detail: `${approved ? "Approved" : "Manuscript"} text cites “${mention.target.title}” (${targetStatus}) via ${mention.token}.`,
        href: recordHref(projectId, mention.from.recordId, mention.token),
        recordId: mention.from.recordId,
      }),
    );
  }
  for (const miss of report.undefinedIds) {
    const fromMs = miss.mentionedBy.filter((r) => {
      const rec = xrefIndex.records.get(r.recordId);
      return rec && isManuscriptType(rec.type);
    });
    if (!fromMs.length) continue;
    const first = fromMs[0]!;
    items.push(
      item({
        key: `missing_ref:id:${miss.id}`,
        kind: "missing_ref",
        title: miss.id,
        detail: `Cited from ${fromMs.map((r) => r.title).join(", ")} with no matching record.`,
        href: recordHref(projectId, first.recordId, miss.id),
        recordId: first.recordId,
      }),
    );
  }
  for (const miss of report.missingFiles) {
    const fromMs = miss.mentionedBy.filter((r) => {
      const rec = xrefIndex.records.get(r.recordId);
      return rec && isManuscriptType(rec.type);
    });
    if (!fromMs.length) continue;
    const first = fromMs[0]!;
    items.push(
      item({
        key: `missing_ref:file:${miss.filename}`,
        kind: "missing_ref",
        title: miss.filename,
        detail: `Filename cited from ${fromMs.map((r) => r.title).join(", ")} was never imported.`,
        href: recordHref(projectId, first.recordId, miss.filename),
        recordId: first.recordId,
      }),
    );
  }

  const NOTE_STATUS: Record<string, string> = {
    draft: "Still a draft.",
    proposed: "Still proposed.",
    unresolved: "Still unresolved.",
  };
  for (const note of continuityNotes) {
    if (!isAuthorityStatus(note.authorityStatus)) continue;
    items.push(
      item({
        key: `continuity_note:${note.id}`,
        kind: "continuity_note",
        title: note.title,
        detail: NOTE_STATUS[note.authorityStatus] ?? "Still unsettled.",
        href: recordHref(projectId, note.id),
        recordId: note.id,
      }),
    );
  }

  // Timeline vs book order. With no story events there is nothing to compare, so skip the per-chapter walk.
  let reportedCycle = false;
  const seenOrder = new Set<string>();
  for (const chapter of eventCount > 0 ? chapters : []) {
    const seq = await chapterEventSequence(db, projectId, chapter.id, "all");
    if ("error" in seq) continue;
    const payload = seq.payload as {
      constraintCycle?: boolean;
      readerOrderDifferences?: Array<{
        earlierTitle: string;
        laterTitle: string;
        earlierRevealedIn: { recordId: string; title: string };
        laterRevealedIn: { recordId: string; title: string };
      }>;
    };
    if (payload.constraintCycle && !reportedCycle) {
      reportedCycle = true;
      items.push(
        item({
          key: `timeline_cycle:${projectId}`,
          kind: "timeline_cycle",
          title: "Story timeline constraints conflict",
          detail: "Recorded before/after constraints form a cycle. Fix the timeline edges.",
          href: `/projects/${encodeURIComponent(projectId)}/world/events`,
          recordId: chapter.id,
        }),
      );
    }
    for (const diff of payload.readerOrderDifferences ?? []) {
      const orderKey = `${diff.earlierRevealedIn.recordId}:${diff.laterRevealedIn.recordId}:${diff.earlierTitle}:${diff.laterTitle}`;
      if (seenOrder.has(orderKey)) continue;
      seenOrder.add(orderKey);
      items.push(
        item({
          key: `timeline_order:${orderKey}`,
          kind: "timeline_order",
          title: chapter.title,
          detail: `“${diff.laterTitle}” is revealed before chronologically earlier “${diff.earlierTitle}” (reader meets ${diff.laterRevealedIn.title} first).`,
          href: recordHref(projectId, diff.laterRevealedIn.recordId),
          recordId: diff.laterRevealedIn.recordId,
        }),
      );
    }
  }

  // Dangling Weave setup→payoff: payoff beat has no linked manuscript chapter/scene.
  for (const edge of setups) {
    if (edge.toBeat.manuscriptRecordId) continue;
    items.push(
      item({
        key: `dangling_weave:${edge.id}`,
        kind: "dangling_weave",
        title: edge.fromBeat.title,
        detail: `Setup “${edge.fromBeat.title}” → payoff “${edge.toBeat.title}” on ${edge.fromBeat.grid.title} has no linked manuscript scene.${edge.note ? ` ${edge.note}` : ""}`,
        href: `/projects/${encodeURIComponent(projectId)}/plan/weave/${encodeURIComponent(edge.fromBeat.gridId)}`,
        recordId: edge.fromBeat.manuscriptRecordId,
      }),
    );
  }

  // W7B: manuscript passage vs approved world fact (read-only load of prior review rows).
  for (const check of worldContradictions) {
    const manuscriptTitle = titleById.get(check.manuscriptRecordId) ?? "Manuscript";
    const worldTitle = titleById.get(check.worldRecordId) ?? "World record";
    const recheckNote = check.needsRecheck ? " Needs recheck after a source revision." : "";
    items.push(
      item({
        key: check.issueKey,
        kind: "world_contradiction",
        title: manuscriptTitle,
        detail: `${check.verdict === "ambiguous" ? "Possible mismatch" : "Conflict"} with ${worldTitle} (${check.fieldPath}).${recheckNote}`,
        href: recordHref(projectId, check.manuscriptRecordId, check.passageExcerpt),
        worldHref: recordHref(projectId, check.worldRecordId),
        recordId: check.manuscriptRecordId,
        severity: check.verdict === "ambiguous" ? "info" : "warn",
        evidence: `“${check.passageExcerpt}” (rev ${check.manuscriptRevision})`,
        applicableCanon: `${check.worldFactFormatted} · ${check.fieldPath} · world rev ${check.worldRecordRevision}`,
        storyLocation: check.storyPointLabel || undefined,
        explanation: check.explanation,
        needsRecheck: check.needsRecheck,
      }),
    );
  }

  // Living Character profile continuity (state conflicts, unanchored secrets, forgotten arcs).
  // Does not enforce archetypes as rules. Authors mark intentional/ignored via suppressions.
  const characterFindings = await characterContinuityFindingsForProject(db, projectId, {
    recordId: options.recordId ?? null,
    focusRecordId: options.recordId ?? null,
  });
  for (const finding of characterFindings) {
    items.push(
      item({
        key: finding.key,
        kind: finding.kind,
        title: finding.title,
        detail: finding.detail,
        href: recordHref(projectId, finding.characterRecordId),
        recordId: options.recordId && options.recordId !== finding.characterRecordId ? options.recordId : finding.characterRecordId,
        evidence: finding.evidence,
        applicableCanon: finding.applicableCanon,
        storyLocation: finding.storyLocation,
        explanation: finding.explanation,
        suggestion: finding.suggestion,
      }),
    );
  }

  const suppressMap = new Map(suppressions.map((s) => [s.issueKey, s.reason as ContinuitySuppressReason]));
  const scoped = options.recordId
    ? items.filter((i) => i.recordId === options.recordId)
    : items;

  const withSuppress = scoped.map((i) => {
    const reason = suppressMap.get(i.key) ?? null;
    return reason
      ? { ...i, suppressed: true, suppressReason: reason }
      : i;
  });

  if (options.includeSuppressed) return withSuppress;
  return withSuppress.filter((i) => !i.suppressed);
}

/** Legacy triage list used by older callers; same ledger without suppressed rows. */
export async function listContinuityTriage(db: DbOrTx, projectId: string): Promise<ContinuityItem[]> {
  return listContinuityLedger(db, projectId);
}

export async function countContinuityForRecord(db: DbOrTx, projectId: string, recordId: string): Promise<number> {
  const items = await listContinuityLedger(db, projectId, { recordId });
  return items.length;
}

export async function suppressContinuityIssue(
  db: Db,
  projectId: string,
  input: { issueKey: string; reason: ContinuitySuppressReason; note?: string; actor?: string },
): Promise<void> {
  const key = input.issueKey.trim();
  if (!key || key.length > 500) throw new MutationRejectedError([errorIssue("INVALID_CHANGE", "Choose a continuity issue to mark.")]);
  if (input.reason !== "intentional" && input.reason !== "resolved" && input.reason !== "ignored") {
    throw new MutationRejectedError([errorIssue("INVALID_CHANGE", "Choose intentional, resolved, or ignored.")]);
  }
  const actor = input.actor ?? "author";
  const note = (input.note ?? "").trim().slice(0, 2000);
  await db.$transaction(async (tx) => {
    const project = await tx.project.findFirst({ where: { id: projectId, ...LIVE_PROJECT }, select: { id: true } });
    if (!project) throw new NotFoundError(`Project ${projectId} not found`);
    const existing = await tx.continuitySuppression.findUnique({
      where: { projectId_issueKey: { projectId, issueKey: key } },
    });
    if (existing) {
      await tx.continuitySuppression.update({
        where: { id: existing.id },
        data: { reason: input.reason, note, actor },
      });
    } else {
      await tx.continuitySuppression.create({
        data: { id: newId("csp"), projectId, issueKey: key, reason: input.reason, note, actor },
      });
    }
    await writeAudit(tx, {
      projectId,
      action: "continuity.suppress",
      actor,
      summary: `Marked continuity issue ${input.reason}: ${key.slice(0, 80)}`,
      details: { issueKey: key, reason: input.reason, note },
    });
  });
}

export async function clearContinuitySuppression(
  db: Db,
  projectId: string,
  issueKey: string,
  actor = "author",
): Promise<void> {
  const key = issueKey.trim();
  await db.$transaction(async (tx) => {
    const row = await tx.continuitySuppression.findUnique({
      where: { projectId_issueKey: { projectId, issueKey: key } },
    });
    if (!row) return;
    await tx.continuitySuppression.delete({ where: { id: row.id } });
    await writeAudit(tx, {
      projectId,
      action: "continuity.suppress_clear",
      actor,
      summary: `Restored continuity issue to the ledger: ${key.slice(0, 80)}`,
      details: { issueKey: key },
    });
  });
}
