import { isRecordType, RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import { isAuthorityStatus } from "@/domain/statuses";
import { openQuestionsExcerpt } from "@/world/referenceInfobox";
import { SERIES_REFERENCE_TYPES } from "@/server/services/seriesBibleService";
import type { DbOrTx } from "../db";

export type ContinuityKind = "unresolved" | "open_question" | "fact" | "story_evidence" | "comment" | "review";

export interface ContinuityItem {
  key: string;
  kind: ContinuityKind;
  title: string;
  detail: string;
  href: string;
}

function recordHref(projectId: string, recordId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(recordId)}`;
}

/**
 * One review list. Nothing is written. Facts are included when any of their
 * evidence needs another look. Margin comments are the comment kind only.
 */
export async function listContinuityTriage(db: DbOrTx, projectId: string): Promise<ContinuityItem[]> {
  const [unresolved, references, facts, storyEvidence, comments, reviews] = await Promise.all([
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
      where: { projectId, evidence: { some: { needsRecheck: true } }, subject: { trashedAt: null } },
      orderBy: [{ statement: "asc" }, { id: "asc" }],
      select: { id: true, statement: true, subjectRecordId: true, subject: { select: { title: true } } },
    }),
    db.storyEventEvidence.findMany({
      where: { projectId, needsRecheck: true },
      orderBy: { id: "asc" },
      select: {
        id: true,
        passageExcerpt: true,
        event: { select: { title: true } },
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
  ]);

  const items: ContinuityItem[] = [];
  for (const row of unresolved) {
    if (!isRecordType(row.type) || !isAuthorityStatus("unresolved")) continue;
    items.push({
      key: `unresolved:${row.id}`,
      kind: "unresolved",
      title: row.title,
      detail: RECORD_TYPE_LABELS[row.type],
      href: recordHref(projectId, row.id),
    });
  }
  for (const row of references) {
    const excerpt = openQuestionsExcerpt(row.body);
    if (!excerpt) continue;
    items.push({
      key: `question:${row.id}`,
      kind: "open_question",
      title: row.title,
      detail: excerpt,
      href: recordHref(projectId, row.id),
    });
  }
  for (const fact of facts) {
    items.push({
      key: `fact:${fact.id}`,
      kind: "fact",
      title: fact.subject.title,
      detail: fact.statement,
      href: recordHref(projectId, fact.subjectRecordId),
    });
  }
  for (const evidence of storyEvidence) {
    items.push({
      key: `story:${evidence.id}`,
      kind: "story_evidence",
      title: evidence.event.title,
      detail: evidence.passageExcerpt,
      href: `/projects/${encodeURIComponent(projectId)}/world/events`,
    });
  }
  for (const comment of comments) {
    items.push({
      key: `comment:${comment.id}`,
      kind: "comment",
      title: comment.record.title,
      detail: comment.passageExcerpt || comment.body,
      href: recordHref(projectId, comment.recordId),
    });
  }
  for (const review of reviews) {
    items.push({
      key: `review:${review.id}`,
      kind: "review",
      title: review.record.title,
      detail: review.note,
      href: recordHref(projectId, review.recordId),
    });
  }
  return items;
}
