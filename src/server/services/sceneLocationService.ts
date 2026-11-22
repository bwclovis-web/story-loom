import { compareBookOrder } from "@/domain/bookOrder";
import { newId } from "@/domain/ids";
import { errorIssue } from "@/domain/issues";
import {
  isLinkableReferenceType,
  isManuscriptType,
  isRecordType,
  RECORD_TYPE_LABELS,
  type RecordType,
} from "@/domain/recordTypes";
import { isUniqueConstraintError, type Db, type DbOrTx, type Tx } from "../db";
import { writeAudit } from "./auditService";
import { MutationRejectedError } from "./errors";

/*
 * Explicit locations for a chapter or scene. The author assigns them.
 * A mention in the text, a linked reference, a place relationship, and an
 * established fact or planned event are different records and are never
 * created or changed here. No story date is stored. Listing uses manuscript
 * order (chapters, then each chapter's scenes).
 */

const UI_ACTOR = "author";

export interface SceneLocationView {
  id: string;
  revision: number;
  locationRecordId: string;
  title: string;
  type: RecordType;
  isPrimary: boolean;
  unavailable: boolean;
}

export interface SceneLocationSet {
  /** Ids, revisions, and primary flags the client last read. A mismatch refuses the write. */
  fingerprint: string;
  locations: SceneLocationView[];
}

export interface SceneAtLocation {
  recordId: string;
  title: string;
  type: "manuscript_chapter" | "manuscript_scene";
  isPrimary: boolean;
  draftId: string | null;
  draftLabel: string | null;
  chapterTitle: string | null;
}

export interface SceneLocationCatalog {
  scenes: SceneAtLocation[];
  drafts: Array<{ id: string; label: string }>;
  books: Array<{ id: string; label: string }>;
}

export interface SceneListFilter {
  /** "all", "unscoped", or a manuscript draft id. */
  draft: string;
  /** "all", "ungrouped", or a manuscript group id. */
  book: string;
}

interface AssignmentRow {
  id: string;
  revision: number;
  isPrimary: boolean;
  locationRecordId: string;
  location: { id: string; title: string; type: string; trashedAt: Date | null };
}

interface ManuscriptRow {
  id: string;
  type: string;
  title: string;
  parentRecordId: string | null;
  position: number | null;
  createdAt: Date;
  draftId: string | null;
  groupId: string | null;
}

function rejected(message: string, recordId?: string): MutationRejectedError {
  return new MutationRejectedError([errorIssue("INVALID_REFERENCE", message, recordId ? { recordId } : {})]);
}

function stale(): MutationRejectedError {
  return new MutationRejectedError([
    errorIssue(
      "STALE_REVISION",
      "These scene locations were saved again after you started. The change was not applied.",
    ),
  ]);
}

export function sceneLocationFingerprint(rows: Array<{ id: string; revision: number; isPrimary: boolean }>): string {
  return [...rows]
    .map((row) => `${row.id}:${row.revision}:${row.isPrimary ? 1 : 0}`)
    .sort()
    .join("|");
}

function toSet(rows: AssignmentRow[]): SceneLocationSet {
  const locations = rows.flatMap((row) => {
    if (!isRecordType(row.location.type)) return [];
    return [
      {
        id: row.id,
        revision: row.revision,
        locationRecordId: row.locationRecordId,
        title: row.location.title,
        type: row.location.type,
        isPrimary: row.isPrimary,
        unavailable: row.location.trashedAt != null,
      },
    ];
  });
  return { fingerprint: sceneLocationFingerprint(rows), locations };
}

async function rowsForManuscript(db: DbOrTx, projectId: string, manuscriptRecordId: string): Promise<AssignmentRow[]> {
  return db.sceneLocation.findMany({
    where: { projectId, manuscriptRecordId },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }, { id: "asc" }],
    include: { location: { select: { id: true, title: true, type: true, trashedAt: true } } },
  });
}

export async function listSceneLocationsForManuscript(
  db: DbOrTx,
  projectId: string,
  manuscriptRecordId: string,
): Promise<SceneLocationSet> {
  return toSet(await rowsForManuscript(db, projectId, manuscriptRecordId));
}

function byBook(a: ManuscriptRow, b: ManuscriptRow): number {
  return compareBookOrder(
    { id: a.id, position: a.position, createdAt: a.createdAt.toISOString() },
    { id: b.id, position: b.position, createdAt: b.createdAt.toISOString() },
  );
}

