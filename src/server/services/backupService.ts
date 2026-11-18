import { readdirSync } from "node:fs";
import path from "node:path";
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  workspaceBackupV1Schema,
  type BackupCounts,
  type WorkspaceBackupV1,
} from "@/backup/format.v1";
import { newId, type IdPrefix } from "@/domain/ids";
import { errorIssue, hasErrors, type Issue } from "@/domain/issues";
import { parseJsonObject, sha256, sha256Bytes, stableStringify } from "@/domain/json";
import { sniffImage } from "@/images/imageFormat";
import { snapshotHash, snapshotOf, type RecordSnapshot } from "@/domain/records";
import { allowedParent, isLinkableReferenceType, isManuscriptType, requiresParent } from "@/domain/recordTypes";
import { Prisma } from "@/generated/prisma/client";
import { validateDictionaryWord, wordKey } from "@/spelling/dictionary";
import type { Db, DbOrTx, Tx } from "../db";
import { writeAudit } from "./auditService";
import { NotFoundError } from "./errors";

/*
 * Full workspace backup and restore. Restore replicates stored history
 * verbatim (revisions, provenance, audit), so unlike every other write path it
 * does not go through mutationService: it creates rows exactly as they were.
 */

export type IdStrategy = "preserve" | "remap";

const MIGRATIONS_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "prisma", "migrations");

export function knownMigrations(): string[] {
  try {
    return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

function backupChecksum(backup: Omit<WorkspaceBackupV1, "checksum">): string {
  return sha256(stableStringify(backup));
}

function dictionaryEntriesOf(b: WorkspaceBackupV1) {
  return b.dictionaryEntries ?? [];
}

function recordLinksOf(b: WorkspaceBackupV1) {
  return b.recordLinks ?? [];
}

function recordImagesOf(b: WorkspaceBackupV1) {
  return b.recordImages ?? [];
}

function manuscriptGroupsOf(b: WorkspaceBackupV1) {
  return b.manuscriptGroups ?? [];
}

function manuscriptDraftsOf(b: WorkspaceBackupV1) {
  return b.manuscriptDrafts ?? [];
}

function rewriteSourceLinksOf(b: WorkspaceBackupV1) {
  return b.rewriteSourceLinks ?? [];
}

function readingPinsOf(b: WorkspaceBackupV1) {
  return b.readingPins ?? [];
}

function boardsOf(b: WorkspaceBackupV1) {
  return b.boards ?? [];
}

function boardCardsOf(b: WorkspaceBackupV1) {
  return b.boardCards ?? [];
}

/** P2021: table missing. P2022: column missing. */
function isMissingSchemaError(error: unknown, code: "P2021" | "P2022"): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

/*
 * `pnpm db:deploy` backs up with this code before migrating, so the newest
 * tables and columns may not exist yet. Missing ones read as empty.
 */
async function dictionaryRows(db: DbOrTx, workspaceId: string) {
  try {
    return await db.dictionaryEntry.findMany({ where: { workspaceId }, orderBy: { id: "asc" } });
  } catch (error) {
    if (isMissingSchemaError(error, "P2021")) return [];
    throw error;
  }
}

async function recordLinkRows(db: DbOrTx, projectIds: string[]) {
  try {
    return await db.recordLink.findMany({ where: { projectId: { in: projectIds } }, orderBy: { id: "asc" } });
  } catch (error) {
    if (isMissingSchemaError(error, "P2021")) return [];
    throw error;
  }
}

async function recordImageRows(db: DbOrTx, projectIds: string[]) {
  try {
    return await db.recordImage.findMany({ where: { projectId: { in: projectIds } }, orderBy: { id: "asc" } });
  } catch (error) {
    if (isMissingSchemaError(error, "P2021")) return [];
    throw error;
  }
}

async function workspaceRow(db: DbOrTx, workspaceId: string) {
  const where = { id: workspaceId };
  try {
    return await db.workspace.findUnique({ where, select: { id: true, name: true, createdAt: true, trashedAt: true } });
  } catch (error) {
    if (!isMissingSchemaError(error, "P2022")) throw error;
    const row = await db.workspace.findUnique({ where, select: { id: true, name: true, createdAt: true } });
    return row && { ...row, trashedAt: null };
  }
}

async function projectRows(db: DbOrTx, workspaceId: string) {
  const query = { where: { workspaceId }, orderBy: { id: "asc" as const } };
  const draftDefaults = {
    defaultReadingDraftId: null as string | null,
    defaultExportDraftId: null as string | null,
  };
  const assignmentDefaults = {
    seriesName: null as string | null,
    bookName: null as string | null,
    draftKind: null as string | null,
    assignmentRevision: 0,
    ...draftDefaults,
  };
  try {
    return await db.project.findMany({
      ...query,
      select: {
        id: true,
        workspaceId: true,
        title: true,
        createdAt: true,
        trashedAt: true,
        seriesName: true,
        bookName: true,
        draftKind: true,
        assignmentRevision: true,
        defaultReadingDraftId: true,
        defaultExportDraftId: true,
      },
    });
  } catch (error) {
    if (!isMissingSchemaError(error, "P2022")) throw error;
  }
  try {
    const rows = await db.project.findMany({
      ...query,
      select: {
        id: true,
        workspaceId: true,
        title: true,
        createdAt: true,
        trashedAt: true,
        seriesName: true,
        bookName: true,
        draftKind: true,
        assignmentRevision: true,
      },
    });
    return rows.map((p) => ({ ...p, ...draftDefaults }));
  } catch (error) {
    if (!isMissingSchemaError(error, "P2022")) throw error;
  }
  try {
    const rows = await db.project.findMany({
      ...query,
      select: { id: true, workspaceId: true, title: true, createdAt: true, trashedAt: true },
    });
    return rows.map((p) => ({ ...p, ...assignmentDefaults }));
  } catch (error) {
    if (!isMissingSchemaError(error, "P2022")) throw error;
    const rows = await db.project.findMany({ ...query, select: { id: true, workspaceId: true, title: true, createdAt: true } });
    return rows.map((p) => ({ ...p, trashedAt: null, ...assignmentDefaults }));
  }
}

async function manuscriptDraftRows(db: DbOrTx, projectIds: string[]) {
  try {
    return await db.manuscriptDraft.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: [{ projectId: "asc" }, { kind: "asc" }, { id: "asc" }],
    });
  } catch (error) {
    if (isMissingSchemaError(error, "P2021")) return [];
    throw error;
  }
}

async function rewriteSourceLinkRows(db: DbOrTx, projectIds: string[]) {
  try {
    return await db.rewriteSourceLink.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: [{ projectId: "asc" }, { fromRecordId: "asc" }, { position: "asc" }, { id: "asc" }],
    });
  } catch (error) {
    if (isMissingSchemaError(error, "P2021")) return [];
    throw error;
  }
}

async function readingPinRows(db: DbOrTx, projectIds: string[]) {
  // Client may lag schema during `db:backup` before generate; table may be absent before migrate.
  if (!("readingPin" in db) || !(db as { readingPin?: { findMany: unknown } }).readingPin) return [];
  try {
    return await db.readingPin.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: [{ projectId: "asc" }, { scopeDraftId: "asc" }, { position: "asc" }, { id: "asc" }],
    });
  } catch (error) {
    if (isMissingSchemaError(error, "P2021")) return [];
    throw error;
  }
}

