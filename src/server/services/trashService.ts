import { errorIssue, type Issue } from "@/domain/issues";
import { isRecordType, type RecordType } from "@/domain/recordTypes";
import { writeFullBackup } from "../backupFiles";
import type { Db, DbOrTx, Tx } from "../db";
import { writeAudit } from "./auditService";
import { MutationRejectedError, NotFoundError } from "./errors";
import { deleteRecordRowsInTx, deleteTrashedRecordsInTx, planTrashedRecordDeletion } from "./mutationService";
import { LIVE_PROJECT } from "./trashFilters";

/*
 * Workspaces and projects in the Trash, the Trash listing, and permanent
 * deletion. Records move to the Trash through mutationService. Anything in the
 * Trash is hidden from every list, page, search, export and connection, but
 * nothing is removed until it is deleted permanently, which writes a full
 * backup first.
 */

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export async function trashProject(db: Db, input: { projectId: string; actor: string }): Promise<void> {
  await db.$transaction(async (tx) => {
    const project = await tx.project.findFirst({ where: { id: input.projectId, ...LIVE_PROJECT } });
    if (!project) throw new NotFoundError(`Project ${input.projectId} not found`);
    await tx.project.update({ where: { id: project.id }, data: { trashedAt: new Date() } });
    await writeAudit(tx, {
      projectId: project.id,
      action: "trash.move",
      actor: input.actor,
      summary: `Moved project "${project.title}" to the Trash`,
      details: { kind: "project", projectId: project.id },
    });
  });
}

export async function restoreProject(db: Db, input: { projectId: string; actor: string }): Promise<void> {
  await db.$transaction(async (tx) => {
    const project = await tx.project.findFirst({
      where: { id: input.projectId, trashedAt: { not: null } },
      include: { workspace: true },
    });
    if (!project) throw new NotFoundError(`Project ${input.projectId} is not in the Trash`);
    if (project.workspace.trashedAt) {
      throw new MutationRejectedError([
        errorIssue("IN_TRASH", `Workspace "${project.workspace.name}" is also in the Trash. Restore it first.`),
      ]);
    }
    await tx.project.update({ where: { id: project.id }, data: { trashedAt: null } });
    await writeAudit(tx, {
      projectId: project.id,
      action: "trash.restore",
      actor: input.actor,
      summary: `Restored project "${project.title}" from the Trash`,
      details: { kind: "project", projectId: project.id },
    });
  });
}

/** Workspaces have no history of their own, so each of their projects records the change. */
async function auditWorkspace(tx: Tx, workspaceId: string, action: string, summary: string, actor: string) {
  const projects = await tx.project.findMany({ where: { workspaceId }, select: { id: true } });
  for (const p of projects) {
    await writeAudit(tx, { projectId: p.id, action, actor, summary, details: { kind: "workspace", workspaceId } });
  }
}

export async function trashWorkspace(db: Db, input: { workspaceId: string; actor: string }): Promise<void> {
  await db.$transaction(async (tx) => {
    const workspace = await tx.workspace.findFirst({ where: { id: input.workspaceId, trashedAt: null } });
    if (!workspace) throw new NotFoundError(`Workspace ${input.workspaceId} not found`);
    await tx.workspace.update({ where: { id: workspace.id }, data: { trashedAt: new Date() } });
    await auditWorkspace(tx, workspace.id, "trash.move", `Moved workspace "${workspace.name}" to the Trash`, input.actor);
  });
}

export async function restoreWorkspace(db: Db, input: { workspaceId: string; actor: string }): Promise<void> {
  await db.$transaction(async (tx) => {
    const workspace = await tx.workspace.findFirst({ where: { id: input.workspaceId, trashedAt: { not: null } } });
    if (!workspace) throw new NotFoundError(`Workspace ${input.workspaceId} is not in the Trash`);
    await tx.workspace.update({ where: { id: workspace.id }, data: { trashedAt: null } });
    await auditWorkspace(tx, workspace.id, "trash.restore", `Restored workspace "${workspace.name}" from the Trash`, input.actor);
  });
}

