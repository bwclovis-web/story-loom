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

function worldMapsOf(b: WorkspaceBackupV1) {
  return b.worldMaps ?? [];
}

function worldMapPinsOf(b: WorkspaceBackupV1) {
  return b.worldMapPins ?? [];
}

function placeRelationsOf(b: WorkspaceBackupV1) {
  return b.placeRelations ?? [];
}

function weaveGridsOf(b: WorkspaceBackupV1) {
  return b.weaveGrids ?? [];
}

function weaveThreadsOf(b: WorkspaceBackupV1) {
  return b.weaveThreads ?? [];
}

function weaveBeatsOf(b: WorkspaceBackupV1) {
  return b.weaveBeats ?? [];
}

function weaveBeatWorldRefsOf(b: WorkspaceBackupV1) {
  return b.weaveBeatWorldRefs ?? [];
}

function weaveSetupPayoffsOf(b: WorkspaceBackupV1) {
  return b.weaveSetupPayoffs ?? [];
}

function weaveTemplatesOf(b: WorkspaceBackupV1) {
  return b.weaveTemplates ?? [];
}

function weaveTemplateBeatsOf(b: WorkspaceBackupV1) {
  return b.weaveTemplateBeats ?? [];
}

function establishedFactsOf(b: WorkspaceBackupV1) {
  return b.establishedFacts ?? [];
}

function factEvidenceOf(b: WorkspaceBackupV1) {
  return b.factEvidence ?? [];
}

function assistantConversationsOf(b: WorkspaceBackupV1) {
  return b.assistantConversations ?? [];
}

function assistantMessagesOf(b: WorkspaceBackupV1) {
  return b.assistantMessages ?? [];
}

function assistantContextItemsOf(b: WorkspaceBackupV1) {
  return b.assistantContextItems ?? [];
}

function assistantProposalsOf(b: WorkspaceBackupV1) {
  return b.assistantProposals ?? [];
}

function projectAssistantSettingsOf(b: WorkspaceBackupV1) {
  return b.projectAssistantSettings ?? [];
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

async function worldMapRows(db: DbOrTx, projectIds: string[]) {
  if (!("worldMap" in db) || !(db as { worldMap?: { findMany: unknown } }).worldMap) return [];
  try {
    return await db.worldMap.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: [{ projectId: "asc" }, { id: "asc" }],
    });
  } catch (error) {
    if (isMissingSchemaError(error, "P2021")) return [];
    throw error;
  }
}

async function worldMapPinRows(db: DbOrTx, projectIds: string[]) {
  if (!("worldMapPin" in db) || !(db as { worldMapPin?: { findMany: unknown } }).worldMapPin) return [];
  try {
    return await db.worldMapPin.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: [{ mapId: "asc" }, { id: "asc" }],
    });
  } catch (error) {
    if (isMissingSchemaError(error, "P2021")) return [];
    throw error;
  }
}

async function placeRelationRows(db: DbOrTx, projectIds: string[]) {
  if (!("placeRelation" in db) || !(db as { placeRelation?: { findMany: unknown } }).placeRelation) return [];
  try {
    return await db.placeRelation.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: [{ projectId: "asc" }, { kind: "asc" }, { id: "asc" }],
    });
  } catch (error) {
    if (isMissingSchemaError(error, "P2021")) return [];
    throw error;
  }
}

async function weaveGridRows(db: DbOrTx, projectIds: string[]) {
  if (!("weaveGrid" in db) || !(db as { weaveGrid?: { findMany: unknown } }).weaveGrid) return [];
  try {
    return await db.weaveGrid.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: [{ projectId: "asc" }, { id: "asc" }],
    });
  } catch (error) {
    if (isMissingSchemaError(error, "P2021")) return [];
    throw error;
  }
}

async function weaveThreadRows(db: DbOrTx, projectIds: string[]) {
  if (!("weaveThread" in db) || !(db as { weaveThread?: { findMany: unknown } }).weaveThread) return [];
  try {
    return await db.weaveThread.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: [{ gridId: "asc" }, { position: "asc" }, { id: "asc" }],
    });
  } catch (error) {
    if (isMissingSchemaError(error, "P2021")) return [];
    throw error;
  }
}

async function weaveBeatRows(db: DbOrTx, projectIds: string[]) {
  if (!("weaveBeat" in db) || !(db as { weaveBeat?: { findMany: unknown } }).weaveBeat) return [];
  try {
    return await db.weaveBeat.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: [{ gridId: "asc" }, { zIndex: "asc" }, { id: "asc" }],
    });
  } catch (error) {
    if (isMissingSchemaError(error, "P2021")) return [];
    throw error;
  }
}

async function weaveBeatWorldRefRows(db: DbOrTx, projectIds: string[]) {
  if (!("weaveBeatWorldRef" in db) || !(db as { weaveBeatWorldRef?: { findMany: unknown } }).weaveBeatWorldRef) return [];
  try {
    return await db.weaveBeatWorldRef.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: [{ beatId: "asc" }, { id: "asc" }],
    });
  } catch (error) {
    if (isMissingSchemaError(error, "P2021")) return [];
    throw error;
  }
}

async function weaveSetupPayoffRows(db: DbOrTx, workspaceId: string) {
  if (!("weaveSetupPayoff" in db) || !(db as { weaveSetupPayoff?: { findMany: unknown } }).weaveSetupPayoff) return [];
  try {
    return await db.weaveSetupPayoff.findMany({
      where: { workspaceId },
      orderBy: [{ id: "asc" }],
    });
  } catch (error) {
    if (isMissingSchemaError(error, "P2021")) return [];
    throw error;
  }
}

async function weaveTemplateRows(db: DbOrTx, projectIds: string[]) {
  if (!("weaveTemplate" in db) || !(db as { weaveTemplate?: { findMany: unknown } }).weaveTemplate) return [];
  try {
    return await db.weaveTemplate.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: [{ projectId: "asc" }, { id: "asc" }],
    });
  } catch (error) {
    if (isMissingSchemaError(error, "P2021")) return [];
    throw error;
  }
}