async function boardRows(db: DbOrTx, projectIds: string[]) {
  if (!("board" in db) || !(db as { board?: { findMany: unknown } }).board) return [];
  try {
    return await db.board.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: [{ projectId: "asc" }, { id: "asc" }],
    });
  } catch (error) {
    if (isMissingSchemaError(error, "P2021")) return [];
    throw error;
  }
}

async function boardCardRows(db: DbOrTx, projectIds: string[]) {
  if (!("boardCard" in db) || !(db as { boardCard?: { findMany: unknown } }).boardCard) return [];
  try {
    return await db.boardCard.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: [{ boardId: "asc" }, { zIndex: "asc" }, { id: "asc" }],
    });
  } catch (error) {
    if (isMissingSchemaError(error, "P2021")) return [];
    throw error;
  }
}

async function manuscriptGroupRows(db: DbOrTx, projectIds: string[]) {
  try {
    return await db.manuscriptGroup.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: [{ projectId: "asc" }, { position: "asc" }, { id: "asc" }],
    });
  } catch (error) {
    if (isMissingSchemaError(error, "P2021")) return [];
    throw error;
  }
}

const RECORD_COLUMNS = {
  id: true,
  projectId: true,
  type: true,
  title: true,
  body: true,
  fields: true,
  authorityStatus: true,
  supersededByRecordId: true,
  protected: true,
  currentRevision: true,
  createdAt: true,
  updatedAt: true,
} as const;

async function recordRows(db: DbOrTx, projectIds: string[]) {
  const query = { where: { projectId: { in: projectIds } }, orderBy: { id: "asc" as const } };
  const draftCols = { draftId: true as const };
  const assignmentCols = { groupId: true as const, worldScope: true as const, ...draftCols };
  const noDraft = { draftId: null as string | null };
  const noAssignment = { groupId: null as string | null, worldScope: null as string | null, ...noDraft };
  try {
    return await db.record.findMany({
      ...query,
      select: {
        ...RECORD_COLUMNS,
        parentRecordId: true,
        trashedAt: true,
        trashBatchId: true,
        position: true,
        ...assignmentCols,
      },
    });
  } catch (error) {
    if (!isMissingSchemaError(error, "P2022")) throw error;
  }
  try {
    const rows = await db.record.findMany({
      ...query,
      select: {
        ...RECORD_COLUMNS,
        parentRecordId: true,
        trashedAt: true,
        trashBatchId: true,
        position: true,
        groupId: true,
        worldScope: true,
      },
    });
    return rows.map((r) => ({ ...r, ...noDraft }));
  } catch (error) {
    if (!isMissingSchemaError(error, "P2022")) throw error;
  }
  try {
    const rows = await db.record.findMany({
      ...query,
      select: { ...RECORD_COLUMNS, parentRecordId: true, trashedAt: true, trashBatchId: true, position: true },
    });
    return rows.map((r) => ({ ...r, ...noAssignment }));
  } catch (error) {
    if (!isMissingSchemaError(error, "P2022")) throw error;
  }
  try {
    const rows = await db.record.findMany({
      ...query,
      select: { ...RECORD_COLUMNS, parentRecordId: true, trashedAt: true, trashBatchId: true },
    });
    return rows.map((r) => ({ ...r, position: null, ...noAssignment }));
  } catch (error) {
    if (!isMissingSchemaError(error, "P2022")) throw error;
  }
  const noTrash = { trashedAt: null, trashBatchId: null, position: null, ...noAssignment };
  try {
    const rows = await db.record.findMany({ ...query, select: { ...RECORD_COLUMNS, parentRecordId: true } });
    return rows.map((r) => ({ ...r, ...noTrash }));
  } catch (error) {
    if (!isMissingSchemaError(error, "P2022")) throw error;
  }
  const rows = await db.record.findMany({ ...query, select: RECORD_COLUMNS });
  return rows.map((r) => ({ ...r, parentRecordId: null, ...noTrash }));
}

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);
/** Written only for items in the Trash, so other backups keep their earlier shape. */
const trashFields = (row: { trashedAt: Date | null }) => (row.trashedAt ? { trashedAt: iso(row.trashedAt) } : {});
const dateOrNull = (s: string | undefined) => (s ? new Date(s) : null);