/** Chapters in book order, each followed by its scenes. Scenes whose chapter is absent follow. */
export function nestManuscript(rows: readonly ManuscriptRow[]): ManuscriptRow[] {
  const chapters = rows.filter((row) => row.type === "manuscript_chapter").sort(byBook);
  const chapterIds = new Set(chapters.map((chapter) => chapter.id));
  const byParent = new Map<string, ManuscriptRow[]>();
  const orphans: ManuscriptRow[] = [];
  for (const scene of rows) {
    if (scene.type !== "manuscript_scene") continue;
    if (scene.parentRecordId && chapterIds.has(scene.parentRecordId)) {
      const list = byParent.get(scene.parentRecordId) ?? [];
      list.push(scene);
      byParent.set(scene.parentRecordId, list);
    } else {
      orphans.push(scene);
    }
  }
  const ordered: ManuscriptRow[] = [];
  for (const chapter of chapters) {
    ordered.push(chapter, ...(byParent.get(chapter.id) ?? []).sort(byBook));
  }
  ordered.push(...orphans.sort(byBook));
  return ordered;
}

function groupOf(row: ManuscriptRow, byId: Map<string, ManuscriptRow>): string | null {
  if (row.groupId) return row.groupId;
  if (row.parentRecordId) return byId.get(row.parentRecordId)?.groupId ?? null;
  return null;
}

function inDraft(row: ManuscriptRow, draft: string): boolean {
  if (draft === "all") return true;
  if (draft === "unscoped") return row.draftId == null;
  return row.draftId === draft;
}

function inBook(row: ManuscriptRow, book: string, byId: Map<string, ManuscriptRow>): boolean {
  if (book === "all") return true;
  const groupId = groupOf(row, byId);
  if (book === "ungrouped") return groupId == null;
  return groupId === book;
}

export async function listScenesForLocation(
  db: DbOrTx,
  projectId: string,
  locationRecordId: string,
  filter: SceneListFilter = { draft: "all", book: "all" },
): Promise<SceneLocationCatalog> {
  const [assignments, manuscripts, drafts, groups] = await Promise.all([
    db.sceneLocation.findMany({
      where: { projectId, locationRecordId },
      select: { manuscriptRecordId: true, isPrimary: true },
    }),
    db.record.findMany({
      where: { projectId, trashedAt: null, type: { in: ["manuscript_chapter", "manuscript_scene"] } },
      select: {
        id: true,
        type: true,
        title: true,
        parentRecordId: true,
        position: true,
        createdAt: true,
        draftId: true,
        groupId: true,
      },
    }),
    db.manuscriptDraft.findMany({
      where: { projectId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, label: true, createdAt: true },
    }),
    db.manuscriptGroup.findMany({
      where: { projectId },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { id: true, label: true },
    }),
  ]);
  const assigned = new Map(assignments.map((row) => [row.manuscriptRecordId, row.isPrimary]));
  const live = manuscripts.filter((row) => isManuscriptType(row.type));
  const byId = new Map(live.map((row) => [row.id, row]));
  const draftOrder = drafts.map((draft) => draft.id);
  const buckets = new Map<string, ManuscriptRow[]>([["unscoped", []]]);
  for (const id of draftOrder) buckets.set(id, []);
  for (const row of live) {
    if (!inDraft(row, filter.draft) || !inBook(row, filter.book, byId)) continue;
    const key = row.draftId && buckets.has(row.draftId) ? row.draftId : "unscoped";
    buckets.get(key)!.push(row);
  }
  const draftLabel = new Map(drafts.map((draft) => [draft.id, draft.label]));
  const keys = ["unscoped", ...draftOrder];
  const scenes: SceneAtLocation[] = [];
  for (const key of keys) {
    for (const row of nestManuscript(buckets.get(key) ?? [])) {
      if (!assigned.has(row.id)) continue;
      if (row.type !== "manuscript_chapter" && row.type !== "manuscript_scene") continue;
      const parent = row.parentRecordId ? byId.get(row.parentRecordId) : undefined;
      scenes.push({
        recordId: row.id,
        title: row.title,
        type: row.type,
        isPrimary: assigned.get(row.id) === true,
        draftId: row.draftId,
        draftLabel: row.draftId ? (draftLabel.get(row.draftId) ?? null) : null,
        chapterTitle: row.type === "manuscript_scene" ? (parent?.title ?? null) : null,
      });
    }
  }
  return {
    scenes,
    drafts: drafts.map((draft) => ({ id: draft.id, label: draft.label })),
    books: groups.map((group) => ({ id: group.id, label: group.label })),
  };
}

