import { newId } from "@/domain/ids";
import { errorIssue } from "@/domain/issues";
import {
  isSmartCollectionScope,
  parseSmartCollectionFilter,
  type SmartCollectionFilter,
  type SmartCollectionScope,
} from "@/domain/smartCollection";
import type { Db, DbOrTx } from "@/server/db";
import { writeAudit } from "./auditService";
import { MutationRejectedError, NotFoundError } from "./errors";
import { LIVE_PROJECT } from "./trashFilters";

const UI_ACTOR = "author";
const TITLE_MAX = 120;

export interface SmartCollectionView {
  id: string;
  projectId: string;
  title: string;
  scope: SmartCollectionScope;
  filter: SmartCollectionFilter;
  filterJson: string;
  position: number;
  updatedAt: Date;
}

function rejected(message: string): MutationRejectedError {
  return new MutationRejectedError([errorIssue("INVALID_CHANGE", message)]);
}

function toView(row: {
  id: string;
  projectId: string;
  title: string;
  scope: string;
  filterJson: string;
  position: number;
  updatedAt: Date;
}): SmartCollectionView {
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(row.filterJson) as unknown;
  } catch {
    parsed = {};
  }
  const scope: SmartCollectionScope = isSmartCollectionScope(row.scope) ? row.scope : "manuscript";
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    scope,
    filter: parseSmartCollectionFilter(parsed),
    filterJson: row.filterJson,
    position: row.position,
    updatedAt: row.updatedAt,
  };
}

async function requireProject(db: DbOrTx, projectId: string) {
  const project = await db.project.findFirst({ where: { id: projectId, ...LIVE_PROJECT }, select: { id: true } });
  if (!project) throw new NotFoundError(`Project ${projectId} not found`);
}

export async function listSmartCollections(
  db: DbOrTx,
  projectId: string,
  scope?: SmartCollectionScope,
): Promise<SmartCollectionView[]> {
  await requireProject(db, projectId);
  const rows = await db.smartCollection.findMany({
    where: { projectId, ...(scope ? { scope } : {}) },
    orderBy: [{ position: "asc" }, { title: "asc" }, { id: "asc" }],
  });
  return rows.map(toView);
}

export async function getSmartCollection(
  db: DbOrTx,
  projectId: string,
  collectionId: string,
): Promise<SmartCollectionView> {
  await requireProject(db, projectId);
  const row = await db.smartCollection.findFirst({ where: { id: collectionId, projectId } });
  if (!row) throw new NotFoundError(`Smart collection ${collectionId} not found`);
  return toView(row);
}

export async function createSmartCollection(
  db: Db,
  projectId: string,
  input: { title: string; scope: SmartCollectionScope; filter: SmartCollectionFilter },
): Promise<SmartCollectionView> {
  await requireProject(db, projectId);
  if (!isSmartCollectionScope(input.scope)) throw rejected("Choose manuscript or world for this collection.");
  const title = input.title.trim().slice(0, TITLE_MAX);
  if (title.length < 1) throw rejected("Give the collection a name.");
  const filterJson = JSON.stringify(input.filter ?? {});
  const max = await db.smartCollection.aggregate({
    where: { projectId, scope: input.scope },
    _max: { position: true },
  });
  const position = (max._max.position ?? -1) + 1;
  const id = newId("scol");
  const row = await db.$transaction(async (tx) => {
    const created = await tx.smartCollection.create({
      data: { id, projectId, title, scope: input.scope, filterJson, position },
    });
    await writeAudit(tx, {
      projectId,
      actor: UI_ACTOR,
      action: "smart_collection.create",
      summary: `Created smart collection "${title}"`,
      details: { collectionId: id, scope: input.scope, filterJson },
    });
    return created;
  });
  return toView(row);
}

export async function updateSmartCollection(
  db: Db,
  projectId: string,
  collectionId: string,
  input: { title?: string; filter?: SmartCollectionFilter },
): Promise<SmartCollectionView> {
  await requireProject(db, projectId);
  const existing = await db.smartCollection.findFirst({ where: { id: collectionId, projectId } });
  if (!existing) throw new NotFoundError(`Smart collection ${collectionId} not found`);
  const title = input.title !== undefined ? input.title.trim().slice(0, TITLE_MAX) : existing.title;
  if (title.length < 1) throw rejected("Give the collection a name.");
  const filterJson = input.filter !== undefined ? JSON.stringify(input.filter) : existing.filterJson;
  const row = await db.$transaction(async (tx) => {
    const updated = await tx.smartCollection.update({
      where: { id: collectionId },
      data: { title, filterJson },
    });
    await writeAudit(tx, {
      projectId,
      actor: UI_ACTOR,
      action: "smart_collection.update",
      summary: `Updated smart collection "${title}"`,
      details: { collectionId, filterJson },
    });
    return updated;
  });
  return toView(row);
}

export async function deleteSmartCollection(db: Db, projectId: string, collectionId: string): Promise<void> {
  await requireProject(db, projectId);
  const existing = await db.smartCollection.findFirst({ where: { id: collectionId, projectId } });
  if (!existing) throw new NotFoundError(`Smart collection ${collectionId} not found`);
  await db.$transaction(async (tx) => {
    await tx.smartCollection.delete({ where: { id: collectionId } });
    await writeAudit(tx, {
      projectId,
      actor: UI_ACTOR,
      action: "smart_collection.delete",
      summary: `Deleted smart collection "${existing.title}"`,
      details: { collectionId, scope: existing.scope },
    });
  });
}