export async function createWorkspaceBackup(db: DbOrTx, workspaceId: string): Promise<WorkspaceBackupV1> {
  const workspace = await workspaceRow(db, workspaceId);
  if (!workspace) throw new NotFoundError(`Workspace ${workspaceId} not found`);
  const projects = await projectRows(db, workspaceId);
  const projectIds = projects.map((p) => p.id);
  const inProjects = { projectId: { in: projectIds } };

  const [
    records,
    sources,
    changePackages,
    auditEntries,
    reviewItems,
    importedFiles,
    dictionaryEntries,
    recordLinks,
    recordImages,
    manuscriptGroups,
    manuscriptDrafts,
    rewriteSourceLinks,
    readingPins,
    boards,
    boardCards,
  ] = await Promise.all([
    recordRows(db, projectIds),
    db.source.findMany({ where: inProjects, orderBy: { id: "asc" } }),
    db.changePackage.findMany({ where: inProjects, orderBy: [{ projectId: "asc" }, { packageId: "asc" }] }),
    db.auditEntry.findMany({ where: inProjects, orderBy: { id: "asc" } }),
    db.reviewItem.findMany({ where: inProjects, orderBy: { id: "asc" } }),
    db.importedFile.findMany({ where: inProjects, orderBy: { id: "asc" } }),
    dictionaryRows(db, workspaceId),
    recordLinkRows(db, projectIds),
    recordImageRows(db, projectIds),
    manuscriptGroupRows(db, projectIds),
    manuscriptDraftRows(db, projectIds),
    rewriteSourceLinkRows(db, projectIds),
    readingPinRows(db, projectIds),
    boardRows(db, projectIds),
    boardCardRows(db, projectIds),
  ]);
  const revisions = await db.revision.findMany({
    where: { recordId: { in: records.map((r) => r.id) } },
    orderBy: [{ recordId: "asc" }, { revisionNumber: "asc" }],
  });

  const body: Omit<WorkspaceBackupV1, "checksum"> = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    app: { name: "wordly-editor", migrations: knownMigrations() },
    workspace: { id: workspace.id, name: workspace.name, createdAt: iso(workspace.createdAt), ...trashFields(workspace) },
    projects: projects.map((p) => ({
      id: p.id,
      workspaceId: p.workspaceId,
      title: p.title,
      createdAt: iso(p.createdAt),
      ...trashFields(p),
      ...(p.seriesName ? { seriesName: p.seriesName } : {}),
      ...(p.bookName ? { bookName: p.bookName } : {}),
      ...(p.draftKind === "zero_draft" || p.draftKind === "author_manuscript" ? { draftKind: p.draftKind } : {}),
      ...(p.assignmentRevision > 0 ? { assignmentRevision: p.assignmentRevision } : {}),
      ...(p.defaultReadingDraftId ? { defaultReadingDraftId: p.defaultReadingDraftId } : {}),
      ...(p.defaultExportDraftId ? { defaultExportDraftId: p.defaultExportDraftId } : {}),
    })),
    ...(manuscriptGroups.length
      ? {
          manuscriptGroups: manuscriptGroups.map((g) => ({
            id: g.id,
            projectId: g.projectId,
            label: g.label,
            position: g.position,
            draftKind:
              g.draftKind === "zero_draft" || g.draftKind === "author_manuscript" ? g.draftKind : null,
            createdAt: iso(g.createdAt),
          })),
        }
      : {}),
    ...(manuscriptDrafts.length
      ? {
          manuscriptDrafts: manuscriptDrafts.map((d) => ({
            id: d.id,
            projectId: d.projectId,
            kind: d.kind as "zero_draft" | "author_manuscript",
            label: d.label,
            completedAt: isoOrNull(d.completedAt),
            createdAt: iso(d.createdAt),
          })),
        }
      : {}),
    records: records.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      type: r.type as WorkspaceBackupV1["records"][number]["type"],
      title: r.title,
      body: r.body,
      fields: parseJsonObject(r.fields),
      authorityStatus: r.authorityStatus as WorkspaceBackupV1["records"][number]["authorityStatus"],
      supersededByRecordId: r.supersededByRecordId,
      protected: r.protected,
      parentRecordId: r.parentRecordId,
      ...(r.position !== null ? { position: r.position } : {}),
      ...(r.groupId ? { groupId: r.groupId } : {}),
      ...(r.draftId ? { draftId: r.draftId } : {}),
      ...(r.worldScope === "book" || r.worldScope === "series" ? { worldScope: r.worldScope } : {}),
      currentRevision: r.currentRevision,
      ...trashFields(r),
      ...(r.trashBatchId ? { trashBatchId: r.trashBatchId } : {}),
      createdAt: iso(r.createdAt),
      updatedAt: iso(r.updatedAt),
    })),
    revisions: revisions.map((r) => ({
      id: r.id,
      recordId: r.recordId,
      revisionNumber: r.revisionNumber,
      title: r.title,
      body: r.body,
      fields: parseJsonObject(r.fields),
      authorityStatus: r.authorityStatus as WorkspaceBackupV1["revisions"][number]["authorityStatus"],
      supersededByRecordId: r.supersededByRecordId,
      contentHash: r.contentHash,
      sourceId: r.sourceId,
      createdAt: iso(r.createdAt),
    })),
    sources: sources.map((s) => ({
      id: s.id,
      projectId: s.projectId,
      kind: s.kind as WorkspaceBackupV1["sources"][number]["kind"],
      actor: s.actor,
      conversationLabel: s.conversationLabel,
      url: s.url,
      packageId: s.packageId,
      originalFilename: s.originalFilename,
      createdAt: iso(s.createdAt),
    })),
    changePackages: changePackages.map((p) => ({
      projectId: p.projectId,
      packageId: p.packageId,
      formatVersion: p.formatVersion,
      contentHash: p.contentHash,
      summary: p.summary,
      status: p.status,
      rawJson: p.rawJson,
      resultJson: p.resultJson,
      appliedAt: iso(p.appliedAt),
    })),
    auditEntries: auditEntries.map((a) => ({
      id: a.id,
      projectId: a.projectId,
      action: a.action,
      actor: a.actor,
      sourceId: a.sourceId,
      packageId: a.packageId,
      summary: a.summary,
      detailsJson: a.detailsJson,
      createdAt: iso(a.createdAt),
    })),
    reviewItems: reviewItems.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      recordId: r.recordId,
      packageId: r.packageId,
      triggeredByRecordId: r.triggeredByRecordId,
      origin: r.origin as WorkspaceBackupV1["reviewItems"][number]["origin"],
      note: r.note,
      status: r.status as "open" | "resolved",
      createdAt: iso(r.createdAt),
      resolvedAt: isoOrNull(r.resolvedAt),
    })),
    importedFiles: importedFiles.map((f) => ({
      id: f.id,
      projectId: f.projectId,
      batchId: f.batchId,
      originalFilename: f.originalFilename,
      contentHash: f.contentHash,
      content: f.content,
      byteSize: f.byteSize,
      recordId: f.recordId,
      action: f.action as "created" | "replaced",
      revisionNumber: f.revisionNumber,
      sourceId: f.sourceId,
      createdAt: iso(f.createdAt),
    })),
    dictionaryEntries: dictionaryEntries.map((d) => ({
      id: d.id,
      workspaceId: d.workspaceId,
      projectId: d.projectId,
      word: d.word,
      caseSensitive: d.caseSensitive,
      note: d.note,
      origin: d.origin,
      createdAt: iso(d.createdAt),
      updatedAt: iso(d.updatedAt),
    })),
    recordLinks: recordLinks.map((l) => ({
      id: l.id,
      projectId: l.projectId,
      fromRecordId: l.fromRecordId,
      toRecordId: l.toRecordId,
      createdAt: iso(l.createdAt),
    })),
    ...(rewriteSourceLinks.length
      ? {
          rewriteSourceLinks: rewriteSourceLinks.map((l) => ({
            id: l.id,
            projectId: l.projectId,
            fromRecordId: l.fromRecordId,
            toRecordId: l.toRecordId,
            toRevisionNumber: l.toRevisionNumber,
            position: l.position,
            createdAt: iso(l.createdAt),
          })),
        }
      : {}),
    ...(readingPins.length
      ? {
          readingPins: readingPins.map((p) => ({
            id: p.id,
            projectId: p.projectId,
            scopeDraftId: p.scopeDraftId,
            recordId: p.recordId,
            position: p.position,
            createdAt: iso(p.createdAt),
          })),
        }
      : {}),
    ...(boards.length
      ? {
          boards: boards.map((b) => ({
            id: b.id,
            projectId: b.projectId,
            title: b.title,
            templateKey: b.templateKey as "blank" | "geography",
            createdAt: iso(b.createdAt),
            updatedAt: iso(b.updatedAt),
          })),
        }
      : {}),
    ...(boardCards.length
      ? {
          boardCards: boardCards.map((c) => ({
            id: c.id,
            boardId: c.boardId,
            projectId: c.projectId,
            kind: c.kind as "record" | "image" | "note",
            ...(c.recordId ? { recordId: c.recordId } : { recordId: null }),
            ...(c.imageId ? { imageId: c.imageId } : { imageId: null }),
            noteTitle: c.noteTitle,
            noteBody: c.noteBody,
            x: c.x,
            y: c.y,
            width: c.width,
            height: c.height,
            zIndex: c.zIndex,
            createdAt: iso(c.createdAt),
          })),
        }
      : {}),
    recordImages: recordImages.map((img) => ({
      id: img.id,
      projectId: img.projectId,
      recordId: img.recordId,
      name: img.name,
      originalFilename: img.originalFilename,
      mimeType: img.mimeType as NonNullable<WorkspaceBackupV1["recordImages"]>[number]["mimeType"],
      byteSize: img.byteSize,
      width: img.width,
      height: img.height,
      contentHash: img.contentHash,
      dataBase64: Buffer.from(img.data).toString("base64"),
      caption: img.caption,
      altText: img.altText,
      position: img.position,
      createdAt: iso(img.createdAt),
      updatedAt: iso(img.updatedAt),
    })),
    counts: {
      projects: projects.length,
      records: records.length,
      revisions: revisions.length,
      sources: sources.length,
      changePackages: changePackages.length,
      auditEntries: auditEntries.length,
      reviewItems: reviewItems.length,
      importedFiles: importedFiles.length,
      dictionaryEntries: dictionaryEntries.length,
      recordLinks: recordLinks.length,
      recordImages: recordImages.length,
      ...(manuscriptGroups.length ? { manuscriptGroups: manuscriptGroups.length } : {}),
      ...(manuscriptDrafts.length ? { manuscriptDrafts: manuscriptDrafts.length } : {}),
      ...(rewriteSourceLinks.length ? { rewriteSourceLinks: rewriteSourceLinks.length } : {}),
      ...(readingPins.length ? { readingPins: readingPins.length } : {}),
      ...(boards.length ? { boards: boards.length } : {}),
      ...(boardCards.length ? { boardCards: boardCards.length } : {}),
    },
  };
  return { ...body, checksum: backupChecksum(body) };
}