export interface LinkableManuscript {
  id: string;
  title: string;
  type: "manuscript_chapter" | "manuscript_scene";
  chapterTitle: string | null;
}

/** Chapters and scenes not already assigned to this reference, in manuscript order. */
export async function listUnassignedManuscripts(
  db: DbOrTx,
  projectId: string,
  locationRecordId: string,
): Promise<LinkableManuscript[]> {
  const [assignments, manuscripts] = await Promise.all([
    db.sceneLocation.findMany({
      where: { projectId, locationRecordId },
      select: { manuscriptRecordId: true },
    }),
    db.record.findMany({
      where: { projectId, trashedAt: null, type: { in: ["manuscript_chapter", "manuscript_scene"] } },
      select: {
        id: true,
        type: true,
        title: true,
        parentRecordId: true,
        position: true,
        createdAt: true,
        draftId: true,
        groupId: true,
      },
    }),
  ]);
  const assigned = new Set(assignments.map((row) => row.manuscriptRecordId));
  const live = manuscripts.filter((row) => isManuscriptType(row.type));
  const byId = new Map(live.map((row) => [row.id, row]));
  const choices: LinkableManuscript[] = [];
  for (const row of nestManuscript(live)) {
    if (assigned.has(row.id)) continue;
    if (row.type !== "manuscript_chapter" && row.type !== "manuscript_scene") continue;
    const parent = row.parentRecordId ? byId.get(row.parentRecordId) : undefined;
    choices.push({
      id: row.id,
      title: row.title,
      type: row.type,
      chapterTitle: row.type === "manuscript_scene" ? (parent?.title ?? null) : null,
    });
  }
  return choices;
}

async function assertFingerprint(tx: Tx, projectId: string, manuscriptRecordId: string, expectedFingerprint: string) {
  const rows = await tx.sceneLocation.findMany({
    where: { projectId, manuscriptRecordId },
    select: { id: true, revision: true, isPrimary: true },
  });
  if (sceneLocationFingerprint(rows) !== expectedFingerprint) throw stale();
  return rows;
}

async function requireEnds(tx: Tx, projectId: string, manuscriptRecordId: string, locationRecordId: string) {
  const rows = await tx.record.findMany({
    where: { projectId, id: { in: [manuscriptRecordId, locationRecordId] }, trashedAt: null },
    select: { id: true, title: true, type: true },
  });
  const manuscript = rows.find((row) => row.id === manuscriptRecordId);
  const location = rows.find((row) => row.id === locationRecordId);
  if (!manuscript) throw rejected(`Record ${manuscriptRecordId} does not exist in this project.`, manuscriptRecordId);
  if (!location) throw rejected(`Record ${locationRecordId} does not exist in this project.`, locationRecordId);
  if (!isManuscriptType(manuscript.type)) {
    throw rejected("Only a chapter or a scene can have a scene location.", manuscriptRecordId);
  }
  if (!isRecordType(location.type) || !isLinkableReferenceType(location.type)) {
    const label = isRecordType(location.type) ? RECORD_TYPE_LABELS[location.type] : location.type;
    throw rejected(`A ${label} cannot be used as a location.`, locationRecordId);
  }
  return { manuscript, location };
}

async function clearOtherPrimary(tx: Tx, projectId: string, manuscriptRecordId: string, keepId: string | null) {
  const current = await tx.sceneLocation.findMany({
    where: { projectId, manuscriptRecordId, isPrimary: true, ...(keepId ? { id: { not: keepId } } : {}) },
    select: { id: true },
  });
  for (const row of current) {
    await tx.sceneLocation.update({
      where: { id: row.id },
      data: { isPrimary: false, revision: { increment: 1 } },
    });
  }
}

export async function assignSceneLocation(
  db: Db,
  projectId: string,
  manuscriptRecordId: string,
  locationRecordId: string,
  input: { isPrimary: boolean; expectedFingerprint: string },
): Promise<SceneLocationSet> {
  try {
    return await assignSceneLocationInTx(db, projectId, manuscriptRecordId, locationRecordId, input);
  } catch (error) {
    if (isUniqueConstraintError(error)) throw rejected("That location is already assigned here.", locationRecordId);
    throw error;
  }
}

