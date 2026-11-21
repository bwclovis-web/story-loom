import { newId } from "@/domain/ids";
import { sha256 } from "@/domain/json";
import { errorIssue } from "@/domain/issues";
import { isManuscriptType } from "@/domain/recordTypes";
import type { Db, DbOrTx, Tx } from "../db";
import { writeAudit } from "./auditService";
import { MutationRejectedError, NotFoundError } from "./errors";
const UI_ACTOR = "author";

export const ANNOTATION_KIND = {
  synopsis: "synopsis",
  comment: "comment",
} as const;

export type AnnotationKind = (typeof ANNOTATION_KIND)[keyof typeof ANNOTATION_KIND];

export interface SynopsisView {
  recordId: string;
  body: string;
  updatedAt: Date;
}

export interface MarginCommentView {
  id: string;
  recordId: string;
  body: string;
  revisionNumber: number;
  passageStart: number;
  passageEnd: number;
  passageExcerpt: string;
  needsRecheck: boolean;
  resolvedAt: Date | null;
  createdAt: Date;
}

function rejected(message: string, recordId?: string): MutationRejectedError {
  return new MutationRejectedError([errorIssue("INVALID_CHANGE", message, recordId ? { recordId } : {})]);
}

function clampPassage(body: string, start: number, end: number): { start: number; end: number; excerpt: string } {
  const s = Math.max(0, Math.min(body.length, Math.floor(start)));
  const e = Math.max(s, Math.min(body.length, Math.floor(end)));
  return { start: s, end: e, excerpt: body.slice(s, e) };
}

const MAX_SYNOPSIS = 20_000;
const MAX_COMMENT_NOTE = 4_000;
const MAX_EXCERPT = 8_000;

async function requireManuscriptRecord(tx: DbOrTx, projectId: string, recordId: string) {
  const record = await tx.record.findFirst({
    where: { id: recordId, projectId, trashedAt: null },
    select: { id: true, title: true, type: true, body: true, currentRevision: true },
  });
  if (!record || !isManuscriptType(record.type)) throw rejected("Choose a chapter or scene in this project.", recordId);
  return record;
}

async function bodyAtRevision(
  tx: DbOrTx,
  recordId: string,
  revisionNumber: number,
  currentBody: string,
  currentRevision: number,
): Promise<string> {
  if (revisionNumber === currentRevision) return currentBody;
  const rev = await tx.revision.findUnique({
    where: { recordId_revisionNumber: { recordId, revisionNumber } },
    select: { body: true },
  });
  if (!rev) throw rejected(`Revision ${revisionNumber} was not found.`);
  return rev.body;
}

export async function getSynopsis(db: DbOrTx, projectId: string, recordId: string): Promise<SynopsisView | null> {
  const row = await db.manuscriptAnnotation.findFirst({
    where: { projectId, recordId, kind: ANNOTATION_KIND.synopsis },
    select: { recordId: true, body: true, updatedAt: true },
  });
  return row ? { recordId: row.recordId, body: row.body, updatedAt: row.updatedAt } : null;
}

export async function listSynopsesForRecords(
  db: DbOrTx,
  projectId: string,
  recordIds: readonly string[],
): Promise<Map<string, string>> {
  if (!recordIds.length) return new Map();
  const rows = await db.manuscriptAnnotation.findMany({
    where: { projectId, kind: ANNOTATION_KIND.synopsis, recordId: { in: [...recordIds] } },
    select: { recordId: true, body: true },
  });
  return new Map(rows.map((r) => [r.recordId, r.body]));
}