export interface BackupSummary {
  workspaceId: string;
  workspaceName: string;
  createdAt: string;
  projects: Array<{ id: string; title: string; records: number; openReviewItems: number; changePackages: number }>;
  counts: BackupCounts;
}

export interface BackupValidation {
  ok: boolean;
  issues: Issue[];
  backup: WorkspaceBackupV1 | null;
  summary: BackupSummary | null;
}

function integrity(message: string, pathStr?: string): Issue {
  return errorIssue("BACKUP_INTEGRITY", message, pathStr ? { path: pathStr } : {});
}

function checkUnique(values: string[], label: string, issues: Issue[]) {
  const seen = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) issues.push(integrity(`Duplicate ${label} ${v} in backup.`));
    seen.add(v);
  }
}

/** Structural and referential checks that need no database. */
function checkInternalConsistency(b: WorkspaceBackupV1): Issue[] {
  const issues: Issue[] = [];
  const { checksum, ...rest } = b;
  if (backupChecksum(rest) !== checksum) {
    issues.push(errorIssue("BACKUP_CHECKSUM_MISMATCH", "Checksum does not match the backup contents; the file is corrupted or was edited."));
  }
  const actualCounts: BackupCounts = {
    projects: b.projects.length,
    records: b.records.length,
    revisions: b.revisions.length,
    sources: b.sources.length,
    changePackages: b.changePackages.length,
    auditEntries: b.auditEntries.length,
    reviewItems: b.reviewItems.length,
    importedFiles: b.importedFiles.length,
    dictionaryEntries: dictionaryEntriesOf(b).length,
    recordLinks: recordLinksOf(b).length,
    recordImages: recordImagesOf(b).length,
    manuscriptGroups: manuscriptGroupsOf(b).length,
    manuscriptDrafts: manuscriptDraftsOf(b).length,
    rewriteSourceLinks: rewriteSourceLinksOf(b).length,
    readingPins: readingPinsOf(b).length,
    boards: boardsOf(b).length,
    boardCards: boardCardsOf(b).length,
  };
  for (const key of Object.keys(actualCounts) as (keyof BackupCounts)[]) {
    if (actualCounts[key] !== (b.counts[key] ?? 0)) {
      issues.push(errorIssue("BACKUP_COUNT_MISMATCH", `counts.${key} is ${b.counts[key]} but the backup contains ${actualCounts[key]}.`));
    }
  }

  const unknownMigrations = b.app.migrations.filter((m) => !knownMigrations().includes(m));
  if (unknownMigrations.length > 0 && knownMigrations().length > 0) {
    issues.push(integrity(`Backup was created by a newer schema (${unknownMigrations.join(", ")}). Update the app before restoring.`));
  }

  checkUnique(b.projects.map((p) => p.id), "project", issues);
  checkUnique(b.records.map((r) => r.id), "record", issues);
  checkUnique(b.revisions.map((r) => r.id), "revision", issues);
  checkUnique(b.sources.map((s) => s.id), "source", issues);
  checkUnique(b.auditEntries.map((a) => a.id), "audit entry", issues);
  checkUnique(b.reviewItems.map((r) => r.id), "review item", issues);
  checkUnique(b.importedFiles.map((f) => f.id), "imported file", issues);
  checkUnique(b.changePackages.map((p) => `${p.projectId}/${p.packageId}`), "change package", issues);
  checkUnique(dictionaryEntriesOf(b).map((d) => d.id), "dictionary entry", issues);
  checkUnique(recordLinksOf(b).map((l) => l.id), "reference link", issues);
  checkUnique(recordLinksOf(b).map((l) => `${l.fromRecordId}/${l.toRecordId}`), "reference link pair", issues);
  checkUnique(recordImagesOf(b).map((img) => img.id), "image", issues);
  checkUnique(recordImagesOf(b).map((img) => `${img.recordId}/${img.name}`), "image name", issues);
  checkUnique(manuscriptGroupsOf(b).map((g) => g.id), "manuscript group", issues);
  checkUnique(manuscriptDraftsOf(b).map((d) => d.id), "manuscript draft", issues);
  checkUnique(
    manuscriptDraftsOf(b).map((d) => `${d.projectId}/${d.kind}`),
    "manuscript draft kind",
    issues,
  );
  checkUnique(rewriteSourceLinksOf(b).map((l) => l.id), "rewrite source link", issues);
  checkUnique(
    rewriteSourceLinksOf(b).map((l) => `${l.fromRecordId}/${l.toRecordId}`),
    "rewrite source link pair",
    issues,
  );
  checkUnique(readingPinsOf(b).map((p) => p.id), "reading pin", issues);
  checkUnique(
    readingPinsOf(b).map((p) => `${p.projectId}/${p.scopeDraftId}/${p.recordId}`),
    "reading pin scope",
    issues,
  );
  checkUnique(boardsOf(b).map((x) => x.id), "board", issues);
  checkUnique(boardCardsOf(b).map((c) => c.id), "board card", issues);

  const projectIds = new Set(b.projects.map((p) => p.id));
  const recordIds = new Set(b.records.map((r) => r.id));
  const sourceIds = new Set(b.sources.map((s) => s.id));
  const recordProject = new Map(b.records.map((r) => [r.id, r.projectId]));
  const groupIds = new Set(manuscriptGroupsOf(b).map((g) => g.id));
  const groupProject = new Map(manuscriptGroupsOf(b).map((g) => [g.id, g.projectId]));
  const draftIds = new Set(manuscriptDraftsOf(b).map((d) => d.id));
  const draftProject = new Map(manuscriptDraftsOf(b).map((d) => [d.id, d.projectId]));
  const revisionKeys = new Set(b.revisions.map((r) => `${r.recordId}/${r.revisionNumber}`));

  for (const p of b.projects) {
    if (p.workspaceId !== b.workspace.id) issues.push(integrity(`Project ${p.id} belongs to another workspace.`));
    if (p.defaultReadingDraftId && (!draftIds.has(p.defaultReadingDraftId) || draftProject.get(p.defaultReadingDraftId) !== p.id)) {
      issues.push(integrity(`Project ${p.id} default reading draft ${p.defaultReadingDraftId} is missing.`));
    }
    if (p.defaultExportDraftId && (!draftIds.has(p.defaultExportDraftId) || draftProject.get(p.defaultExportDraftId) !== p.id)) {
      issues.push(integrity(`Project ${p.id} default export draft ${p.defaultExportDraftId} is missing.`));
    }
  }
  const needProject = (pid: string, what: string) => {
    if (!projectIds.has(pid)) issues.push(integrity(`${what} references missing project ${pid}.`));
  };
  manuscriptGroupsOf(b).forEach((g) => needProject(g.projectId, `Manuscript group ${g.id}`));
  manuscriptDraftsOf(b).forEach((d) => needProject(d.projectId, `Manuscript draft ${d.id}`));
  const recordType = new Map(b.records.map((r) => [r.id, r.type]));
  b.records.forEach((r) => {
    needProject(r.projectId, `Record ${r.id}`);
    if (r.supersededByRecordId && !recordIds.has(r.supersededByRecordId)) {
      issues.push(integrity(`Record ${r.id} is superseded by missing record ${r.supersededByRecordId}.`));
    }
    if (r.trashBatchId && !r.trashedAt) issues.push(integrity(`Record ${r.id} has a Trash batch but is not in the Trash.`));
    const parentId = r.parentRecordId ?? null;
    if (parentId === null) {
      if (requiresParent(r.type)) issues.push(integrity(`Record ${r.id} (${r.type}) has no parent record.`));
    } else if (!recordIds.has(parentId) || recordProject.get(parentId) !== r.projectId) {
      issues.push(integrity(`Record ${r.id} belongs to missing record ${parentId}.`));
    } else if (!allowedParent(r.type, recordType.get(parentId)!)) {
      issues.push(integrity(`Record ${r.id} (${r.type}) cannot belong to a ${recordType.get(parentId)}.`));
    }
    if (r.groupId) {
      if (!groupIds.has(r.groupId) || groupProject.get(r.groupId) !== r.projectId) {
        issues.push(integrity(`Record ${r.id} references missing manuscript group ${r.groupId}.`));
      } else if (r.type !== "manuscript_chapter" && r.type !== "manuscript_scene") {
        issues.push(integrity(`Record ${r.id} (${r.type}) cannot belong to a manuscript group.`));
      }
    }
    if (r.draftId) {
      if (!draftIds.has(r.draftId) || draftProject.get(r.draftId) !== r.projectId) {
        issues.push(integrity(`Record ${r.id} references missing manuscript draft ${r.draftId}.`));
      } else if (r.type !== "manuscript_chapter" && r.type !== "manuscript_scene") {
        issues.push(integrity(`Record ${r.id} (${r.type}) cannot belong to a manuscript draft.`));
      }
    }
    if (r.worldScope && r.type !== "character_dossier" && r.type !== "worldbuilding" && r.type !== "canon_decision" && r.type !== "continuity_note" && r.type !== "reference_note") {
      issues.push(integrity(`Record ${r.id} (${r.type}) cannot have a World scope.`));
    }
  });
  recordLinksOf(b).forEach((l) => {
    needProject(l.projectId, `Reference link ${l.id}`);
    for (const end of [l.fromRecordId, l.toRecordId]) {
      if (!recordIds.has(end) || recordProject.get(end) !== l.projectId) {
        issues.push(integrity(`Reference link ${l.id} references missing record ${end}.`));
      }
    }
    const fromType = recordType.get(l.fromRecordId);
    const toType = recordType.get(l.toRecordId);
    if (fromType && toType && (!isManuscriptType(fromType) || !isLinkableReferenceType(toType))) {
      issues.push(integrity(`Reference link ${l.id} must go from a chapter or scene to a reference record.`));
    }
  });
  rewriteSourceLinksOf(b).forEach((l) => {
    needProject(l.projectId, `Rewrite source link ${l.id}`);
    for (const end of [l.fromRecordId, l.toRecordId]) {
      if (!recordIds.has(end) || recordProject.get(end) !== l.projectId) {
        issues.push(integrity(`Rewrite source link ${l.id} references missing record ${end}.`));
      }
    }
    const fromType = recordType.get(l.fromRecordId);
    const toType = recordType.get(l.toRecordId);
    if (fromType && !isManuscriptType(fromType)) {
      issues.push(integrity(`Rewrite source link ${l.id} must start from a chapter or scene.`));
    }
    if (toType && !isManuscriptType(toType)) {
      issues.push(integrity(`Rewrite source link ${l.id} must point to a chapter or scene.`));
    }
    if (!revisionKeys.has(`${l.toRecordId}/${l.toRevisionNumber}`)) {
      issues.push(
        integrity(`Rewrite source link ${l.id} pins missing revision ${l.toRevisionNumber} of ${l.toRecordId}.`),
      );
    }
  });
  readingPinsOf(b).forEach((p) => {
    needProject(p.projectId, `Reading pin ${p.id}`);
    if (!recordIds.has(p.recordId) || recordProject.get(p.recordId) !== p.projectId) {
      issues.push(integrity(`Reading pin ${p.id} references missing record ${p.recordId}.`));
    }
    const type = recordType.get(p.recordId);
    if (type && !isLinkableReferenceType(type)) {
      issues.push(integrity(`Reading pin ${p.id} must point to a reference record.`));
    }
    if (p.scopeDraftId !== "" && (!draftIds.has(p.scopeDraftId) || draftProject.get(p.scopeDraftId) !== p.projectId)) {
      issues.push(integrity(`Reading pin ${p.id} references missing draft ${p.scopeDraftId}.`));
    }
  });
  const boardIds = new Set(boardsOf(b).map((x) => x.id));
  const boardProject = new Map(boardsOf(b).map((x) => [x.id, x.projectId]));
  boardsOf(b).forEach((board) => needProject(board.projectId, `Board ${board.id}`));
  const imageIds = new Set(recordImagesOf(b).map((img) => img.id));
  const imageProject = new Map(recordImagesOf(b).map((img) => [img.id, img.projectId]));
  boardCardsOf(b).forEach((c) => {
    needProject(c.projectId, `Board card ${c.id}`);
    if (!boardIds.has(c.boardId) || boardProject.get(c.boardId) !== c.projectId) {
      issues.push(integrity(`Board card ${c.id} references missing board ${c.boardId}.`));
    }
    if (c.kind === "record") {
      if (!c.recordId || !recordIds.has(c.recordId) || recordProject.get(c.recordId) !== c.projectId) {
        issues.push(integrity(`Board card ${c.id} references missing record ${c.recordId}.`));
      }
    }
    if (c.kind === "image") {
      if (!c.imageId || !imageIds.has(c.imageId) || imageProject.get(c.imageId) !== c.projectId) {
        issues.push(integrity(`Board card ${c.id} references missing image ${c.imageId}.`));
      }
    }
    if (c.recordId && (!recordIds.has(c.recordId) || recordProject.get(c.recordId) !== c.projectId)) {
      issues.push(integrity(`Board card ${c.id} references missing record ${c.recordId}.`));
    }
  });
  recordImagesOf(b).forEach((img) => {
    needProject(img.projectId, `Image ${img.id}`);
    if (!recordIds.has(img.recordId) || recordProject.get(img.recordId) !== img.projectId) {
      issues.push(integrity(`Image ${img.id} references missing record ${img.recordId}.`));
    }
    const type = recordType.get(img.recordId);
    if (type && isManuscriptType(type)) issues.push(integrity(`Image ${img.id} is attached to a chapter or scene.`));
    const bytes = Buffer.from(img.dataBase64, "base64");
    const info = sniffImage(bytes);
    if (bytes.byteLength !== img.byteSize || sha256Bytes(bytes) !== img.contentHash) {
      issues.push(integrity(`Image ${img.id} data does not match its size and hash.`));
    } else if (!info || info.mimeType !== img.mimeType) {
      issues.push(integrity(`Image ${img.id} is not the ${img.mimeType} image it claims to be.`));
    }
  });
  b.sources.forEach((s) => needProject(s.projectId, `Source ${s.id}`));
  b.changePackages.forEach((p) => needProject(p.projectId, `Change package ${p.packageId}`));
  b.auditEntries.forEach((a) => {
    needProject(a.projectId, `Audit entry ${a.id}`);
    if (a.sourceId && !sourceIds.has(a.sourceId)) issues.push(integrity(`Audit entry ${a.id} references missing source ${a.sourceId}.`));
  });
  b.reviewItems.forEach((r) => {
    needProject(r.projectId, `Review item ${r.id}`);
    if (!recordIds.has(r.recordId)) issues.push(integrity(`Review item ${r.id} references missing record ${r.recordId}.`));
  });
  b.importedFiles.forEach((f) => {
    needProject(f.projectId, `Imported file ${f.id}`);
    if (!recordIds.has(f.recordId)) issues.push(integrity(`Imported file ${f.id} references missing record ${f.recordId}.`));
    if (!sourceIds.has(f.sourceId)) issues.push(integrity(`Imported file ${f.id} references missing source ${f.sourceId}.`));
    if (sha256(f.content) !== f.contentHash) issues.push(integrity(`Imported file ${f.id} content does not match its hash.`));
  });
  dictionaryEntriesOf(b).forEach((d) => {
    if (d.workspaceId !== b.workspace.id) issues.push(integrity(`Dictionary entry ${d.id} belongs to another workspace.`));
    if (d.projectId !== null) needProject(d.projectId, `Dictionary entry ${d.id}`);
    if (!validateDictionaryWord(d.word).ok) issues.push(integrity(`Dictionary entry ${d.id} is not a single word.`));
  });

  const revisionsByRecord = new Map<string, WorkspaceBackupV1["revisions"]>();
  for (const rev of b.revisions) {
    if (!recordIds.has(rev.recordId)) issues.push(integrity(`Revision ${rev.id} references missing record ${rev.recordId}.`));
    if (!sourceIds.has(rev.sourceId)) issues.push(integrity(`Revision ${rev.id} references missing source ${rev.sourceId}.`));
    const snap: RecordSnapshot = {
      title: rev.title,
      body: rev.body,
      fields: rev.fields,
      authorityStatus: rev.authorityStatus,
      supersededByRecordId: rev.supersededByRecordId,
    };
    if (snapshotHash(snap) !== rev.contentHash) {
      issues.push(integrity(`Revision ${rev.recordId}#${rev.revisionNumber} content does not match its stored hash.`));
    }
    const sourceProject = b.sources.find((s) => s.id === rev.sourceId)?.projectId;
    if (sourceProject && sourceProject !== recordProject.get(rev.recordId)) {
      issues.push(integrity(`Revision ${rev.id} provenance belongs to another project.`));
    }
    const list = revisionsByRecord.get(rev.recordId) ?? [];
    list.push(rev);
    revisionsByRecord.set(rev.recordId, list);
  }
  for (const r of b.records) {
    const revs = (revisionsByRecord.get(r.id) ?? []).sort((x, y) => x.revisionNumber - y.revisionNumber);
    const contiguous = revs.length === r.currentRevision && revs.every((rev, i) => rev.revisionNumber === i + 1);
    if (!contiguous) {
      issues.push(integrity(`Record ${r.id} must have revisions 1..${r.currentRevision}; found ${revs.map((x) => x.revisionNumber).join(",") || "none"}.`));
      continue;
    }
    const latest = revs[revs.length - 1];
    if (latest.contentHash !== snapshotHash(snapshotOf(r))) {
      issues.push(integrity(`Record ${r.id} current content does not match its latest revision.`));
    }
  }

  for (const p of b.changePackages) {
    try {
      if (sha256(stableStringify(JSON.parse(p.rawJson))) !== p.contentHash) {
        issues.push(integrity(`Change package ${p.packageId} content does not match its stored hash.`));
      }
      JSON.parse(p.resultJson);
    } catch {
      issues.push(integrity(`Change package ${p.packageId} has unreadable JSON.`));
    }
  }
  for (const a of b.auditEntries) {
    try {
      JSON.parse(a.detailsJson);
    } catch {
      issues.push(integrity(`Audit entry ${a.id} has unreadable details JSON.`));
    }
  }
  return issues;
}