export interface TrashedRecordGroup {
  batchId: string;
  projectId: string;
  projectTitle: string;
  workspaceName: string;
  trashedAt: Date;
  /** The record that was moved; the others were inside it. */
  lead: { id: string; title: string; type: RecordType };
  inside: Array<{ id: string; title: string; type: RecordType }>;
  /** Title of the chapter or scene this belongs to when that is in the Trash too. */
  waitsFor: string | null;
}

export interface TrashListing {
  workspaces: Array<{ id: string; name: string; trashedAt: Date; projectCount: number }>;
  projects: Array<{ id: string; title: string; workspaceName: string; trashedAt: Date; recordCount: number }>;
  records: TrashedRecordGroup[];
}

export function countTrashedWorkspaces(db: DbOrTx): Promise<number> {
  return db.workspace.count({ where: { trashedAt: { not: null } } });
}

/**
 * What the Trash page shows. A project inside a workspace in the Trash is
 * listed with the workspace only, and records inside a project in the Trash
 * with the project only.
 */
export async function listTrash(db: DbOrTx): Promise<TrashListing> {
  const [workspaces, projects, records] = await Promise.all([
    db.workspace.findMany({
      where: { trashedAt: { not: null } },
      orderBy: { trashedAt: "desc" },
      select: { id: true, name: true, trashedAt: true, _count: { select: { projects: true } } },
    }),
    db.project.findMany({
      where: { trashedAt: { not: null }, workspace: { trashedAt: null } },
      orderBy: { trashedAt: "desc" },
      select: { id: true, title: true, trashedAt: true, workspace: { select: { name: true } }, _count: { select: { records: true } } },
    }),
    db.record.findMany({
      where: { trashedAt: { not: null }, project: LIVE_PROJECT },
      orderBy: [{ trashedAt: "desc" }, { title: "asc" }],
      select: {
        id: true,
        title: true,
        type: true,
        parentRecordId: true,
        trashedAt: true,
        trashBatchId: true,
        project: { select: { id: true, title: true, workspace: { select: { name: true } } } },
      },
    }),
  ]);

  const batches = new Map<string, typeof records>();
  for (const r of records) {
    const key = `${r.project.id}/${r.trashBatchId ?? r.id}`;
    batches.set(key, [...(batches.get(key) ?? []), r]);
  }
  const trashedIds = new Set(records.map((r) => r.id));
  const titleOf = new Map(records.map((r) => [r.id, r.title]));
  const groups: TrashedRecordGroup[] = [];
  for (const rows of batches.values()) {
    const ids = new Set(rows.map((r) => r.id));
    const lead = rows.find((r) => !r.parentRecordId || !ids.has(r.parentRecordId)) ?? rows[0];
    const view = (r: (typeof rows)[number]) => (isRecordType(r.type) ? [{ id: r.id, title: r.title, type: r.type }] : []);
    const leadView = view(lead)[0];
    if (!leadView) continue;
    groups.push({
      batchId: lead.trashBatchId ?? lead.id,
      projectId: lead.project.id,
      projectTitle: lead.project.title,
      workspaceName: lead.project.workspace.name,
      trashedAt: lead.trashedAt!,
      lead: leadView,
      inside: rows.filter((r) => r !== lead).flatMap(view),
      waitsFor: lead.parentRecordId && trashedIds.has(lead.parentRecordId) ? (titleOf.get(lead.parentRecordId) ?? null) : null,
    });
  }

  return {
    workspaces: workspaces.map((w) => ({ id: w.id, name: w.name, trashedAt: w.trashedAt!, projectCount: w._count.projects })),
    projects: projects.map((p) => ({
      id: p.id,
      title: p.title,
      workspaceName: p.workspace.name,
      trashedAt: p.trashedAt!,
      recordCount: p._count.records,
    })),
    records: groups,
  };
}

export type DeleteTarget =
  | { kind: "records"; projectId: string; batchId: string }
  | { kind: "project"; projectId: string }
  | { kind: "workspace"; workspaceId: string }
  | { kind: "all" };