export async function listExportMarginCommentsForRecords(
  db: DbOrTx,
  projectId: string,
  recordIds: readonly string[],
): Promise<Map<string, { body: string; passageExcerpt: string }[]>> {
  if (!recordIds.length) return new Map();
  const rows = await db.manuscriptAnnotation.findMany({
    where: {
      projectId,
      kind: ANNOTATION_KIND.comment,
      resolvedAt: null,
      recordId: { in: [...recordIds] },
    },
    orderBy: [{ recordId: "asc" }, { passageStart: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { recordId: true, body: true, passageExcerpt: true },
  });
  const map = new Map<string, { body: string; passageExcerpt: string }[]>();
  for (const row of rows) {
    const list = map.get(row.recordId) ?? [];
    list.push({ body: row.body, passageExcerpt: row.passageExcerpt });
    map.set(row.recordId, list);
  }
  return map;
}

export async function listMarginComments(db: DbOrTx, projectId: string, recordId: string): Promise<MarginCommentView[]> {
  const rows = await db.manuscriptAnnotation.findMany({
    where: { projectId, recordId, kind: ANNOTATION_KIND.comment, resolvedAt: null },
    orderBy: [{ passageStart: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    recordId: r.recordId,
    body: r.body,
    revisionNumber: r.revisionNumber ?? 1,
    passageStart: r.passageStart ?? 0,
    passageEnd: r.passageEnd ?? 0,
    passageExcerpt: r.passageExcerpt,
    needsRecheck: r.needsRecheck,
    resolvedAt: r.resolvedAt,
    createdAt: r.createdAt,
  }));
}

export async function listAllMarginComments(
  db: DbOrTx,
  projectId: string,
  recordId: string,
  includeResolved: boolean,
): Promise<MarginCommentView[]> {
  const rows = await db.manuscriptAnnotation.findMany({
    where: {
      projectId,
      recordId,
      kind: ANNOTATION_KIND.comment,
      ...(includeResolved ? {} : { resolvedAt: null }),
    },
    orderBy: [{ resolvedAt: "asc" }, { passageStart: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    recordId: r.recordId,
    body: r.body,
    revisionNumber: r.revisionNumber ?? 1,
    passageStart: r.passageStart ?? 0,
    passageEnd: r.passageEnd ?? 0,
    passageExcerpt: r.passageExcerpt,
    needsRecheck: r.needsRecheck,
    resolvedAt: r.resolvedAt,
    createdAt: r.createdAt,
  }));
}

export async function upsertSynopsis(db: Db, projectId: string, recordId: string, body: string): Promise<SynopsisView> {
  const text = body.trimEnd();
  if (text.length > MAX_SYNOPSIS) throw rejected(`Synopsis may be at most ${MAX_SYNOPSIS} characters.`, recordId);
  return db.$transaction(async (tx) => {
    const project = await tx.project.findFirst({ where: { id: projectId, trashedAt: null }, select: { id: true } });
    if (!project) throw new NotFoundError(`Project ${projectId} not found`);
    const record = await requireManuscriptRecord(tx, projectId, recordId);
    const existing = await tx.manuscriptAnnotation.findFirst({
      where: { projectId, recordId, kind: ANNOTATION_KIND.synopsis },
    });
    const row = existing
      ? await tx.manuscriptAnnotation.update({
          where: { id: existing.id },
          data: { body: text },
        })
      : await tx.manuscriptAnnotation.create({
          data: {
            id: newId("man"),
            projectId,
            recordId,
            kind: ANNOTATION_KIND.synopsis,
            body: text,
          },
        });
    await writeAudit(tx, {
      projectId,
      action: "manuscript_annotation.synopsis",
      actor: UI_ACTOR,
      summary: text ? `Synopsis updated for “${record.title}”.` : `Synopsis cleared for “${record.title}”.`,
      details: { recordId, kind: ANNOTATION_KIND.synopsis },
    });
    return { recordId, body: row.body, updatedAt: row.updatedAt };
  });
}

export async function clearSynopsis(db: Db, projectId: string, recordId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const existing = await tx.manuscriptAnnotation.findFirst({
      where: { projectId, recordId, kind: ANNOTATION_KIND.synopsis },
    });
    if (!existing) return;
    await tx.manuscriptAnnotation.delete({ where: { id: existing.id } });
    const record = await tx.record.findFirst({ where: { id: recordId, projectId }, select: { title: true } });
    await writeAudit(tx, {
      projectId,
      action: "manuscript_annotation.synopsis_clear",
      actor: UI_ACTOR,
      summary: `Synopsis removed from “${record?.title ?? recordId}”.`,
      details: { recordId, kind: ANNOTATION_KIND.synopsis },
    });
  });
}

export async function addMarginComment(
  db: Db,
  projectId: string,
  recordId: string,
  input: {
    passageStart: number;
    passageEnd: number;
    expectedRevision: number;
    body?: string;
  },
): Promise<MarginCommentView> {
  const note = (input.body ?? "").trim();
  if (note.length > MAX_COMMENT_NOTE) throw rejected(`Comment note may be at most ${MAX_COMMENT_NOTE} characters.`, recordId);
  return db.$transaction(async (tx) => {
    const record = await requireManuscriptRecord(tx, projectId, recordId);
    if (input.expectedRevision !== record.currentRevision) {
      throw rejected("Save the chapter or scene before pinning a comment to this revision.", recordId);
    }
    const sourceBody = await bodyAtRevision(
      tx,
      record.id,
      input.expectedRevision,
      record.body,
      record.currentRevision,
    );
    const { start, end, excerpt } = clampPassage(sourceBody, input.passageStart, input.passageEnd);
    if (!excerpt.trim()) throw rejected("Choose a non-empty passage.", recordId);
    if (excerpt.length > MAX_EXCERPT) throw rejected("Passage is too long to pin.", recordId);
    const row = await tx.manuscriptAnnotation.create({
      data: {
        id: newId("man"),
        projectId,
        recordId,
        kind: ANNOTATION_KIND.comment,
        body: note,
        revisionNumber: input.expectedRevision,
        passageStart: start,
        passageEnd: end,
        passageExcerpt: excerpt,
        contentHash: sha256(excerpt),
        needsRecheck: false,
      },
    });
    await writeAudit(tx, {
      projectId,
      action: "manuscript_annotation.comment_add",
      actor: UI_ACTOR,
      summary: `Margin comment on “${record.title}” (rev ${input.expectedRevision}).`,
      details: { recordId, annotationId: row.id, revisionNumber: input.expectedRevision, passageStart: start, passageEnd: end },
    });
    return {
      id: row.id,
      recordId: row.recordId,
      body: row.body,
      revisionNumber: row.revisionNumber!,
      passageStart: start,
      passageEnd: end,
      passageExcerpt: excerpt,
      needsRecheck: false,
      resolvedAt: null,
      createdAt: row.createdAt,
    };
  });
}

export async function resolveMarginComment(db: Db, projectId: string, annotationId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const row = await tx.manuscriptAnnotation.findFirst({
      where: { id: annotationId, projectId, kind: ANNOTATION_KIND.comment },
    });
    if (!row) throw rejected("That comment was not found.");
    if (row.resolvedAt) return;
    await tx.manuscriptAnnotation.update({
      where: { id: row.id },
      data: { resolvedAt: new Date() },
    });
    await writeAudit(tx, {
      projectId,
      action: "manuscript_annotation.comment_resolve",
      actor: UI_ACTOR,
      summary: "Resolved a margin comment.",
      details: { recordId: row.recordId, annotationId: row.id },
    });
  });
}