async function weaveTemplateBeatRows(db: DbOrTx, templateIds: string[]) {
  if (!templateIds.length) return [];
  if (!("weaveTemplateBeat" in db) || !(db as { weaveTemplateBeat?: { findMany: unknown } }).weaveTemplateBeat) return [];
  try {
    return await db.weaveTemplateBeat.findMany({
      where: { templateId: { in: templateIds } },
      orderBy: [{ templateId: "asc" }, { position: "asc" }, { id: "asc" }],
    });
  } catch (error) {
    if (isMissingSchemaError(error, "P2021")) return [];
    throw error;
  }
}

async function establishedFactRows(db: DbOrTx, projectIds: string[]) {
  if (!("establishedFact" in db) || !(db as { establishedFact?: { findMany: unknown } }).establishedFact) return [];
  try {
    return await db.establishedFact.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: [{ projectId: "asc" }, { id: "asc" }],
    });
  } catch (error) {
    if (isMissingSchemaError(error, "P2021")) return [];
    throw error;
  }
}

async function factEvidenceRows(db: DbOrTx, projectIds: string[]) {
  if (!("factEvidence" in db) || !(db as { factEvidence?: { findMany: unknown } }).factEvidence) return [];
  try {
    return await db.factEvidence.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: [{ factId: "asc" }, { id: "asc" }],
    });
  } catch (error) {
    if (isMissingSchemaError(error, "P2021")) return [];
    throw error;
  }
}

async function assistantConversationRows(db: DbOrTx, projectIds: string[]) {
  try {
    return await db.assistantConversation.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: [{ projectId: "asc" }, { id: "asc" }],
    });
  } catch (error) {
    if (isMissingSchemaError(error, "P2021") || isMissingSchemaError(error, "P2022")) return [];
    throw error;
  }
}