interface DeletionPlan {
  workspaceIds: string[];
  projectIds: string[];
  /** Trash batches per project that stays. */
  recordBatches: Map<string, string[]>;
  issues: Issue[];
}

async function planDeletion(db: DbOrTx, target: DeleteTarget): Promise<DeletionPlan> {
  const plan: DeletionPlan = { workspaceIds: [], projectIds: [], recordBatches: new Map(), issues: [] };
  if (target.kind === "workspace" || target.kind === "all") {
    const rows = await db.workspace.findMany({
      where: { trashedAt: { not: null }, ...(target.kind === "workspace" ? { id: target.workspaceId } : {}) },
      select: { id: true },
    });
    plan.workspaceIds = rows.map((w) => w.id);
  }
  if (target.kind === "project" || target.kind === "all") {
    const rows = await db.project.findMany({
      where: {
        trashedAt: { not: null },
        workspace: { trashedAt: null },
        ...(target.kind === "project" ? { id: target.projectId } : {}),
      },
      select: { id: true },
    });
    plan.projectIds = rows.map((p) => p.id);
  }
  if (target.kind === "records" || target.kind === "all") {
    const rows = await db.record.findMany({
      where: {
        trashedAt: { not: null },
        trashBatchId: target.kind === "records" ? target.batchId : { not: null },
        project: target.kind === "records" ? { id: target.projectId, ...LIVE_PROJECT } : LIVE_PROJECT,
      },
      select: { projectId: true, trashBatchId: true },
      distinct: ["projectId", "trashBatchId"],
    });
    for (const r of rows) plan.recordBatches.set(r.projectId, [...(plan.recordBatches.get(r.projectId) ?? []), r.trashBatchId!]);
    for (const [projectId, batchIds] of plan.recordBatches) {
      plan.issues.push(...(await planTrashedRecordDeletion(db, projectId, batchIds)).issues);
    }
  }
  return plan;
}

const isEmpty = (plan: DeletionPlan) => !plan.workspaceIds.length && !plan.projectIds.length && !plan.recordBatches.size;