async function findCollisions(db: DbOrTx, b: WorkspaceBackupV1): Promise<Issue[]> {
  const issues: Issue[] = [];
  const check = async (label: string, count: Promise<number>) => {
    const n = await count;
    if (n > 0) {
      issues.push(
        errorIssue(
          "BACKUP_ID_COLLISION",
          `${n} ${label} ID(s) from the backup already exist in the target database. Restore into a separate database, or restore as a new workspace (new IDs).`,
        ),
      );
    }
  };
  await check("workspace", db.workspace.count({ where: { id: b.workspace.id } }));
  await check("project", db.project.count({ where: { id: { in: b.projects.map((p) => p.id) } } }));
  await check("record", db.record.count({ where: { id: { in: b.records.map((r) => r.id) } } }));
  await check("revision", db.revision.count({ where: { id: { in: b.revisions.map((r) => r.id) } } }));
  await check("source", db.source.count({ where: { id: { in: b.sources.map((s) => s.id) } } }));
  await check("audit entry", db.auditEntry.count({ where: { id: { in: b.auditEntries.map((a) => a.id) } } }));
  await check("review item", db.reviewItem.count({ where: { id: { in: b.reviewItems.map((r) => r.id) } } }));
  await check("imported file", db.importedFile.count({ where: { id: { in: b.importedFiles.map((f) => f.id) } } }));
  await check("dictionary entry", db.dictionaryEntry.count({ where: { id: { in: dictionaryEntriesOf(b).map((d) => d.id) } } }));
  await check("reference link", db.recordLink.count({ where: { id: { in: recordLinksOf(b).map((l) => l.id) } } }));
  if (recordImagesOf(b).length) {
    await check("image", db.recordImage.count({ where: { id: { in: recordImagesOf(b).map((img) => img.id) } } }));
  }
  if (manuscriptGroupsOf(b).length) {
    await check("manuscript group", db.manuscriptGroup.count({ where: { id: { in: manuscriptGroupsOf(b).map((g) => g.id) } } }));
  }
  if (manuscriptDraftsOf(b).length) {
    await check("manuscript draft", db.manuscriptDraft.count({ where: { id: { in: manuscriptDraftsOf(b).map((d) => d.id) } } }));
  }
  if (rewriteSourceLinksOf(b).length) {
    await check(
      "rewrite source link",
      db.rewriteSourceLink.count({ where: { id: { in: rewriteSourceLinksOf(b).map((l) => l.id) } } }),
    );
  }
  if (readingPinsOf(b).length) {
    await check("reading pin", db.readingPin.count({ where: { id: { in: readingPinsOf(b).map((p) => p.id) } } }));
  }
  if (boardsOf(b).length) {
    await check("board", db.board.count({ where: { id: { in: boardsOf(b).map((x) => x.id) } } }));
  }
  if (boardCardsOf(b).length) {
    await check("board card", db.boardCard.count({ where: { id: { in: boardCardsOf(b).map((c) => c.id) } } }));
  }
  return issues;
}