async function assistantMessageRows(db: DbOrTx, conversationIds: string[]) {
  if (!conversationIds.length) return [];
  try {
    return await db.assistantMessage.findMany({
      where: { conversationId: { in: conversationIds } },
      orderBy: [{ conversationId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
  } catch (error) {
    if (isMissingSchemaError(error, "P2021")) return [];
    throw error;
  }
}

async function assistantContextItemRows(db: DbOrTx, messageIds: string[]) {
  if (!messageIds.length) return [];
  try {
    return await db.assistantContextItem.findMany({
      where: { messageId: { in: messageIds } },
      orderBy: [{ messageId: "asc" }, { id: "asc" }],
    });
  } catch (error) {
    if (isMissingSchemaError(error, "P2021")) return [];
    throw error;
  }
}

async function assistantProposalRows(db: DbOrTx, projectIds: string[]) {
  try {
    return await db.assistantProposal.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: [{ projectId: "asc" }, { id: "asc" }],
    });
  } catch (error) {
    if (isMissingSchemaError(error, "P2021")) return [];
    throw error;
  }
}

async function projectAssistantSettingsRows(db: DbOrTx, projectIds: string[]) {
  try {
    return await db.projectAssistantSettings.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: { projectId: "asc" },
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
    worldMaps,
    worldMapPins,
    placeRelations,
    weaveGrids,
    weaveThreads,
    weaveBeats,
    weaveBeatWorldRefs,
    weaveSetupPayoffs,
    weaveTemplates,
    establishedFacts,
    factEvidence,
    assistantConversations,
    assistantProposals,
    projectAssistantSettings,
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
    worldMapRows(db, projectIds),
    worldMapPinRows(db, projectIds),
    placeRelationRows(db, projectIds),
    weaveGridRows(db, projectIds),
    weaveThreadRows(db, projectIds),
    weaveBeatRows(db, projectIds),
    weaveBeatWorldRefRows(db, projectIds),
    weaveSetupPayoffRows(db, workspaceId),
    weaveTemplateRows(db, projectIds),
    establishedFactRows(db, projectIds),
    factEvidenceRows(db, projectIds),
    assistantConversationRows(db, projectIds),
    assistantProposalRows(db, projectIds),
    projectAssistantSettingsRows(db, projectIds),
  ]);
  const weaveTemplateBeats = await weaveTemplateBeatRows(
    db,
    weaveTemplates.map((t) => t.id),
  );
  const assistantMessages = await assistantMessageRows(
    db,
    assistantConversations.map((c) => c.id),
  );
  const assistantContextItems = await assistantContextItemRows(
    db,
    assistantMessages.map((m) => m.id),
  );
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
    ...(worldMaps.length
      ? {
          worldMaps: worldMaps.map((m) => ({
            id: m.id,
            projectId: m.projectId,
            title: m.title,
            imageId: m.imageId,
            createdAt: iso(m.createdAt),
            updatedAt: iso(m.updatedAt),
          })),
        }
      : {}),
    ...(worldMapPins.length
      ? {
          worldMapPins: worldMapPins.map((p) => ({
            id: p.id,
            mapId: p.mapId,
            projectId: p.projectId,
            recordId: p.recordId,
            xNorm: p.xNorm,
            yNorm: p.yNorm,
            createdAt: iso(p.createdAt),
          })),
        }
      : {}),
    ...(placeRelations.length
      ? {
          placeRelations: placeRelations.map((r) => ({
            id: r.id,
            projectId: r.projectId,
            fromRecordId: r.fromRecordId,
            toRecordId: r.toRecordId,
            kind: r.kind as "part_of" | "flows_into" | "governed_by",
            createdAt: iso(r.createdAt),
          })),
        }
      : {}),
    ...(weaveGrids.length
      ? {
          weaveGrids: weaveGrids.map((g) => ({
            id: g.id,
            projectId: g.projectId,
            title: g.title,
            viewKind: g.viewKind as "original" | "zero_draft_map" | "author_rewrite",
            ...((g as { layoutMode?: string }).layoutMode === "plot_grid" ? { layoutMode: "plot_grid" as const } : {}),
            ...(g.sourceTemplateId ? { sourceTemplateId: g.sourceTemplateId } : { sourceTemplateId: null }),
            createdAt: iso(g.createdAt),
            updatedAt: iso(g.updatedAt),
          })),
        }
      : {}),
    ...(weaveThreads.length
      ? {
          weaveThreads: weaveThreads.map((t) => ({
            id: t.id,
            gridId: t.gridId,
            projectId: t.projectId,
            title: t.title,
            position: t.position,
            createdAt: iso(t.createdAt),
          })),
        }
      : {}),
    ...(weaveBeats.length
      ? {
          weaveBeats: weaveBeats.map((b) => {
            const threadId = (b as { threadId?: string | null }).threadId ?? null;
            const cellOrder = (b as { cellOrder?: number }).cellOrder ?? 0;
            return {
              id: b.id,
              gridId: b.gridId,
              projectId: b.projectId,
              title: b.title,
              body: b.body,
              decision: (b.decision || "") as "" | "keep" | "cut" | "move" | "combine" | "rebuild",
              ...(b.manuscriptRecordId ? { manuscriptRecordId: b.manuscriptRecordId } : { manuscriptRecordId: null }),
              ...(threadId ? { threadId } : {}),
              ...(cellOrder ? { cellOrder } : {}),
              x: b.x,
              y: b.y,
              width: b.width,
              height: b.height,
              zIndex: b.zIndex,
              createdAt: iso(b.createdAt),
            };
          }),
        }
      : {}),
    ...(weaveBeatWorldRefs.length
      ? {
          weaveBeatWorldRefs: weaveBeatWorldRefs.map((r) => ({
            id: r.id,
            beatId: r.beatId,
            projectId: r.projectId,
            recordId: r.recordId,
            createdAt: iso(r.createdAt),
          })),
        }
      : {}),
    ...(weaveSetupPayoffs.length
      ? {
          weaveSetupPayoffs: weaveSetupPayoffs.map((r) => ({
            id: r.id,
            workspaceId: r.workspaceId,
            fromBeatId: r.fromBeatId,
            toBeatId: r.toBeatId,
            note: r.note,
            createdAt: iso(r.createdAt),
          })),
        }
      : {}),
    ...(weaveTemplates.length
      ? {
          weaveTemplates: weaveTemplates.map((t) => ({
            id: t.id,
            projectId: t.projectId,
            title: t.title,
            description: t.description,
            createdAt: iso(t.createdAt),
            updatedAt: iso(t.updatedAt),
          })),
        }
      : {}),
    ...(weaveTemplateBeats.length
      ? {
          weaveTemplateBeats: weaveTemplateBeats.map((b) => ({
            id: b.id,
            templateId: b.templateId,
            title: b.title,
            body: b.body,
            decision: (b.decision || "") as "" | "keep" | "cut" | "move" | "combine" | "rebuild",
            x: b.x,
            y: b.y,
            width: b.width,
            height: b.height,
            zIndex: b.zIndex,
            position: b.position,
          })),
        }
      : {}),
    ...(establishedFacts.length
      ? {
          establishedFacts: establishedFacts.map((f) => ({
            id: f.id,
            projectId: f.projectId,
            subjectRecordId: f.subjectRecordId,
            statement: f.statement,
            status: f.status as "pending" | "accepted" | "dismissed",
            evidenceKind: f.evidenceKind as "planned" | "zero_draft" | "author_rewrite",
            createdAt: iso(f.createdAt),
            updatedAt: iso(f.updatedAt),
          })),
        }
      : {}),
    ...(factEvidence.length
      ? {
          factEvidence: factEvidence.map((e) => ({
            id: e.id,
            factId: e.factId,
            projectId: e.projectId,
            sourceRecordId: e.sourceRecordId,
            revisionNumber: e.revisionNumber,
            passageStart: e.passageStart,
            passageEnd: e.passageEnd,
            passageExcerpt: e.passageExcerpt,
            contentHash: e.contentHash,
            evidenceKind: e.evidenceKind as "planned" | "zero_draft" | "author_rewrite",
            needsRecheck: e.needsRecheck,
            createdAt: iso(e.createdAt),
          })),
        }
      : {}),
    ...(assistantConversations.length
      ? {
          assistantConversations: assistantConversations.map((c) => ({
            id: c.id,
            workspaceId: c.workspaceId,
            projectId: c.projectId,
            title: c.title,
            summary: c.summary || undefined,
            createdAt: iso(c.createdAt),
            updatedAt: iso(c.updatedAt),
          })),
        }
      : {}),
    ...(assistantMessages.length
      ? {
          assistantMessages: assistantMessages.map((m) => ({
            id: m.id,
            conversationId: m.conversationId,
            role: m.role as "user" | "assistant",
            mode: (m.mode === "proposal" ? "proposal" : "chat") as "chat" | "proposal",
            content: m.content,
            replyToId: m.replyToId ?? undefined,
            status: m.status,
            errorCode: m.errorCode ?? undefined,
            errorMessage: m.errorMessage ?? undefined,
            model: m.model ?? undefined,
            providerResponseId: m.providerResponseId ?? undefined,
            inputTokens: m.inputTokens ?? undefined,
            outputTokens: m.outputTokens ?? undefined,
            totalTokens: m.totalTokens ?? undefined,
            usageEstimated: m.usageEstimated,
            includedMessageIds: JSON.parse(m.includedMessageIds) as string[],
            requestChars: m.requestChars ?? undefined,
            createdAt: iso(m.createdAt),
            completedAt: m.completedAt ? iso(m.completedAt) : undefined,
          })),
        }
      : {}),
    ...(assistantContextItems.length
      ? {
          assistantContextItems: assistantContextItems.map((c) => ({
            id: c.id,
            messageId: c.messageId,
            recordId: c.recordId,
            revisionNumber: c.revisionNumber,
            kind: c.kind,
            passageStart: c.passageStart ?? undefined,
            passageEnd: c.passageEnd ?? undefined,
            charCount: c.charCount,
            contentHash: c.contentHash,
          })),
        }
      : {}),
    ...(assistantProposals.length
      ? {
          assistantProposals: assistantProposals.map((p) => ({
            id: p.id,
            messageId: p.messageId,
            workspaceId: p.workspaceId,
            projectId: p.projectId,
            packageId: p.packageId,
            packageJson: p.packageJson,
            contentHash: p.contentHash,
            operationCount: p.operationCount,
            status: p.status as "proposed" | "applied",
            createdAt: iso(p.createdAt),
            appliedAt: p.appliedAt ? iso(p.appliedAt) : undefined,
          })),
        }
      : {}),
    ...(projectAssistantSettings.length
      ? {
          projectAssistantSettings: projectAssistantSettings.map((s) => ({
            id: s.id,
            projectId: s.projectId,
            autoIncludeRecent: s.autoIncludeRecent,
            recentContextBudgetChars: s.recentContextBudgetChars,
            updatedAt: iso(s.updatedAt),
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
      ...(worldMaps.length ? { worldMaps: worldMaps.length } : {}),
      ...(worldMapPins.length ? { worldMapPins: worldMapPins.length } : {}),
      ...(placeRelations.length ? { placeRelations: placeRelations.length } : {}),
      ...(weaveGrids.length ? { weaveGrids: weaveGrids.length } : {}),
      ...(weaveThreads.length ? { weaveThreads: weaveThreads.length } : {}),
      ...(weaveBeats.length ? { weaveBeats: weaveBeats.length } : {}),
      ...(weaveBeatWorldRefs.length ? { weaveBeatWorldRefs: weaveBeatWorldRefs.length } : {}),
      ...(weaveSetupPayoffs.length ? { weaveSetupPayoffs: weaveSetupPayoffs.length } : {}),
      ...(weaveTemplates.length ? { weaveTemplates: weaveTemplates.length } : {}),
      ...(weaveTemplateBeats.length ? { weaveTemplateBeats: weaveTemplateBeats.length } : {}),
      ...(establishedFacts.length ? { establishedFacts: establishedFacts.length } : {}),
      ...(factEvidence.length ? { factEvidence: factEvidence.length } : {}),
      ...(assistantConversations.length ? { assistantConversations: assistantConversations.length } : {}),
      ...(assistantMessages.length ? { assistantMessages: assistantMessages.length } : {}),
      ...(assistantContextItems.length ? { assistantContextItems: assistantContextItems.length } : {}),
      ...(assistantProposals.length ? { assistantProposals: assistantProposals.length } : {}),
      ...(projectAssistantSettings.length ? { projectAssistantSettings: projectAssistantSettings.length } : {}),
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
    worldMaps: worldMapsOf(b).length,
    worldMapPins: worldMapPinsOf(b).length,
    placeRelations: placeRelationsOf(b).length,
    weaveGrids: weaveGridsOf(b).length,
    weaveThreads: weaveThreadsOf(b).length,
    weaveBeats: weaveBeatsOf(b).length,
    weaveBeatWorldRefs: weaveBeatWorldRefsOf(b).length,
    weaveSetupPayoffs: weaveSetupPayoffsOf(b).length,
    weaveTemplates: weaveTemplatesOf(b).length,
    weaveTemplateBeats: weaveTemplateBeatsOf(b).length,
    establishedFacts: establishedFactsOf(b).length,
    factEvidence: factEvidenceOf(b).length,
    assistantConversations: assistantConversationsOf(b).length,
    assistantMessages: assistantMessagesOf(b).length,
    assistantContextItems: assistantContextItemsOf(b).length,
    assistantProposals: assistantProposalsOf(b).length,
    projectAssistantSettings: projectAssistantSettingsOf(b).length,
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
  checkUnique(worldMapsOf(b).map((x) => x.id), "world map", issues);
  checkUnique(worldMapPinsOf(b).map((p) => p.id), "world map pin", issues);
  checkUnique(placeRelationsOf(b).map((r) => r.id), "place relation", issues);
  checkUnique(
    placeRelationsOf(b).map((r) => `${r.fromRecordId}/${r.toRecordId}/${r.kind}`),
    "place relation triple",
    issues,
  );
  checkUnique(weaveGridsOf(b).map((x) => x.id), "weave grid", issues);
  checkUnique(weaveThreadsOf(b).map((x) => x.id), "weave thread", issues);
  checkUnique(weaveBeatsOf(b).map((x) => x.id), "weave beat", issues);
  checkUnique(weaveBeatWorldRefsOf(b).map((x) => x.id), "weave beat world ref", issues);
  checkUnique(weaveBeatWorldRefsOf(b).map((x) => `${x.beatId}/${x.recordId}`), "weave beat world ref pair", issues);
  checkUnique(weaveSetupPayoffsOf(b).map((x) => x.id), "weave setup/payoff", issues);
  checkUnique(weaveSetupPayoffsOf(b).map((x) => `${x.fromBeatId}/${x.toBeatId}`), "weave setup/payoff pair", issues);
  checkUnique(weaveTemplatesOf(b).map((x) => x.id), "weave template", issues);
  checkUnique(weaveTemplateBeatsOf(b).map((x) => x.id), "weave template beat", issues);
  checkUnique(establishedFactsOf(b).map((x) => x.id), "established fact", issues);
  checkUnique(factEvidenceOf(b).map((x) => x.id), "fact evidence", issues);
  checkUnique(assistantConversationsOf(b).map((x) => x.id), "assistant conversation", issues);
  checkUnique(assistantMessagesOf(b).map((x) => x.id), "assistant message", issues);
  checkUnique(assistantContextItemsOf(b).map((x) => x.id), "assistant context item", issues);
  checkUnique(assistantProposalsOf(b).map((x) => x.id), "assistant proposal", issues);
  checkUnique(assistantProposalsOf(b).map((x) => x.messageId), "assistant proposal message", issues);
  checkUnique(projectAssistantSettingsOf(b).map((x) => x.id), "project assistant settings", issues);
  checkUnique(projectAssistantSettingsOf(b).map((x) => x.projectId), "project assistant settings project", issues);

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
  const mapIds = new Set(worldMapsOf(b).map((x) => x.id));
  const mapProject = new Map(worldMapsOf(b).map((x) => [x.id, x.projectId]));
  worldMapsOf(b).forEach((m) => {
    needProject(m.projectId, `World map ${m.id}`);
    if (!imageIds.has(m.imageId) || imageProject.get(m.imageId) !== m.projectId) {
      issues.push(integrity(`World map ${m.id} references missing image ${m.imageId}.`));
    }
  });
  worldMapPinsOf(b).forEach((p) => {
    needProject(p.projectId, `World map pin ${p.id}`);
    if (!mapIds.has(p.mapId) || mapProject.get(p.mapId) !== p.projectId) {
      issues.push(integrity(`World map pin ${p.id} references missing map ${p.mapId}.`));
    }
    if (!recordIds.has(p.recordId) || recordProject.get(p.recordId) !== p.projectId) {
      issues.push(integrity(`World map pin ${p.id} references missing record ${p.recordId}.`));
    }
    const type = recordType.get(p.recordId);
    if (type && !isLinkableReferenceType(type)) {
      issues.push(integrity(`World map pin ${p.id} must point to a reference record.`));
    }
  });
  placeRelationsOf(b).forEach((r) => {
    needProject(r.projectId, `Place relation ${r.id}`);
    for (const end of [r.fromRecordId, r.toRecordId]) {
      if (!recordIds.has(end) || recordProject.get(end) !== r.projectId) {
        issues.push(integrity(`Place relation ${r.id} references missing record ${end}.`));
      }
    }
    if (r.fromRecordId === r.toRecordId) {
      issues.push(integrity(`Place relation ${r.id} cannot relate a place to itself.`));
    }
    for (const end of [r.fromRecordId, r.toRecordId]) {
      const type = recordType.get(end);
      if (type && !isLinkableReferenceType(type)) {
        issues.push(integrity(`Place relation ${r.id} must be between reference records.`));
      }
    }
  });
  const weaveGridIds = new Set(weaveGridsOf(b).map((x) => x.id));
  const weaveGridProject = new Map(weaveGridsOf(b).map((x) => [x.id, x.projectId]));
  weaveGridsOf(b).forEach((g) => needProject(g.projectId, `Weave grid ${g.id}`));
  const weaveThreadIds = new Set(weaveThreadsOf(b).map((x) => x.id));
  const weaveThreadProject = new Map(weaveThreadsOf(b).map((x) => [x.id, x.projectId]));
  const weaveThreadGrid = new Map(weaveThreadsOf(b).map((x) => [x.id, x.gridId]));
  weaveThreadsOf(b).forEach((thread) => {
    needProject(thread.projectId, `Weave thread ${thread.id}`);
    if (!weaveGridIds.has(thread.gridId) || weaveGridProject.get(thread.gridId) !== thread.projectId) {
      issues.push(integrity(`Weave thread ${thread.id} references missing grid ${thread.gridId}.`));
    }
  });
  const weaveBeatIds = new Set(weaveBeatsOf(b).map((x) => x.id));
  const weaveBeatProject = new Map(weaveBeatsOf(b).map((x) => [x.id, x.projectId]));
  weaveBeatsOf(b).forEach((beat) => {
    needProject(beat.projectId, `Weave beat ${beat.id}`);
    if (beat.threadId) {
      if (
        !weaveThreadIds.has(beat.threadId) ||
        weaveThreadProject.get(beat.threadId) !== beat.projectId ||
        weaveThreadGrid.get(beat.threadId) !== beat.gridId
      ) {
        issues.push(integrity(`Weave beat ${beat.id} references missing thread ${beat.threadId}.`));
      }
    }
    if (!weaveGridIds.has(beat.gridId) || weaveGridProject.get(beat.gridId) !== beat.projectId) {
      issues.push(integrity(`Weave beat ${beat.id} references missing grid ${beat.gridId}.`));
    }
    if (beat.manuscriptRecordId) {
      if (!recordIds.has(beat.manuscriptRecordId) || recordProject.get(beat.manuscriptRecordId) !== beat.projectId) {
        issues.push(integrity(`Weave beat ${beat.id} references missing manuscript ${beat.manuscriptRecordId}.`));
      } else {
        const type = recordType.get(beat.manuscriptRecordId);
        if (type && (!isManuscriptType(type) || type === "scene_note")) {
          issues.push(integrity(`Weave beat ${beat.id} must link to a chapter or scene.`));
        }
      }
    }
  });
  weaveBeatWorldRefsOf(b).forEach((ref) => {
    needProject(ref.projectId, `Weave beat world ref ${ref.id}`);
    if (!weaveBeatIds.has(ref.beatId) || weaveBeatProject.get(ref.beatId) !== ref.projectId) {
      issues.push(integrity(`Weave beat world ref ${ref.id} references missing beat ${ref.beatId}.`));
    }
    if (!recordIds.has(ref.recordId) || recordProject.get(ref.recordId) !== ref.projectId) {
      issues.push(integrity(`Weave beat world ref ${ref.id} references missing record ${ref.recordId}.`));
    } else {
      const type = recordType.get(ref.recordId);
      if (type && !isLinkableReferenceType(type)) {
        issues.push(integrity(`Weave beat world ref ${ref.id} must cite a reference record.`));
      }
    }
  });
  weaveSetupPayoffsOf(b).forEach((link) => {
    if (link.workspaceId !== b.workspace.id) {
      issues.push(integrity(`Weave setup/payoff ${link.id} belongs to another workspace.`));
    }
    if (!weaveBeatIds.has(link.fromBeatId)) {
      issues.push(integrity(`Weave setup/payoff ${link.id} references missing setup beat ${link.fromBeatId}.`));
    }
    if (!weaveBeatIds.has(link.toBeatId)) {
      issues.push(integrity(`Weave setup/payoff ${link.id} references missing payoff beat ${link.toBeatId}.`));
    }
    if (link.fromBeatId === link.toBeatId) {
      issues.push(integrity(`Weave setup/payoff ${link.id} cannot link a beat to itself.`));
    }
  });
  const weaveTemplateIds = new Set(weaveTemplatesOf(b).map((x) => x.id));
  weaveTemplatesOf(b).forEach((t) => needProject(t.projectId, `Weave template ${t.id}`));
  weaveTemplateBeatsOf(b).forEach((beat) => {
    if (!weaveTemplateIds.has(beat.templateId)) {
      issues.push(integrity(`Weave template beat ${beat.id} references missing template ${beat.templateId}.`));
    }
  });
  const establishedFactIds = new Set(establishedFactsOf(b).map((x) => x.id));
  establishedFactsOf(b).forEach((f) => {
    needProject(f.projectId, `Established fact ${f.id}`);
    if (!recordIds.has(f.subjectRecordId) || recordProject.get(f.subjectRecordId) !== f.projectId) {
      issues.push(integrity(`Established fact ${f.id} references missing subject ${f.subjectRecordId}.`));
    }
  });
  factEvidenceOf(b).forEach((e) => {
    needProject(e.projectId, `Fact evidence ${e.id}`);
    if (!establishedFactIds.has(e.factId)) {
      issues.push(integrity(`Fact evidence ${e.id} references missing fact ${e.factId}.`));
    }
    if (!recordIds.has(e.sourceRecordId) || recordProject.get(e.sourceRecordId) !== e.projectId) {
      issues.push(integrity(`Fact evidence ${e.id} references missing source ${e.sourceRecordId}.`));
    }
    if (e.passageEnd < e.passageStart) {
      issues.push(integrity(`Fact evidence ${e.id} has an empty or inverted passage range.`));
    }
  });
  const assistantConversationIds = new Set(assistantConversationsOf(b).map((x) => x.id));
  const assistantMessageIds = new Set(assistantMessagesOf(b).map((x) => x.id));
  assistantConversationsOf(b).forEach((c) => {
    needProject(c.projectId, `Assistant conversation ${c.id}`);
    if (c.workspaceId !== b.workspace.id) {
      issues.push(integrity(`Assistant conversation ${c.id} belongs to a different workspace.`));
    }
  });
  assistantMessagesOf(b).forEach((m) => {
    if (!assistantConversationIds.has(m.conversationId)) {
      issues.push(integrity(`Assistant message ${m.id} references missing conversation ${m.conversationId}.`));
    }
    if (m.replyToId && !assistantMessageIds.has(m.replyToId)) {
      issues.push(integrity(`Assistant message ${m.id} references missing reply ${m.replyToId}.`));
    }
    for (const mid of m.includedMessageIds) {
      if (!assistantMessageIds.has(mid)) {
        issues.push(integrity(`Assistant message ${m.id} includes missing message ${mid}.`));
      }
    }
  });
  assistantContextItemsOf(b).forEach((c) => {
    if (!assistantMessageIds.has(c.messageId)) {
      issues.push(integrity(`Assistant context item ${c.id} references missing message ${c.messageId}.`));
    }
    if (!recordIds.has(c.recordId)) {
      issues.push(integrity(`Assistant context item ${c.id} references missing record ${c.recordId}.`));
    }
  });
  assistantProposalsOf(b).forEach((p) => {
    needProject(p.projectId, `Assistant proposal ${p.id}`);
    if (!assistantMessageIds.has(p.messageId)) {
      issues.push(integrity(`Assistant proposal ${p.id} references missing message ${p.messageId}.`));
    }
    if (p.workspaceId !== b.workspace.id) {
      issues.push(integrity(`Assistant proposal ${p.id} belongs to a different workspace.`));
    }
  });
  projectAssistantSettingsOf(b).forEach((s) => needProject(s.projectId, `Assistant settings ${s.id}`));
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
  if (worldMapsOf(b).length) {
    await check("world map", db.worldMap.count({ where: { id: { in: worldMapsOf(b).map((x) => x.id) } } }));
  }
  if (worldMapPinsOf(b).length) {
    await check("world map pin", db.worldMapPin.count({ where: { id: { in: worldMapPinsOf(b).map((p) => p.id) } } }));
  }
  if (placeRelationsOf(b).length) {
    await check("place relation", db.placeRelation.count({ where: { id: { in: placeRelationsOf(b).map((r) => r.id) } } }));
  }
  if (weaveGridsOf(b).length) {
    await check("weave grid", db.weaveGrid.count({ where: { id: { in: weaveGridsOf(b).map((x) => x.id) } } }));
  }
  if (weaveThreadsOf(b).length) {
    await check("weave thread", db.weaveThread.count({ where: { id: { in: weaveThreadsOf(b).map((x) => x.id) } } }));
  }
  if (weaveBeatsOf(b).length) {
    await check("weave beat", db.weaveBeat.count({ where: { id: { in: weaveBeatsOf(b).map((x) => x.id) } } }));
  }
  if (weaveBeatWorldRefsOf(b).length) {
    await check(
      "weave beat world ref",
      db.weaveBeatWorldRef.count({ where: { id: { in: weaveBeatWorldRefsOf(b).map((x) => x.id) } } }),
    );
  }
  if (weaveSetupPayoffsOf(b).length) {
    await check(
      "weave setup/payoff",
      db.weaveSetupPayoff.count({ where: { id: { in: weaveSetupPayoffsOf(b).map((x) => x.id) } } }),
    );
  }
  if (weaveTemplatesOf(b).length) {
    await check("weave template", db.weaveTemplate.count({ where: { id: { in: weaveTemplatesOf(b).map((x) => x.id) } } }));
  }
  if (weaveTemplateBeatsOf(b).length) {
    await check(
      "weave template beat",
      db.weaveTemplateBeat.count({ where: { id: { in: weaveTemplateBeatsOf(b).map((x) => x.id) } } }),
    );
  }
  if (establishedFactsOf(b).length) {
    await check(
      "established fact",
      db.establishedFact.count({ where: { id: { in: establishedFactsOf(b).map((x) => x.id) } } }),
    );
  }
  if (factEvidenceOf(b).length) {
    await check("fact evidence", db.factEvidence.count({ where: { id: { in: factEvidenceOf(b).map((x) => x.id) } } }));
  }
  if (assistantConversationsOf(b).length) {
    await check(
      "assistant conversation",
      db.assistantConversation.count({ where: { id: { in: assistantConversationsOf(b).map((x) => x.id) } } }),
    );
  }
  if (assistantMessagesOf(b).length) {
    await check(
      "assistant message",
      db.assistantMessage.count({ where: { id: { in: assistantMessagesOf(b).map((x) => x.id) } } }),
    );
  }
  if (assistantContextItemsOf(b).length) {
    await check(
      "assistant context item",
      db.assistantContextItem.count({ where: { id: { in: assistantContextItemsOf(b).map((x) => x.id) } } }),
    );
  }
  if (assistantProposalsOf(b).length) {
    await check(
      "assistant proposal",
      db.assistantProposal.count({ where: { id: { in: assistantProposalsOf(b).map((x) => x.id) } } }),
    );
  }
  if (projectAssistantSettingsOf(b).length) {
    await check(
      "project assistant settings",
      db.projectAssistantSettings.count({ where: { id: { in: projectAssistantSettingsOf(b).map((x) => x.id) } } }),
    );
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
  worldMapsOf(b).forEach((x) => assign(x.id, "wmp"));
  worldMapPinsOf(b).forEach((p) => assign(p.id, "wpn"));
  placeRelationsOf(b).forEach((r) => assign(r.id, "plr"));
  weaveGridsOf(b).forEach((x) => assign(x.id, "wvg"));
  weaveThreadsOf(b).forEach((x) => assign(x.id, "wth"));
  weaveBeatsOf(b).forEach((x) => assign(x.id, "wvb"));
  weaveBeatWorldRefsOf(b).forEach((x) => assign(x.id, "wvr"));
  weaveSetupPayoffsOf(b).forEach((x) => assign(x.id, "wvs"));
  weaveTemplatesOf(b).forEach((x) => assign(x.id, "wvt"));
  weaveTemplateBeatsOf(b).forEach((x) => assign(x.id, "wvx"));
  establishedFactsOf(b).forEach((x) => assign(x.id, "fct"));
  factEvidenceOf(b).forEach((x) => assign(x.id, "fev"));
  assistantConversationsOf(b).forEach((x) => assign(x.id, "asc"));
  assistantMessagesOf(b).forEach((x) => assign(x.id, "asm"));
  assistantContextItemsOf(b).forEach((x) => assign(x.id, "aci"));
  assistantProposalsOf(b).forEach((x) => assign(x.id, "apr"));
  projectAssistantSettingsOf(b).forEach((x) => assign(x.id, "pas"));

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
        const maps = worldMapsOf(b);
        if (maps.length) {
          await tx.worldMap.createMany({
            data: maps.map((map) => ({
              id: m(map.id),
              projectId: m(map.projectId),
              title: map.title,
              imageId: m(map.imageId),
              createdAt: new Date(map.createdAt),
              updatedAt: new Date(map.updatedAt),
            })),
          });
        }
        const mapPins = worldMapPinsOf(b);
        if (mapPins.length) {
          await tx.worldMapPin.createMany({
            data: mapPins.map((p) => ({
              id: m(p.id),
              mapId: m(p.mapId),
              projectId: m(p.projectId),
              recordId: m(p.recordId),
              xNorm: p.xNorm,
              yNorm: p.yNorm,
              createdAt: new Date(p.createdAt),
            })),
          });
        }
        const placeRels = placeRelationsOf(b);
        if (placeRels.length) {
          await tx.placeRelation.createMany({
            data: placeRels.map((r) => ({
              id: m(r.id),
              projectId: m(r.projectId),
              fromRecordId: m(r.fromRecordId),
              toRecordId: m(r.toRecordId),
              kind: r.kind,
              createdAt: new Date(r.createdAt),
            })),
          });
        }
        const templates = weaveTemplatesOf(b);
        if (templates.length) {
          await tx.weaveTemplate.createMany({
            data: templates.map((t) => ({
              id: m(t.id),
              projectId: m(t.projectId),
              title: t.title,
              description: t.description,
              createdAt: new Date(t.createdAt),
              updatedAt: new Date(t.updatedAt),
            })),
          });
        }
        const templateBeats = weaveTemplateBeatsOf(b);
        if (templateBeats.length) {
          await tx.weaveTemplateBeat.createMany({
            data: templateBeats.map((beat) => ({
              id: m(beat.id),
              templateId: m(beat.templateId),
              title: beat.title,
              body: beat.body,
              decision: beat.decision,
              x: beat.x,
              y: beat.y,
              width: beat.width,
              height: beat.height,
              zIndex: beat.zIndex,
              position: beat.position,
            })),
          });
        }
        const grids = weaveGridsOf(b);
        if (grids.length) {
          await tx.weaveGrid.createMany({
            data: grids.map((g) => ({
              id: m(g.id),
              projectId: m(g.projectId),
              title: g.title,
              viewKind: g.viewKind,
              layoutMode: g.layoutMode === "plot_grid" ? "plot_grid" : "freeform",
              sourceTemplateId: g.sourceTemplateId ? m(g.sourceTemplateId) : null,
              createdAt: new Date(g.createdAt),
              updatedAt: new Date(g.updatedAt),
            })),
          });
        }
        const threads = weaveThreadsOf(b);
        if (threads.length) {
          await tx.weaveThread.createMany({
            data: threads.map((thread) => ({
              id: m(thread.id),
              gridId: m(thread.gridId),
              projectId: m(thread.projectId),
              title: thread.title,
              position: thread.position,
              createdAt: new Date(thread.createdAt),
            })),
          });
        }
        const weaveBeats = weaveBeatsOf(b);
        if (weaveBeats.length) {
          await tx.weaveBeat.createMany({
            data: weaveBeats.map((beat) => ({
              id: m(beat.id),
              gridId: m(beat.gridId),
              projectId: m(beat.projectId),
              title: beat.title,
              body: beat.body,
              decision: beat.decision,
              manuscriptRecordId: beat.manuscriptRecordId ? m(beat.manuscriptRecordId) : null,
              threadId: beat.threadId ? m(beat.threadId) : null,
              cellOrder: beat.cellOrder ?? 0,
              x: beat.x,
              y: beat.y,
              width: beat.width,
              height: beat.height,
              zIndex: beat.zIndex,
              createdAt: new Date(beat.createdAt),
            })),
          });
        }
        const worldRefs = weaveBeatWorldRefsOf(b);
        if (worldRefs.length) {
          await tx.weaveBeatWorldRef.createMany({
            data: worldRefs.map((ref) => ({
              id: m(ref.id),
              beatId: m(ref.beatId),
              projectId: m(ref.projectId),
              recordId: m(ref.recordId),
              createdAt: new Date(ref.createdAt),
            })),
          });
        }
        const setupPayoffs = weaveSetupPayoffsOf(b);
        if (setupPayoffs.length) {
          await tx.weaveSetupPayoff.createMany({
            data: setupPayoffs.map((link) => ({
              id: m(link.id),
              workspaceId,
              fromBeatId: m(link.fromBeatId),
              toBeatId: m(link.toBeatId),
              note: link.note,
              createdAt: new Date(link.createdAt),
            })),
          });
        }
        const facts = establishedFactsOf(b);
        if (facts.length) {
          await tx.establishedFact.createMany({
            data: facts.map((f) => ({
              id: m(f.id),
              projectId: m(f.projectId),
              subjectRecordId: m(f.subjectRecordId),
              statement: f.statement,
              status: f.status,
              evidenceKind: f.evidenceKind,
              createdAt: new Date(f.createdAt),
              updatedAt: new Date(f.updatedAt),
            })),
          });
        }
        const evidence = factEvidenceOf(b);
        if (evidence.length) {
          await tx.factEvidence.createMany({
            data: evidence.map((e) => ({
              id: m(e.id),
              factId: m(e.factId),
              projectId: m(e.projectId),
              sourceRecordId: m(e.sourceRecordId),
              revisionNumber: e.revisionNumber,
              passageStart: e.passageStart,
              passageEnd: e.passageEnd,
              passageExcerpt: e.passageExcerpt,
              contentHash: e.contentHash,
              evidenceKind: e.evidenceKind,
              needsRecheck: e.needsRecheck,
              createdAt: new Date(e.createdAt),
            })),
          });
        }
        const conversations = assistantConversationsOf(b);
        if (conversations.length) {
          await tx.assistantConversation.createMany({
            data: conversations.map((c) => ({
              id: m(c.id),
              workspaceId,
              projectId: m(c.projectId),
              title: c.title,
              summary: c.summary ?? "",
              createdAt: new Date(c.createdAt),
              updatedAt: new Date(c.updatedAt),
            })),
          });
        }
        const messages = assistantMessagesOf(b);
        if (messages.length) {
          await tx.assistantMessage.createMany({
            data: messages.map((msg) => ({
              id: m(msg.id),
              conversationId: m(msg.conversationId),
              role: msg.role,
              mode: msg.mode,
              content: msg.content,
              replyToId: msg.replyToId ? m(msg.replyToId) : null,
              status: msg.status,
              errorCode: msg.errorCode ?? null,
              errorMessage: msg.errorMessage ?? null,
              model: msg.model ?? null,
              providerResponseId: msg.providerResponseId ?? null,
              inputTokens: msg.inputTokens ?? null,
              outputTokens: msg.outputTokens ?? null,
              totalTokens: msg.totalTokens ?? null,
              usageEstimated: msg.usageEstimated,
              includedMessageIds: JSON.stringify(msg.includedMessageIds.map((id) => m(id))),
              requestChars: msg.requestChars ?? null,
              createdAt: new Date(msg.createdAt),
              completedAt: msg.completedAt ? new Date(msg.completedAt) : null,
            })),
          });
        }
        const contextItems = assistantContextItemsOf(b);
        if (contextItems.length) {
          await tx.assistantContextItem.createMany({
            data: contextItems.map((c) => ({
              id: m(c.id),
              messageId: m(c.messageId),
              recordId: m(c.recordId),
              revisionNumber: c.revisionNumber,
              kind: c.kind,
              passageStart: c.passageStart ?? null,
              passageEnd: c.passageEnd ?? null,
              charCount: c.charCount,
              contentHash: c.contentHash,
            })),
          });
        }
        const proposals = assistantProposalsOf(b);
        if (proposals.length) {
          await tx.assistantProposal.createMany({
            data: proposals.map((p) => ({
              id: m(p.id),
              messageId: m(p.messageId),
              workspaceId,
              projectId: m(p.projectId),
              packageId: p.packageId,
              packageJson: rewriteJson(p.packageJson),
              contentHash: p.contentHash,
              operationCount: p.operationCount,
              status: p.status,
              createdAt: new Date(p.createdAt),
              appliedAt: p.appliedAt ? new Date(p.appliedAt) : null,
            })),
          });
        }
        const settings = projectAssistantSettingsOf(b);
        if (settings.length) {
          await tx.projectAssistantSettings.createMany({
            data: settings.map((s) => ({
              id: m(s.id),
              projectId: m(s.projectId),
              autoIncludeRecent: s.autoIncludeRecent,
              recentContextBudgetChars: s.recentContextBudgetChars,
              updatedAt: new Date(s.updatedAt),
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