export async function deleteMarginComment(db: Db, projectId: string, annotationId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const row = await tx.manuscriptAnnotation.findFirst({
      where: { id: annotationId, projectId, kind: ANNOTATION_KIND.comment },
    });
    if (!row) return;
    await tx.manuscriptAnnotation.delete({ where: { id: row.id } });
    await writeAudit(tx, {
      projectId,
      action: "manuscript_annotation.comment_remove",
      actor: UI_ACTOR,
      summary: "Removed a margin comment.",
      details: { recordId: row.recordId, annotationId: row.id },
    });
  });
}

export async function markAnnotationNeedsRecheckForSourceInTx(
  tx: Tx,
  projectId: string,
  sourceRecordId: string,
  newRevision: number,
): Promise<void> {
  await tx.manuscriptAnnotation.updateMany({
    where: {
      projectId,
      recordId: sourceRecordId,
      kind: ANNOTATION_KIND.comment,
      revisionNumber: { lt: newRevision },
      needsRecheck: false,
    },
    data: { needsRecheck: true },
  });
}

export async function clearAnnotationNeedsRecheck(
  db: Db,
  projectId: string,
  annotationId: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const row = await tx.manuscriptAnnotation.findFirst({
      where: { id: annotationId, projectId, kind: ANNOTATION_KIND.comment },
    });
    if (!row) throw rejected("That comment was not found.");
    await tx.manuscriptAnnotation.update({ where: { id: row.id }, data: { needsRecheck: false } });
  });
}

export async function deleteAnnotationsForRecordsInTx(tx: Tx, recordIds: readonly string[]): Promise<void> {
  if (!recordIds.length) return;
  await tx.manuscriptAnnotation.deleteMany({ where: { recordId: { in: [...recordIds] } } });
}