function summarize(b: WorkspaceBackupV1): BackupSummary {
  return {
    workspaceId: b.workspace.id,
    workspaceName: b.workspace.name,
    createdAt: b.createdAt,
    projects: b.projects.map((p) => ({
      id: p.id,
      title: p.title,
      records: b.records.filter((r) => r.projectId === p.id).length,
      openReviewItems: b.reviewItems.filter((r) => r.projectId === p.id && r.status === "open").length,
      changePackages: b.changePackages.filter((c) => c.projectId === p.id).length,
    })),
    counts: b.counts,
  };
}

/** Validates a backup completely without writing anything. */
export async function validateWorkspaceBackup(
  db: DbOrTx,
  input: string | unknown,
  options: { idStrategy: IdStrategy },
): Promise<BackupValidation> {
  let raw: unknown = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch (e) {
      return { ok: false, issues: [errorIssue("INVALID_JSON", `Not valid JSON: ${(e as Error).message}`)], backup: null, summary: null };
    }
  }
  const obj = raw as { format?: unknown; formatVersion?: unknown } | null;
  if (!obj || typeof obj !== "object" || obj.format !== BACKUP_FORMAT) {
    return { ok: false, issues: [errorIssue("UNSUPPORTED_FORMAT", `"format" must be "${BACKUP_FORMAT}".`)], backup: null, summary: null };
  }
  if (obj.formatVersion !== BACKUP_FORMAT_VERSION) {
    return {
      ok: false,
      issues: [errorIssue("UNSUPPORTED_FORMAT_VERSION", `Backup formatVersion ${JSON.stringify(obj.formatVersion)} is not supported.`)],
      backup: null,
      summary: null,
    };
  }
  const parsed = workspaceBackupV1Schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.slice(0, 50).map((i) => errorIssue("SCHEMA_INVALID", i.message, { path: i.path.join(".") })),
      backup: null,
      summary: null,
    };
  }
  const backup = parsed.data;
  const issues = checkInternalConsistency(backup);
  if (options.idStrategy === "preserve") issues.push(...(await findCollisions(db, backup)));
  return { ok: !hasErrors(issues), issues, backup, summary: summarize(backup) };
}