/** Everything stored for a project, then the project. */
async function deleteProjectRowsInTx(tx: Tx, projectId: string) {
  const records = await tx.record.findMany({ where: { projectId }, select: { id: true } });
  await tx.assistantProposal.deleteMany({ where: { projectId } });
  await tx.assistantContextItem.deleteMany({ where: { message: { conversation: { projectId } } } });
  await tx.assistantMessage.deleteMany({ where: { conversation: { projectId } } });
  await tx.assistantConversation.deleteMany({ where: { projectId } });
  await tx.projectAssistantSettings.deleteMany({ where: { projectId } });
  await deleteRecordRowsInTx(
    tx,
    records.map((r) => r.id),
  );
  await tx.dictionaryEntry.deleteMany({ where: { projectId } });
  await tx.changePackage.deleteMany({ where: { projectId } });
  await tx.auditEntry.deleteMany({ where: { projectId } });
  await tx.source.deleteMany({ where: { projectId } });
  await tx.rewriteSourceLink.deleteMany({ where: { projectId } });
  await tx.readingPin.deleteMany({ where: { projectId } });
  await tx.manuscriptAnnotation.deleteMany({ where: { projectId } });
  await tx.boardCard.deleteMany({ where: { projectId } });
  await tx.board.deleteMany({ where: { projectId } });
  await tx.worldMapPin.deleteMany({ where: { projectId } });
  await tx.worldMap.deleteMany({ where: { projectId } });
  await tx.placeRelation.deleteMany({ where: { projectId } });
  await tx.recordRelation.deleteMany({ where: { projectId } });
  // Cross-project placements/relations that pointed at this project's records or images.
  const recordIds = records.map((r) => r.id);
  if (recordIds.length) {
    await tx.boardCard.deleteMany({
      where: { projectId: { not: projectId }, OR: [{ recordId: { in: recordIds } }, { image: { recordId: { in: recordIds } } }] },
    });
    await tx.worldMapPin.deleteMany({
      where: { projectId: { not: projectId }, recordId: { in: recordIds } },
    });
    await tx.placeRelation.deleteMany({
      where: {
        projectId: { not: projectId },
        OR: [{ fromRecordId: { in: recordIds } }, { toRecordId: { in: recordIds } }],
      },
    });
    await tx.recordRelation.deleteMany({
      where: {
        projectId: { not: projectId },
        OR: [{ fromRecordId: { in: recordIds } }, { toRecordId: { in: recordIds } }],
      },
    });
  }
  const weaveBeats = await tx.weaveBeat.findMany({ where: { projectId }, select: { id: true } });
  if (weaveBeats.length) {
    const beatIds = weaveBeats.map((b) => b.id);
    await tx.weaveSetupPayoff.deleteMany({
      where: { OR: [{ fromBeatId: { in: beatIds } }, { toBeatId: { in: beatIds } }] },
    });
  }
  await tx.weaveBeatWorldRef.deleteMany({ where: { projectId } });
  await tx.weaveBeat.deleteMany({ where: { projectId } });
  await tx.weaveGrid.deleteMany({ where: { projectId } });
  const templates = await tx.weaveTemplate.findMany({ where: { projectId }, select: { id: true } });
  if (templates.length) {
    await tx.weaveTemplateBeat.deleteMany({ where: { templateId: { in: templates.map((t) => t.id) } } });
  }
  await tx.weaveTemplate.deleteMany({ where: { projectId } });
  await tx.weaveThread.deleteMany({ where: { projectId } }).catch(() => undefined);
  await tx.weaveBuildRun.deleteMany({ where: { projectId } }).catch(() => undefined);
  await tx.factEvidence.deleteMany({ where: { projectId } });
  await tx.establishedFact.deleteMany({ where: { projectId } });
  await tx.storyEventEvidence.deleteMany({ where: { projectId } });
  await tx.storyEventLocation.deleteMany({ where: { projectId } });
  await tx.storyEventScene.deleteMany({ where: { projectId } });
  await tx.storyEventOrder.deleteMany({ where: { projectId } });
  await tx.storyEvent.deleteMany({ where: { projectId } });
  await tx.projectCover.deleteMany({ where: { projectId } });
  await tx.worldKindTemplate.deleteMany({ where: { projectId } });
  await tx.worldCategoryDefinition.deleteMany({ where: { projectId } }).catch(() => undefined);
  await tx.compileProfile.deleteMany({ where: { projectId } }).catch(() => undefined);
  await tx.continuitySuppression.deleteMany({ where: { projectId } }).catch(() => undefined);
  await tx.worldContradictionCheck.deleteMany({ where: { projectId } }).catch(() => undefined);
  await tx.smartCollection.deleteMany({ where: { projectId } }).catch(() => undefined);
  await tx.writingGoal.deleteMany({ where: { projectId } }).catch(() => undefined);
  await tx.assistantPromptPreset.deleteMany({ where: { projectId } }).catch(() => undefined);
  await tx.sceneLocation.deleteMany({ where: { projectId } }).catch(() => undefined);
  await tx.chapterAnalysisRun.deleteMany({ where: { projectId } }).catch(() => undefined);
  await tx.characterAnalysisRun.deleteMany({ where: { projectId } }).catch(() => undefined);
  if ("worldCalendar" in tx) {
    const calendars = await tx.worldCalendar.findMany({ where: { projectId }, select: { id: true } });
    for (const calendar of calendars) {
      await tx.worldCalendarMonth.deleteMany({ where: { calendarId: calendar.id } }).catch(() => undefined);
      await tx.worldCalendarEra.deleteMany({ where: { calendarId: calendar.id } }).catch(() => undefined);
      if ("worldCalendarWeekday" in tx) {
        await tx.worldCalendarWeekday.deleteMany({ where: { calendarId: calendar.id } }).catch(() => undefined);
      }
      if ("worldCalendarIntercalary" in tx) {
        await tx.worldCalendarIntercalary.deleteMany({ where: { calendarId: calendar.id } }).catch(() => undefined);
      }
      if ("worldCalendarFestival" in tx) {
        await tx.worldCalendarFestival.deleteMany({ where: { calendarId: calendar.id } }).catch(() => undefined);
      }
    }
    await tx.worldCalendar.deleteMany({ where: { projectId } }).catch(() => undefined);
  }
  await tx.project.update({
    where: { id: projectId },
    data: { defaultReadingDraftId: null, defaultExportDraftId: null },
  });
  await tx.manuscriptDraft.deleteMany({ where: { projectId } });
  await tx.manuscriptGroup.deleteMany({ where: { projectId } });
  await tx.project.delete({ where: { id: projectId } });
}