async function assignSceneLocationInTx(
  db: Db,
  projectId: string,
  manuscriptRecordId: string,
  locationRecordId: string,
  input: { isPrimary: boolean; expectedFingerprint: string },
): Promise<SceneLocationSet> {
  return db.$transaction(async (tx) => {
    await assertFingerprint(tx, projectId, manuscriptRecordId, input.expectedFingerprint);
    const { manuscript, location } = await requireEnds(tx, projectId, manuscriptRecordId, locationRecordId);
    const existing = await tx.sceneLocation.findUnique({
      where: { manuscriptRecordId_locationRecordId: { manuscriptRecordId, locationRecordId } },
    });
    if (existing) throw rejected("That location is already assigned here.", locationRecordId);
    if (input.isPrimary) await clearOtherPrimary(tx, projectId, manuscriptRecordId, null);
    const id = newId("scl");
    await tx.sceneLocation.create({
      data: {
        id,
        projectId,
        manuscriptRecordId,
        locationRecordId,
        isPrimary: input.isPrimary,
        revision: 0,
      },
    });
    await writeAudit(tx, {
      projectId,
      action: "scene_location.assign",
      actor: UI_ACTOR,
      summary: `Assigned "${location.title}" to "${manuscript.title}"`,
      details: { id, manuscriptRecordId, locationRecordId, isPrimary: input.isPrimary },
    });
    return toSet(await rowsForManuscript(tx, projectId, manuscriptRecordId));
  });
}

export async function setSceneLocationPrimary(
  db: Db,
  projectId: string,
  manuscriptRecordId: string,
  assignmentId: string,
  input: { isPrimary: boolean; expectedFingerprint: string },
): Promise<SceneLocationSet> {
  return db.$transaction(async (tx) => {
    await assertFingerprint(tx, projectId, manuscriptRecordId, input.expectedFingerprint);
    const row = await tx.sceneLocation.findFirst({
      where: { id: assignmentId, projectId, manuscriptRecordId },
      include: { location: { select: { title: true } }, manuscript: { select: { title: true } } },
    });
    if (!row) throw rejected("That scene location is not assigned here.", assignmentId);
    if (row.isPrimary !== input.isPrimary) {
      if (input.isPrimary) await clearOtherPrimary(tx, projectId, manuscriptRecordId, row.id);
      await tx.sceneLocation.update({
        where: { id: row.id },
        data: { isPrimary: input.isPrimary, revision: { increment: 1 } },
      });
      await writeAudit(tx, {
        projectId,
        action: "scene_location.primary",
        actor: UI_ACTOR,
        summary: input.isPrimary
          ? `Marked "${row.location.title}" as the primary location of "${row.manuscript.title}"`
          : `Cleared the primary location on "${row.manuscript.title}"`,
        details: { id: row.id, manuscriptRecordId, locationRecordId: row.locationRecordId, isPrimary: input.isPrimary },
      });
    }
    return toSet(await rowsForManuscript(tx, projectId, manuscriptRecordId));
  });
}

export async function removeSceneLocation(
  db: Db,
  projectId: string,
  manuscriptRecordId: string,
  assignmentId: string,
  expectedFingerprint: string,
): Promise<SceneLocationSet> {
  return db.$transaction(async (tx) => {
    await assertFingerprint(tx, projectId, manuscriptRecordId, expectedFingerprint);
    const row = await tx.sceneLocation.findFirst({
      where: { id: assignmentId, projectId, manuscriptRecordId },
      include: { location: { select: { title: true } }, manuscript: { select: { title: true } } },
    });
    if (!row) throw rejected("That scene location is not assigned here.", assignmentId);
    await tx.sceneLocation.delete({ where: { id: row.id } });
    await writeAudit(tx, {
      projectId,
      action: "scene_location.remove",
      actor: UI_ACTOR,
      summary: `Removed "${row.location.title}" from "${row.manuscript.title}"`,
      details: { id: row.id, manuscriptRecordId, locationRecordId: row.locationRecordId },
    });
    return toSet(await rowsForManuscript(tx, projectId, manuscriptRecordId));
  });
}