function rewriteIds(value: unknown, map: ReadonlyMap<string, string>): unknown {
  if (typeof value === "string") return map.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => rewriteIds(v, map));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewriteIds(v, map)]));
  }
  return value;
}

export interface RestoreResult {
  ok: true;
  workspaceId: string;
  workspaceName: string;
  idStrategy: IdStrategy;
  projects: Array<{ originalId: string; id: string; title: string }>;
  counts: BackupCounts;
}

export type RestoreOutcome = RestoreResult | { ok: false; issues: Issue[] };

export interface RestoreOptions {
  /**
   * `preserve` keeps every ID (use for an empty/separate database).
   * `remap` assigns new IDs so the copy can sit beside the original as an
   * isolated workspace; package idempotency stays scoped to the new projects.
   */
  idStrategy: IdStrategy;
  workspaceName?: string;
  actor?: string;
  /** Runs inside the transaction just before commit; a throw rolls everything back. */
  beforeCommit?: (tx: Tx) => Promise<void>;
}

export async function restoreWorkspaceBackup(db: Db, input: string | unknown, options: RestoreOptions): Promise<RestoreOutcome> {
  const validation = await validateWorkspaceBackup(db, input, { idStrategy: options.idStrategy });
  if (!validation.ok || !validation.backup) return { ok: false, issues: validation.issues };
  const b = validation.backup;

  const map = new Map<string, string>();
  const remap = options.idStrategy === "remap";
  const assign = (oldId: string, prefix: IdPrefix) => {
    if (!map.has(oldId)) map.set(oldId, remap ? newId(prefix) : oldId);
    return map.get(oldId)!;
  };
  const m = (oldId: string) => map.get(oldId) ?? oldId;
  const mn = (oldId: string | null) => (oldId === null ? null : m(oldId));

  const workspaceId = assign(b.workspace.id, "wsp");
  b.projects.forEach((p) => assign(p.id, "prj"));
  b.records.forEach((r) => assign(r.id, "rec"));
  b.revisions.forEach((r) => assign(r.id, "rev"));
  b.sources.forEach((s) => assign(s.id, "src"));
  b.auditEntries.forEach((a) => assign(a.id, "aud"));
  b.reviewItems.forEach((r) => assign(r.id, "rvw"));
  b.importedFiles.forEach((f) => assign(f.id, "imp"));
  dictionaryEntriesOf(b).forEach((d) => assign(d.id, "dic"));
  recordLinksOf(b).forEach((l) => assign(l.id, "lnk"));
  recordImagesOf(b).forEach((img) => assign(img.id, "img"));
  manuscriptGroupsOf(b).forEach((g) => assign(g.id, "grp"));
  manuscriptDraftsOf(b).forEach((d) => assign(d.id, "drf"));
  rewriteSourceLinksOf(b).forEach((l) => assign(l.id, "rsl"));
  readingPinsOf(b).forEach((p) => assign(p.id, "pin"));
  boardsOf(b).forEach((x) => assign(x.id, "brd"));
  boardCardsOf(b).forEach((c) => assign(c.id, "bcd"));

  const workspaceName =
    options.workspaceName?.trim() || (remap ? `${b.workspace.name} (restored ${b.createdAt.slice(0, 10)})` : b.workspace.name);
  const rewriteJson = (text: string) => (remap ? JSON.stringify(rewriteIds(JSON.parse(text), map)) : text);

  try {
    await db.$transaction(
      async (tx) => {
        if (options.idStrategy === "preserve") {
          const collisions = await findCollisions(tx, b);
          if (collisions.length) throw new RestoreRejected(collisions);
        }
        await tx.workspace.create({
          data: {
            id: workspaceId,
            name: workspaceName,
            createdAt: new Date(b.workspace.createdAt),
            // Restoring a copy is a request to see it, so a new workspace never starts in the Trash.
            trashedAt: remap ? null : dateOrNull(b.workspace.trashedAt),
          },
        });
        await tx.project.createMany({
          data: b.projects.map((p) => ({
            id: m(p.id),
            workspaceId,
            title: p.title,
            createdAt: new Date(p.createdAt),
            trashedAt: dateOrNull(p.trashedAt),
            seriesName: p.seriesName ?? null,
            bookName: p.bookName ?? null,
            draftKind: p.draftKind ?? null,
            assignmentRevision: p.assignmentRevision ?? 0,
            // Defaults set after drafts exist (FK).
            defaultReadingDraftId: null,
            defaultExportDraftId: null,
          })),
        });
        await tx.source.createMany({
          data: b.sources.map((s) => ({
            id: m(s.id),
            projectId: m(s.projectId),
            kind: s.kind,
            actor: s.actor,
            conversationLabel: s.conversationLabel,
            url: s.url,
            packageId: s.packageId,
            originalFilename: s.originalFilename,
            createdAt: new Date(s.createdAt),
          })),
        });
        const groups = manuscriptGroupsOf(b);
        if (groups.length) {
          await tx.manuscriptGroup.createMany({
            data: groups.map((g) => ({
              id: m(g.id),
              projectId: m(g.projectId),
              label: g.label,
              position: g.position,
              draftKind: g.draftKind,
              createdAt: new Date(g.createdAt),
            })),
          });
        }
        const drafts = manuscriptDraftsOf(b);
        if (drafts.length) {
          await tx.manuscriptDraft.createMany({
            data: drafts.map((d) => ({
              id: m(d.id),
              projectId: m(d.projectId),
              kind: d.kind,
              label: d.label,
              completedAt: dateOrNull(d.completedAt ?? undefined),
              createdAt: new Date(d.createdAt),
            })),
          });
        }
        await tx.record.createMany({
          data: b.records.map((r) => ({
            id: m(r.id),
            projectId: m(r.projectId),
            type: r.type,
            title: r.title,
            body: r.body,
            fields: stableStringify(r.fields),
            authorityStatus: r.authorityStatus,
            supersededByRecordId: mn(r.supersededByRecordId),
            protected: r.protected,
            parentRecordId: mn(r.parentRecordId ?? null),
            position: r.position ?? null,
            groupId: r.groupId ? m(r.groupId) : null,
            draftId: r.draftId ? m(r.draftId) : null,
            worldScope: r.worldScope ?? null,
            currentRevision: r.currentRevision,
            trashedAt: dateOrNull(r.trashedAt),
            trashBatchId: r.trashBatchId ?? null,
            createdAt: new Date(r.createdAt),
            updatedAt: new Date(r.updatedAt),
          })),
        });
        for (const p of b.projects) {
          if (!p.defaultReadingDraftId && !p.defaultExportDraftId) continue;
          await tx.project.update({
            where: { id: m(p.id) },
            data: {
              defaultReadingDraftId: p.defaultReadingDraftId ? m(p.defaultReadingDraftId) : null,
              defaultExportDraftId: p.defaultExportDraftId ? m(p.defaultExportDraftId) : null,
            },
          });
        }
        await tx.revision.createMany({
          data: b.revisions.map((r) => {
            const supersededByRecordId = mn(r.supersededByRecordId);
            const snapshot: RecordSnapshot = {
              title: r.title,
              body: r.body,
              fields: r.fields,
              authorityStatus: r.authorityStatus,
              supersededByRecordId,
            };
            return {
              id: m(r.id),
              recordId: m(r.recordId),
              revisionNumber: r.revisionNumber,
              title: r.title,
              body: r.body,
              fields: stableStringify(r.fields),
              authorityStatus: r.authorityStatus,
              supersededByRecordId,
              contentHash: snapshotHash(snapshot),
              sourceId: m(r.sourceId),
              createdAt: new Date(r.createdAt),
            };
          }),
        });
        await tx.changePackage.createMany({
          data: b.changePackages.map((p) => ({
            projectId: m(p.projectId),
            packageId: p.packageId,
            formatVersion: p.formatVersion,
            contentHash: p.contentHash,
            summary: p.summary,
            status: p.status,
            rawJson: p.rawJson,
            resultJson: rewriteJson(p.resultJson),
            appliedAt: new Date(p.appliedAt),
          })),
        });
        await tx.auditEntry.createMany({
          data: b.auditEntries.map((a) => ({
            id: m(a.id),
            projectId: m(a.projectId),
            action: a.action,
            actor: a.actor,
            sourceId: mn(a.sourceId),
            packageId: a.packageId,
            summary: a.summary,
            detailsJson: rewriteJson(a.detailsJson),
            createdAt: new Date(a.createdAt),
          })),
        });
        await tx.reviewItem.createMany({
          data: b.reviewItems.map((r) => ({
            id: m(r.id),
            projectId: m(r.projectId),
            recordId: m(r.recordId),
            packageId: r.packageId,
            triggeredByRecordId: mn(r.triggeredByRecordId),
            origin: r.origin,
            note: r.note,
            status: r.status,
            createdAt: new Date(r.createdAt),
            resolvedAt: r.resolvedAt ? new Date(r.resolvedAt) : null,
          })),
        });
        await tx.importedFile.createMany({
          data: b.importedFiles.map((f) => ({
            id: m(f.id),
            projectId: m(f.projectId),
            batchId: f.batchId,
            originalFilename: f.originalFilename,
            contentHash: f.contentHash,
            content: f.content,
            byteSize: f.byteSize,
            recordId: m(f.recordId),
            action: f.action,
            revisionNumber: f.revisionNumber,
            sourceId: m(f.sourceId),
            createdAt: new Date(f.createdAt),
          })),
        });
        await tx.dictionaryEntry.createMany({
          data: dictionaryEntriesOf(b).map((d) => ({
            id: m(d.id),
            workspaceId,
            projectId: mn(d.projectId),
            word: d.word,
            wordKey: wordKey(d.word),
            caseSensitive: d.caseSensitive,
            note: d.note,
            origin: d.origin,
            createdAt: new Date(d.createdAt),
            updatedAt: new Date(d.updatedAt),
          })),
        });
        await tx.recordLink.createMany({
          data: recordLinksOf(b).map((l) => ({
            id: m(l.id),
            projectId: m(l.projectId),
            fromRecordId: m(l.fromRecordId),
            toRecordId: m(l.toRecordId),
            createdAt: new Date(l.createdAt),
          })),
        });
        const rewriteLinks = rewriteSourceLinksOf(b);
        if (rewriteLinks.length) {
          await tx.rewriteSourceLink.createMany({
            data: rewriteLinks.map((l) => ({
              id: m(l.id),
              projectId: m(l.projectId),
              fromRecordId: m(l.fromRecordId),
              toRecordId: m(l.toRecordId),
              toRevisionNumber: l.toRevisionNumber,
              position: l.position,
              createdAt: new Date(l.createdAt),
            })),
          });
        }
        const pins = readingPinsOf(b);
        if (pins.length) {
          await tx.readingPin.createMany({
            data: pins.map((p) => ({
              id: m(p.id),
              projectId: m(p.projectId),
              scopeDraftId: p.scopeDraftId === "" ? "" : m(p.scopeDraftId),
              recordId: m(p.recordId),
              position: p.position,
              createdAt: new Date(p.createdAt),
            })),
          });
        }
        const boards = boardsOf(b);
        if (boards.length) {
          await tx.board.createMany({
            data: boards.map((board) => ({
              id: m(board.id),
              projectId: m(board.projectId),
              title: board.title,
              templateKey: board.templateKey,
              createdAt: new Date(board.createdAt),
              updatedAt: new Date(board.updatedAt),
            })),
          });
        }
        // One at a time: a batch of large images would be one very large statement.
        for (const img of recordImagesOf(b)) {
          await tx.recordImage.create({
            data: {
              id: m(img.id),
              projectId: m(img.projectId),
              recordId: m(img.recordId),
              name: img.name,
              originalFilename: img.originalFilename,
              mimeType: img.mimeType,
              byteSize: img.byteSize,
              width: img.width,
              height: img.height,
              contentHash: img.contentHash,
              data: Buffer.from(img.dataBase64, "base64"),
              caption: img.caption,
              altText: img.altText,
              position: img.position,
              createdAt: new Date(img.createdAt),
              updatedAt: new Date(img.updatedAt),
            },
          });
        }
        const cards = boardCardsOf(b);
        if (cards.length) {
          await tx.boardCard.createMany({
            data: cards.map((c) => ({
              id: m(c.id),
              boardId: m(c.boardId),
              projectId: m(c.projectId),
              kind: c.kind,
              recordId: c.recordId ? m(c.recordId) : null,
              imageId: c.imageId ? m(c.imageId) : null,
              noteTitle: c.noteTitle,
              noteBody: c.noteBody,
              x: c.x,
              y: c.y,
              width: c.width,
              height: c.height,
              zIndex: c.zIndex,
              createdAt: new Date(c.createdAt),
            })),
          });
        }
        for (const p of b.projects) {
          await writeAudit(tx, {
            projectId: m(p.id),
            action: "workspace.restore",
            actor: options.actor ?? "author",
            summary: `Restored from backup of "${b.workspace.name}" taken ${b.createdAt}`,
            details: {
              idStrategy: options.idStrategy,
              backupChecksum: b.checksum,
              backupCreatedAt: b.createdAt,
              originalWorkspaceId: b.workspace.id,
              originalProjectId: p.id,
              recordIdMap: Object.fromEntries(
                b.records.filter((r) => r.projectId === p.id).map((r) => [r.id, m(r.id)]),
              ),
            },
          });
        }
        if (options.beforeCommit) await options.beforeCommit(tx);
      },
      { timeout: 120_000 },
    );
  } catch (error) {
    if (error instanceof RestoreRejected) return { ok: false, issues: error.issues };
    throw error;
  }

  return {
    ok: true,
    workspaceId,
    workspaceName,
    idStrategy: options.idStrategy,
    projects: b.projects.map((p) => ({ originalId: p.id, id: m(p.id), title: p.title })),
    counts: b.counts,
  };
}

class RestoreRejected extends Error {
  constructor(readonly issues: Issue[]) {
    super("restore rejected");
  }
}