async function deleteWorkspaceRowsInTx(tx: Tx, workspaceId: string) {
  const projects = await tx.project.findMany({ where: { workspaceId }, select: { id: true } });
  for (const p of projects) await deleteProjectRowsInTx(tx, p.id);
  await tx.dictionaryEntry.deleteMany({ where: { workspaceId } });
  await tx.workspace.delete({ where: { id: workspaceId } });
}

export interface DeleteCounts {
  workspaces: number;
  projects: number;
  records: number;
}

export type DeleteOutcome = { ok: true; backupDir: string; deleted: DeleteCounts } | { ok: false; issues: Issue[] };

export interface DeleteOptions {
  /** The SQLite file `db` is open on, for the backup snapshot. */
  databaseFile: string;
  /** Defaults to backups/ in the project folder. */
  backupsDir?: string;
  actor: string;
}

/**
 * Deletes items in the Trash permanently. Checks first, then writes a full
 * backup (SQLite snapshot plus one JSON backup per workspace, Trash included),
 * then deletes in one transaction. Nothing is deleted if the backup fails.
 */
export async function deleteFromTrash(db: Db, target: DeleteTarget, options: DeleteOptions): Promise<DeleteOutcome> {
  const check = await planDeletion(db, target);
  if (check.issues.length) return { ok: false, issues: check.issues };
  if (isEmpty(check)) return { ok: false, issues: [errorIssue("RECORD_NOT_FOUND", "Nothing in the Trash matches; it may already be gone.")] };

  const backup = await writeFullBackup(db, options.databaseFile, {
    backupsDir: options.backupsDir,
    label: "before-permanent-delete",
  });

  try {
    const deleted = await db.$transaction(
      async (tx) => {
        const plan = await planDeletion(tx, target);
        if (plan.issues.length) throw new MutationRejectedError(plan.issues);
        const counts: DeleteCounts = { workspaces: 0, projects: 0, records: 0 };
        for (const [projectId, batchIds] of plan.recordBatches) {
          counts.records += (await deleteTrashedRecordsInTx(tx, { projectId, batchIds, actor: options.actor })).length;
        }
        for (const projectId of plan.projectIds) {
          counts.records += await tx.record.count({ where: { projectId } });
          await deleteProjectRowsInTx(tx, projectId);
          counts.projects += 1;
        }
        for (const workspaceId of plan.workspaceIds) {
          counts.records += await tx.record.count({ where: { project: { workspaceId } } });
          counts.projects += await tx.project.count({ where: { workspaceId } });
          await deleteWorkspaceRowsInTx(tx, workspaceId);
          counts.workspaces += 1;
        }
        return counts;
      },
      { timeout: 120_000 },
    );
    return { ok: true, backupDir: backup.dir, deleted };
  } catch (error) {
    if (error instanceof MutationRejectedError) return { ok: false, issues: error.issues };
    throw error;
  }
}

/** "2 projects, 14 records" for messages. */
export function describeDeleteCounts(c: DeleteCounts): string {
  const parts = [
    c.workspaces ? plural(c.workspaces, "workspace", "workspaces") : "",
    c.projects ? plural(c.projects, "project", "projects") : "",
    plural(c.records, "record", "records"),
  ];
  return parts.filter(Boolean).join(", ");
}
