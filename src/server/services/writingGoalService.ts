import { newId } from "@/domain/ids";
import { errorIssue } from "@/domain/issues";
import type { Db, DbOrTx } from "../db";
import { writeAudit } from "./auditService";
import { MutationRejectedError, NotFoundError } from "./errors";

export const WRITING_GOAL_SCOPE = {
  project: "project",
  chapter: "chapter",
} as const;

export type WritingGoalScope = (typeof WRITING_GOAL_SCOPE)[keyof typeof WRITING_GOAL_SCOPE];

export interface WritingGoalView {
  id: string;
  projectId: string;
  scope: WritingGoalScope;
  recordId: string | null;
  targetWords: number;
  deadlineAt: Date | null;
  updatedAt: Date;
}

const UI_ACTOR = "author";

function rejected(message: string): MutationRejectedError {
  return new MutationRejectedError([errorIssue("INVALID_CHANGE", message)]);
}

function toView(row: {
  id: string;
  projectId: string;
  scope: string;
  recordId: string | null;
  targetWords: number;
  deadlineAt: Date | null;
  updatedAt: Date;
}): WritingGoalView {
  const scope = row.scope === WRITING_GOAL_SCOPE.chapter ? WRITING_GOAL_SCOPE.chapter : WRITING_GOAL_SCOPE.project;
  return {
    id: row.id,
    projectId: row.projectId,
    scope,
    recordId: row.recordId,
    targetWords: row.targetWords,
    deadlineAt: row.deadlineAt,
    updatedAt: row.updatedAt,
  };
}

export async function getProjectWritingGoal(db: DbOrTx, projectId: string): Promise<WritingGoalView | null> {
  const row = await db.writingGoal.findFirst({
    where: { projectId, scope: WRITING_GOAL_SCOPE.project, recordId: null },
  });
  return row ? toView(row) : null;
}

export async function listChapterWritingGoals(db: DbOrTx, projectId: string): Promise<WritingGoalView[]> {
  const rows = await db.writingGoal.findMany({
    where: { projectId, scope: WRITING_GOAL_SCOPE.chapter, recordId: { not: null } },
    orderBy: [{ targetWords: "desc" }, { id: "asc" }],
  });
  return rows.map(toView);
}

export async function listWritingGoals(db: DbOrTx, projectId: string): Promise<WritingGoalView[]> {
  const rows = await db.writingGoal.findMany({
    where: { projectId },
    orderBy: [{ scope: "asc" }, { id: "asc" }],
  });
  return rows.map(toView);
}

export async function getChapterWritingGoal(
  db: DbOrTx,
  projectId: string,
  recordId: string,
): Promise<WritingGoalView | null> {
  const row = await db.writingGoal.findFirst({
    where: { projectId, scope: WRITING_GOAL_SCOPE.chapter, recordId },
  });
  return row ? toView(row) : null;
}

function parseTarget(words: number): number {
  if (!Number.isFinite(words) || !Number.isInteger(words) || words < 1 || words > 10_000_000) {
    throw rejected("Target must be a whole number between 1 and 10,000,000.");
  }
  return words;
}

function parseDeadline(deadline: string | null | undefined): Date | null {
  if (!deadline?.trim()) return null;
  const parsed = new Date(deadline);
  if (Number.isNaN(parsed.getTime())) throw rejected("Deadline is not a valid date.");
  return parsed;
}

export async function upsertProjectWritingGoal(
  db: Db,
  projectId: string,
  input: { targetWords: number; deadlineAt?: string | null },
): Promise<WritingGoalView> {
  const targetWords = parseTarget(input.targetWords);
  const deadlineAt = parseDeadline(input.deadlineAt);
  return db.$transaction(async (tx) => {
    const project = await tx.project.findFirst({ where: { id: projectId, trashedAt: null }, select: { id: true } });
    if (!project) throw new NotFoundError(`Project ${projectId} not found`);
    const existing = await tx.writingGoal.findFirst({
      where: { projectId, scope: WRITING_GOAL_SCOPE.project, recordId: null },
    });
    const row = existing
      ? await tx.writingGoal.update({
          where: { id: existing.id },
          data: { targetWords, deadlineAt },
        })
      : await tx.writingGoal.create({
          data: {
            id: newId("wgoal"),
            projectId,
            scope: WRITING_GOAL_SCOPE.project,
            recordId: null,
            targetWords,
            deadlineAt,
          },
        });
    await writeAudit(tx, {
      projectId,
      action: "writing_goal.set",
      actor: UI_ACTOR,
      summary: `Project word target set to ${targetWords}.`,
      details: { scope: WRITING_GOAL_SCOPE.project, targetWords, deadlineAt: deadlineAt?.toISOString() ?? null },
    });
    return toView(row);
  });
}

export async function upsertChapterWritingGoal(
  db: Db,
  projectId: string,
  recordId: string,
  targetWords: number,
): Promise<WritingGoalView> {
  const target = parseTarget(targetWords);
  return db.$transaction(async (tx) => {
    const record = await tx.record.findFirst({
      where: { id: recordId, projectId, trashedAt: null, type: "manuscript_chapter" },
      select: { id: true, title: true },
    });
    if (!record) throw rejected(`Chapter ${recordId} not found in this project.`);
    const existing = await tx.writingGoal.findFirst({
      where: { projectId, scope: WRITING_GOAL_SCOPE.chapter, recordId },
    });
    const row = existing
      ? await tx.writingGoal.update({ where: { id: existing.id }, data: { targetWords: target } })
      : await tx.writingGoal.create({
          data: {
            id: newId("wgoal"),
            projectId,
            scope: WRITING_GOAL_SCOPE.chapter,
            recordId,
            targetWords: target,
            deadlineAt: null,
          },
        });
    await writeAudit(tx, {
      projectId,
      action: "writing_goal.set",
      actor: UI_ACTOR,
      summary: `Chapter target set for “${record.title}”: ${target} words.`,
      details: { scope: WRITING_GOAL_SCOPE.chapter, recordId, targetWords: target },
    });
    return toView(row);
  });
}

export async function clearProjectWritingGoal(db: Db, projectId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const existing = await tx.writingGoal.findFirst({
      where: { projectId, scope: WRITING_GOAL_SCOPE.project, recordId: null },
    });
    if (!existing) return;
    await tx.writingGoal.delete({ where: { id: existing.id } });
    await writeAudit(tx, {
      projectId,
      action: "writing_goal.clear",
      actor: UI_ACTOR,
      summary: "Project word target cleared.",
      details: { scope: WRITING_GOAL_SCOPE.project },
    });
  });
}

export async function clearChapterWritingGoal(db: Db, projectId: string, recordId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const existing = await tx.writingGoal.findFirst({
      where: { projectId, scope: WRITING_GOAL_SCOPE.chapter, recordId },
    });
    if (!existing) return;
    await tx.writingGoal.delete({ where: { id: existing.id } });
    await writeAudit(tx, {
      projectId,
      action: "writing_goal.clear",
      actor: UI_ACTOR,
      summary: "Chapter word target cleared.",
      details: { scope: WRITING_GOAL_SCOPE.chapter, recordId },
    });
  });
}