import { newId } from "@/domain/ids";
import { errorIssue } from "@/domain/issues";
import {
  isLinkableReferenceType,
  isManuscriptType,
  isRecordType,
  RECORD_TYPE_LABELS,
  type RecordType,
} from "@/domain/recordTypes";
import { isAuthorityStatus, type AuthorityStatus } from "@/domain/statuses";
import { readManuscriptMeta, type ManuscriptSceneStatus } from "@/writing/manuscriptStructure";
import { readThreadLine, withThreadLine } from "@/world/weaveBeatPresets";
import { worldbuildingKindFromFields } from "@/world/worldKinds";
import type { Db, DbOrTx, Tx } from "../db";
import { writeAudit } from "./auditService";
import { MutationRejectedError, NotFoundError, StaleRevisionError } from "./errors";

/*
 * Plan Weave: Original plan, Zero-draft story map, and Author rewrite grids.
 * Beats may link to chapters/scenes and World records, and carry Keep/Cut/Move/
 * Combine/Rebuild decisions. Positions are weave-local: moving a beat never
 * calls moveInBook and never changes Record.position / parentRecordId.
 * Setup→payoff links may span projects in the same workspace (series).
 * Applying a template creates an independent grid copy.
 *
 * layoutMode freeform | plot_grid is presentation only. Freeform uses x/y;
 * plot-grid uses story-thread columns (WeaveThread) × manuscript rows
 * (derived at read time). threadId / cellOrder never reorder the book.
 */

const UI_ACTOR = "author";

export const WEAVE_VIEW_KINDS = ["original", "zero_draft_map", "author_rewrite"] as const;
export type WeaveViewKind = (typeof WEAVE_VIEW_KINDS)[number];

export const WEAVE_VIEW_LABELS: Record<WeaveViewKind, string> = {
  original: "Original plan",
  zero_draft_map: "Zero-draft story map",
  author_rewrite: "Author rewrite plan",
};

export const WEAVE_LAYOUT_MODES = ["freeform", "plot_grid"] as const;
export type WeaveLayoutMode = (typeof WEAVE_LAYOUT_MODES)[number];

export const WEAVE_LAYOUT_LABELS: Record<WeaveLayoutMode, string> = {
  freeform: "Freeform canvas",
  plot_grid: "Plot grid",
};

export const WEAVE_DECISIONS = ["keep", "cut", "move", "combine", "rebuild"] as const;
export type WeaveDecision = (typeof WEAVE_DECISIONS)[number];

export const WEAVE_DECISION_LABELS: Record<WeaveDecision, string> = {
  keep: "Keep events",
  cut: "Cut",
  move: "Move",
  combine: "Combine",
  rebuild: "Rebuild",
};

export function isWeaveViewKind(v: string): v is WeaveViewKind {
  return (WEAVE_VIEW_KINDS as readonly string[]).includes(v);
}

export function isWeaveLayoutMode(v: string): v is WeaveLayoutMode {
  return (WEAVE_LAYOUT_MODES as readonly string[]).includes(v);
}

export function isWeaveDecision(v: string): v is WeaveDecision {
  return (WEAVE_DECISIONS as readonly string[]).includes(v);
}

export const WEAVE_SURFACES = ["beat_sheet", "story_grid", "chapter_grid", "freeform"] as const;
export type WeaveSurface = (typeof WEAVE_SURFACES)[number];

export function isWeaveSurface(v: string): v is WeaveSurface {
  return (WEAVE_SURFACES as readonly string[]).includes(v);
}

/** Null preferredSurface keeps the pre-structure default derived from layoutMode. */
export function resolveWeaveSurface(grid: {
  preferredSurface?: string | null;
  layoutMode: string;
}): WeaveSurface {
  if (grid.preferredSurface && isWeaveSurface(grid.preferredSurface)) return grid.preferredSurface;
  return grid.layoutMode === "plot_grid" ? "chapter_grid" : "freeform";
}

export interface WeaveGridSummary {
  id: string;
  title: string;
  viewKind: WeaveViewKind;
  viewLabel: string;
  beatCount: number;
  sourceTemplateId: string | null;
  preferredSurface: WeaveSurface | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WeaveWorldRefView {
  id: string;
  recordId: string;
  title: string;
  type: RecordType;
  typeLabel: string;
  worldKind: string | null;
  unavailable: boolean;
}

export interface WeaveThreadView {
  id: string;
  gridId: string;
  title: string;
  position: number;
  createdAt: Date;
}

export interface WeaveBeatView {
  id: string;
  gridId: string;
  title: string;
  body: string;
  decision: WeaveDecision | "";
  decisionLabel: string;
  manuscriptRecordId: string | null;
  manuscriptTitle: string | null;
  manuscriptTypeLabel: string | null;
  manuscriptUnavailable: boolean;
  /** Point of view saved on the linked chapter or scene, when that record still exists. */
  manuscriptPov: string;
  /** Draft status on the linked chapter or scene, when set. */
  manuscriptSceneStatus: ManuscriptSceneStatus | "";
  threadId: string | null;
  planningRowId: string | null;
  cellOrder: number;
  contentRevision: number;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  worldRefs: WeaveWorldRefView[];
}

export interface WeaveSetupPayoffView {
  id: string;
  fromBeatId: string;
  fromTitle: string;
  fromGridId: string;
  fromProjectId: string;
  fromProjectTitle: string;
  toBeatId: string;
  toTitle: string;
  toGridId: string;
  toProjectId: string;
  toProjectTitle: string;
  note: string;
  createdAt: Date;
}

export interface WeaveGridView {
  id: string;
  projectId: string;
  title: string;
  viewKind: WeaveViewKind;
  viewLabel: string;
  layoutMode: WeaveLayoutMode;
  /** null = legacy default (see resolveWeaveSurface). */
  preferredSurface: WeaveSurface | null;
  surface: WeaveSurface;
  sourceTemplateId: string | null;
  createdAt: Date;
  updatedAt: Date;
  threads: WeaveThreadView[];
  beats: WeaveBeatView[];
  setupPayoffs: WeaveSetupPayoffView[];
}

export interface WeaveTemplateBeatView {
  id: string;
  title: string;
  body: string;
  decision: WeaveDecision | "";
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  position: number;
}

export interface WeaveTemplateView {
  id: string;
  projectId: string;
  title: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
  beats: WeaveTemplateBeatView[];
}

function rejected(message: string, recordId?: string): MutationRejectedError {
  return new MutationRejectedError([errorIssue("INVALID_REFERENCE", message, recordId ? { recordId } : {})]);
}

function decisionLabel(decision: string): string {
  if (isWeaveDecision(decision)) return WEAVE_DECISION_LABELS[decision];
  return "";
}

async function requireGrid(tx: Tx, projectId: string, gridId: string) {
  const grid = await tx.weaveGrid.findFirst({ where: { id: gridId, projectId } });
  if (!grid) throw new NotFoundError(`Weave grid ${gridId} not found`);
  if (!isWeaveViewKind(grid.viewKind)) throw rejected("Unknown Weave view kind.");
  return grid as typeof grid & { viewKind: WeaveViewKind };
}

async function nextZ(tx: Tx, gridId: string) {
  const max = await tx.weaveBeat.aggregate({ where: { gridId }, _max: { zIndex: true } });
  return (max._max.zIndex ?? -1) + 1;
}

export async function listWeaveGrids(db: DbOrTx, projectId: string): Promise<WeaveGridSummary[]> {
  const rows = await db.weaveGrid.findMany({
    where: { projectId },
    orderBy: [{ viewKind: "asc" }, { updatedAt: "desc" }, { id: "asc" }],
    include: { _count: { select: { beats: true } } },
  });
  return rows.flatMap((g) => {
    if (!isWeaveViewKind(g.viewKind)) return [];
    const preferred =
      g.preferredSurface && isWeaveSurface(g.preferredSurface) ? g.preferredSurface : null;
    return [
      {
        id: g.id,
        title: g.title,
        viewKind: g.viewKind,
        viewLabel: WEAVE_VIEW_LABELS[g.viewKind],
        beatCount: g._count.beats,
        sourceTemplateId: g.sourceTemplateId,
        preferredSurface: preferred,
        createdAt: g.createdAt,
        updatedAt: g.updatedAt,
      },
    ];
  });
}

function beatViewOf(b: {
  id: string;
  gridId: string;
  title: string;
  body: string;
  decision: string;
  manuscriptRecordId: string | null;
  threadId: string | null;
  planningRowId?: string | null;
  cellOrder: number;
  contentRevision?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  manuscriptRecord: {
    id: string;
    title: string;
    type: string;
    fields: string;
    trashedAt: Date | null;
  } | null;
  worldRefs: Array<{
    id: string;
    recordId: string;
    record: { title: string; type: string; fields: string; trashedAt: Date | null };
  }>;
}): WeaveBeatView {
  const ms = b.manuscriptRecord;
  return {
    id: b.id,
    gridId: b.gridId,
    title: b.title,
    body: b.body,
    decision: isWeaveDecision(b.decision) ? b.decision : "",
    decisionLabel: decisionLabel(b.decision),
    manuscriptRecordId: b.manuscriptRecordId,
    manuscriptTitle: ms?.title ?? null,
    manuscriptTypeLabel: ms && isRecordType(ms.type) ? RECORD_TYPE_LABELS[ms.type] : null,
    manuscriptUnavailable: Boolean(ms?.trashedAt),
    manuscriptPov: ms ? povOf(ms.fields) : "",
    manuscriptSceneStatus: ms ? sceneStatusOf(ms.fields) : "",
    threadId: b.threadId,
    planningRowId: b.planningRowId ?? null,
    cellOrder: b.cellOrder,
    contentRevision: b.contentRevision ?? 1,
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    zIndex: b.zIndex,
    worldRefs: b.worldRefs.flatMap((r) => {
      if (!isRecordType(r.record.type)) return [];
      return [
        {
          id: r.id,
          recordId: r.recordId,
          title: r.record.title,
          type: r.record.type,
          typeLabel: RECORD_TYPE_LABELS[r.record.type],
          worldKind: r.record.type === "worldbuilding" ? worldKindOf(r.record.fields) : null,
          unavailable: r.record.trashedAt !== null,
        },
      ];
    }),
  };
}

function manuscriptMetaOf(fields: string) {
  try {
    const parsed: unknown = JSON.parse(fields);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { pov: "", sceneStatus: "" as const };
    }
    return readManuscriptMeta(parsed as Record<string, unknown>);
  } catch {
    return { pov: "", sceneStatus: "" as const };
  }
}

function povOf(fields: string): string {
  return manuscriptMetaOf(fields).pov;
}

function sceneStatusOf(fields: string): ManuscriptSceneStatus | "" {
  return manuscriptMetaOf(fields).sceneStatus;
}

function worldKindOf(fields: string): string | null {
  try {
    return worldbuildingKindFromFields(JSON.parse(fields));
  } catch {
    return null;
  }
}

function layoutModeOf(raw: string | null | undefined): WeaveLayoutMode {
  return isWeaveLayoutMode(raw ?? "") ? (raw as WeaveLayoutMode) : "freeform";
}

export async function getWeaveGrid(db: DbOrTx, projectId: string, gridId: string): Promise<WeaveGridView> {
  const grid = await db.weaveGrid.findFirst({
    where: { id: gridId, projectId },
    include: {
      threads: { orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }] },
      beats: {
        orderBy: [{ zIndex: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        include: {
          manuscriptRecord: { select: { id: true, title: true, type: true, fields: true, trashedAt: true } },
          worldRefs: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            include: { record: { select: { title: true, type: true, fields: true, trashedAt: true } } },
          },
          setupsFrom: {
            include: {
              fromBeat: {
                select: {
                  id: true,
                  title: true,
                  gridId: true,
                  projectId: true,
                  project: { select: { title: true } },
                },
              },
              toBeat: {
                select: {
                  id: true,
                  title: true,
                  gridId: true,
                  projectId: true,
                  project: { select: { title: true } },
                },
              },
            },
          },
          payoffsTo: {
            include: {
              fromBeat: {
                select: {
                  id: true,
                  title: true,
                  gridId: true,
                  projectId: true,
                  project: { select: { title: true } },
                },
              },
              toBeat: {
                select: {
                  id: true,
                  title: true,
                  gridId: true,
                  projectId: true,
                  project: { select: { title: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!grid || !isWeaveViewKind(grid.viewKind)) throw new NotFoundError(`Weave grid ${gridId} not found`);

  const setupMap = new Map<string, WeaveSetupPayoffView>();
  for (const beat of grid.beats) {
    for (const link of [...beat.setupsFrom, ...beat.payoffsTo]) {
      if (setupMap.has(link.id)) continue;
      setupMap.set(link.id, {
        id: link.id,
        fromBeatId: link.fromBeatId,
        fromTitle: link.fromBeat.title,
        fromGridId: link.fromBeat.gridId,
        fromProjectId: link.fromBeat.projectId,
        fromProjectTitle: link.fromBeat.project.title,
        toBeatId: link.toBeatId,
        toTitle: link.toBeat.title,
        toGridId: link.toBeat.gridId,
        toProjectId: link.toBeat.projectId,
        toProjectTitle: link.toBeat.project.title,
        note: link.note,
        createdAt: link.createdAt,
      });
    }
  }

  const preferred =
    grid.preferredSurface && isWeaveSurface(grid.preferredSurface) ? grid.preferredSurface : null;
  const layoutMode = layoutModeOf(grid.layoutMode);
  return {
    id: grid.id,
    projectId: grid.projectId,
    title: grid.title,
    viewKind: grid.viewKind,
    viewLabel: WEAVE_VIEW_LABELS[grid.viewKind],
    layoutMode,
    preferredSurface: preferred,
    surface: resolveWeaveSurface({ preferredSurface: preferred, layoutMode }),
    sourceTemplateId: grid.sourceTemplateId,
    createdAt: grid.createdAt,
    updatedAt: grid.updatedAt,
    threads: grid.threads.map((t) => ({
      id: t.id,
      gridId: t.gridId,
      title: t.title,
      position: t.position,
      createdAt: t.createdAt,
    })),
    beats: grid.beats.map(beatViewOf),
    setupPayoffs: [...setupMap.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
  };
}

export async function createWeaveGrid(
  db: Db,
  projectId: string,
  input: { title: string; viewKind: WeaveViewKind },
): Promise<WeaveGridView> {
  if (!isWeaveViewKind(input.viewKind)) throw rejected("Unknown Weave view kind.");
  const title = input.title.trim() || WEAVE_VIEW_LABELS[input.viewKind];
  return db.$transaction(async (tx) => {
    const project = await tx.project.findFirst({ where: { id: projectId, trashedAt: null }, select: { id: true } });
    if (!project) throw new NotFoundError(`Project ${projectId} not found`);
    const id = newId("wvg");
    await tx.weaveGrid.create({
      data: { id, projectId, title, viewKind: input.viewKind },
    });
    await writeAudit(tx, {
      projectId,
      action: "weave_grid.create",
      actor: UI_ACTOR,
      summary: `Created ${WEAVE_VIEW_LABELS[input.viewKind]} "${title}"`,
      details: { gridId: id, viewKind: input.viewKind },
    });
    return getWeaveGrid(tx, projectId, id);
  });
}

export async function renameWeaveGrid(db: Db, projectId: string, gridId: string, title: string): Promise<WeaveGridView> {
  const next = title.trim();
  if (!next) throw rejected("Give the Weave grid a title.");
  return db.$transaction(async (tx) => {
    await requireGrid(tx, projectId, gridId);
    await tx.weaveGrid.update({ where: { id: gridId }, data: { title: next } });
    await writeAudit(tx, {
      projectId,
      action: "weave_grid.rename",
      actor: UI_ACTOR,
      summary: `Renamed Weave grid to "${next}"`,
      details: { gridId, title: next },
    });
    return getWeaveGrid(tx, projectId, gridId);
  });
}

export async function deleteWeaveGrid(db: Db, projectId: string, gridId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const grid = await requireGrid(tx, projectId, gridId);
    const beatIds = (await tx.weaveBeat.findMany({ where: { gridId }, select: { id: true } })).map((b) => b.id);
    if (beatIds.length) {
      await tx.weaveSetupPayoff.deleteMany({
        where: { OR: [{ fromBeatId: { in: beatIds } }, { toBeatId: { in: beatIds } }] },
      });
      await tx.weaveBeatWorldRef.deleteMany({ where: { beatId: { in: beatIds } } });
      await tx.weaveBeatManuscriptLink.deleteMany({ where: { beatId: { in: beatIds } } });
      await tx.weaveStageIdea.deleteMany({ where: { beatId: { in: beatIds } } });
      await tx.weaveBeat.updateMany({ where: { gridId }, data: { threadId: null, planningRowId: null } });
      await tx.weaveBeat.deleteMany({ where: { gridId } });
    }
    await tx.weaveStructureStage.deleteMany({ where: { gridId } });
    await tx.weaveStructure.deleteMany({ where: { gridId } });
    await tx.weavePlanningRow.deleteMany({ where: { gridId } });
    await tx.weaveThread.deleteMany({ where: { gridId } });
    await tx.weaveGrid.delete({ where: { id: gridId } });
    await writeAudit(tx, {
      projectId,
      action: "weave_grid.delete",
      actor: UI_ACTOR,
      summary: `Deleted Weave grid "${grid.title}"`,
      details: { gridId },
    });
  });
}

export async function addWeaveBeat(
  db: Db,
  projectId: string,
  gridId: string,
  input: {
    title: string;
    body?: string;
    decision?: string;
    manuscriptRecordId?: string | null;
    threadId?: string | null;
    cellOrder?: number;
    x: number;
    y: number;
  },
): Promise<WeaveBeatView> {
  return db.$transaction(async (tx) => {
    await requireGrid(tx, projectId, gridId);
    const title = input.title.trim() || "Beat";
    const decision = input.decision?.trim() ?? "";
    if (decision && !isWeaveDecision(decision)) throw rejected("Unknown Weave decision.");
    let manuscriptRecordId: string | null = input.manuscriptRecordId ?? null;
    if (manuscriptRecordId) {
      manuscriptRecordId = await requireManuscriptLink(tx, projectId, manuscriptRecordId);
    }
    let threadId: string | null = input.threadId ?? null;
    if (threadId) threadId = await requireThread(tx, projectId, gridId, threadId);
    const cellOrder =
      typeof input.cellOrder === "number" && Number.isFinite(input.cellOrder)
        ? Math.max(0, Math.round(input.cellOrder))
        : 0;
    const id = newId("wvb");
    const zIndex = await nextZ(tx, gridId);
    await tx.weaveBeat.create({
      data: {
        id,
        gridId,
        projectId,
        title,
        body: input.body?.trim() ?? "",
        decision,
        manuscriptRecordId,
        threadId,
        cellOrder,
        x: Math.round(input.x),
        y: Math.round(input.y),
        zIndex,
      },
    });
    await tx.weaveGrid.update({ where: { id: gridId }, data: { updatedAt: new Date() } });
    await writeAudit(tx, {
      projectId,
      action: "weave_beat.add",
      actor: UI_ACTOR,
      summary: `Added beat "${title}"`,
      details: { gridId, beatId: id, manuscriptRecordId, threadId },
    });
    const view = await getWeaveGrid(tx, projectId, gridId);
    return view.beats.find((b) => b.id === id)!;
  });
}

/** Repositions a beat on the grid only. Never reorders manuscript chapters or scenes. */
export async function moveWeaveBeat(
  db: Db,
  projectId: string,
  gridId: string,
  beatId: string,
  input: { x: number; y: number; width?: number; height?: number; zIndex?: number },
): Promise<WeaveBeatView> {
  return db.$transaction(async (tx) => {
    await requireGrid(tx, projectId, gridId);
    const beat = await tx.weaveBeat.findFirst({ where: { id: beatId, gridId, projectId } });
    if (!beat) throw rejected("That beat is not on this Weave grid.");
    await tx.weaveBeat.update({
      where: { id: beatId },
      data: {
        x: Math.round(input.x),
        y: Math.round(input.y),
        ...(typeof input.width === "number" ? { width: Math.max(120, Math.round(input.width)) } : {}),
        ...(typeof input.height === "number" ? { height: Math.max(80, Math.round(input.height)) } : {}),
        ...(typeof input.zIndex === "number" ? { zIndex: input.zIndex } : {}),
      },
    });
    await tx.weaveGrid.update({ where: { id: gridId }, data: { updatedAt: new Date() } });
    await writeAudit(tx, {
      projectId,
      action: "weave_beat.move",
      actor: UI_ACTOR,
      summary: `Moved a Weave beat`,
      details: { gridId, beatId, x: Math.round(input.x), y: Math.round(input.y) },
    });
    const view = await getWeaveGrid(tx, projectId, gridId);
    const found = view.beats.find((b) => b.id === beatId);
    if (!found) throw rejected("That beat is not on this Weave grid.");
    return found;
  });
}

export async function updateWeaveBeat(
  db: Db,
  projectId: string,
  gridId: string,
  beatId: string,
  input: {
    title?: string;
    body?: string;
    decision?: string;
    manuscriptRecordId?: string | null;
    threadId?: string | null;
    planningRowId?: string | null;
    cellOrder?: number;
    /** When set, title/body updates refuse if the idea changed elsewhere. */
    expectedRevision?: number;
  },
): Promise<WeaveBeatView> {
  return db.$transaction(async (tx) => {
    await requireGrid(tx, projectId, gridId);
    const beat = await tx.weaveBeat.findFirst({ where: { id: beatId, gridId, projectId } });
    if (!beat) throw rejected("That beat is not on this Weave grid.");
    const touchesText = typeof input.title === "string" || typeof input.body === "string";
    if (touchesText && typeof input.expectedRevision === "number" && beat.contentRevision !== input.expectedRevision) {
      throw new StaleRevisionError(
        errorIssue(
          "STALE_REVISION",
          "This story idea changed elsewhere. Your local text was kept.",
          { recordId: beatId },
        ),
      );
    }
    const data: {
      title?: string;
      body?: string;
      decision?: string;
      manuscriptRecordId?: string | null;
      threadId?: string | null;
      planningRowId?: string | null;
      cellOrder?: number;
      contentRevision?: number;
    } = {};
    if (typeof input.title === "string") {
      const title = input.title.trim();
      if (!title) throw rejected("Give the beat a title.");
      data.title = title;
    }
    if (typeof input.body === "string") data.body = input.body;
    if (touchesText) data.contentRevision = beat.contentRevision + 1;
    if (typeof input.decision === "string") {
      const decision = input.decision.trim();
      if (decision && !isWeaveDecision(decision)) throw rejected("Unknown Weave decision.");
      data.decision = decision;
    }
    if (input.manuscriptRecordId !== undefined) {
      data.manuscriptRecordId = input.manuscriptRecordId
        ? await requireManuscriptLink(tx, projectId, input.manuscriptRecordId)
        : null;
    }
    if (input.threadId !== undefined) {
      data.threadId = input.threadId ? await requireThread(tx, projectId, gridId, input.threadId) : null;
    }
    if (input.planningRowId !== undefined) {
      if (input.planningRowId) {
        const row = await tx.weavePlanningRow.findFirst({
          where: { id: input.planningRowId, gridId, projectId },
        });
        if (!row) throw rejected("That planning moment is not on this Weave grid.");
        data.planningRowId = row.id;
      } else {
        data.planningRowId = null;
      }
    }
    if (typeof input.cellOrder === "number" && Number.isFinite(input.cellOrder)) {
      data.cellOrder = Math.max(0, Math.round(input.cellOrder));
    }
    await tx.weaveBeat.update({ where: { id: beatId }, data });
    await tx.weaveGrid.update({ where: { id: gridId }, data: { updatedAt: new Date() } });
    await writeAudit(tx, {
      projectId,
      action: "weave_beat.update",
      actor: UI_ACTOR,
      summary: `Updated a Weave beat`,
      details: { gridId, beatId, ...data },
    });
    const view = await getWeaveGrid(tx, projectId, gridId);
    return view.beats.find((b) => b.id === beatId)!;
  });
}

export async function removeWeaveBeat(db: Db, projectId: string, gridId: string, beatId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await requireGrid(tx, projectId, gridId);
    const beat = await tx.weaveBeat.findFirst({ where: { id: beatId, gridId, projectId } });
    if (!beat) throw rejected("That beat is not on this Weave grid.");
    await tx.weaveSetupPayoff.deleteMany({ where: { OR: [{ fromBeatId: beatId }, { toBeatId: beatId }] } });
    await tx.weaveBeatWorldRef.deleteMany({ where: { beatId } });
    await tx.weaveBeat.delete({ where: { id: beatId } });
    await tx.weaveGrid.update({ where: { id: gridId }, data: { updatedAt: new Date() } });
    await writeAudit(tx, {
      projectId,
      action: "weave_beat.remove",
      actor: UI_ACTOR,
      summary: `Removed a Weave beat`,
      details: { gridId, beatId },
    });
  });
}

export async function addWeaveBeatWorldRef(
  db: Db,
  projectId: string,
  gridId: string,
  beatId: string,
  recordId: string,
): Promise<WeaveBeatView> {
  return db.$transaction(async (tx) => {
    await requireGrid(tx, projectId, gridId);
    const beat = await tx.weaveBeat.findFirst({ where: { id: beatId, gridId, projectId } });
    if (!beat) throw rejected("That beat is not on this Weave grid.");
    const record = await tx.record.findFirst({
      where: { id: recordId, projectId, trashedAt: null },
      select: { id: true, title: true, type: true },
    });
    if (!record || !isRecordType(record.type) || !isLinkableReferenceType(record.type)) {
      throw rejected("Only World or other reference records can be cited on a beat.", recordId);
    }
    const existing = await tx.weaveBeatWorldRef.findUnique({
      where: { beatId_recordId: { beatId, recordId } },
    });
    if (existing) throw rejected("That reference is already on this beat.", recordId);
    await tx.weaveBeatWorldRef.create({
      data: { id: newId("wvr"), beatId, projectId, recordId },
    });
    await tx.weaveGrid.update({ where: { id: gridId }, data: { updatedAt: new Date() } });
    await writeAudit(tx, {
      projectId,
      action: "weave_beat.world_ref.add",
      actor: UI_ACTOR,
      summary: `Cited "${record.title}" on a Weave beat`,
      details: { gridId, beatId, recordId },
    });
    return (await getWeaveGrid(tx, projectId, gridId)).beats.find((b) => b.id === beatId)!;
  });
}

export async function removeWeaveBeatWorldRef(
  db: Db,
  projectId: string,
  gridId: string,
  beatId: string,
  refId: string,
): Promise<WeaveBeatView> {
  return db.$transaction(async (tx) => {
    await requireGrid(tx, projectId, gridId);
    const ref = await tx.weaveBeatWorldRef.findFirst({ where: { id: refId, beatId, projectId } });
    if (!ref) throw rejected("That World reference is not on this beat.");
    await tx.weaveBeatWorldRef.delete({ where: { id: refId } });
    await tx.weaveGrid.update({ where: { id: gridId }, data: { updatedAt: new Date() } });
    await writeAudit(tx, {
      projectId,
      action: "weave_beat.world_ref.remove",
      actor: UI_ACTOR,
      summary: `Removed a World citation from a Weave beat`,
      details: { gridId, beatId, refId, recordId: ref.recordId },
    });
    return (await getWeaveGrid(tx, projectId, gridId)).beats.find((b) => b.id === beatId)!;
  });
}

export async function addWeaveSetupPayoff(
  db: Db,
  projectId: string,
  input: { fromBeatId: string; toBeatId: string; note?: string },
): Promise<WeaveSetupPayoffView> {
  if (input.fromBeatId === input.toBeatId) throw rejected("A setup cannot be its own payoff.");
  return db.$transaction(async (tx) => {
    const project = await tx.project.findFirst({
      where: { id: projectId, trashedAt: null },
      select: { id: true, workspaceId: true },
    });
    if (!project) throw new NotFoundError(`Project ${projectId} not found`);

    const from = await tx.weaveBeat.findFirst({
      where: { id: input.fromBeatId },
      include: { project: { select: { id: true, title: true, workspaceId: true, trashedAt: true } }, grid: true },
    });
    const to = await tx.weaveBeat.findFirst({
      where: { id: input.toBeatId },
      include: { project: { select: { id: true, title: true, workspaceId: true, trashedAt: true } }, grid: true },
    });
    if (!from || from.project.trashedAt) throw rejected("Setup beat not found.", input.fromBeatId);
    if (!to || to.project.trashedAt) throw rejected("Payoff beat not found.", input.toBeatId);
    if (from.project.workspaceId !== project.workspaceId || to.project.workspaceId !== project.workspaceId) {
      throw rejected("Setup and payoff must be in the same workspace (series).");
    }
    const existing = await tx.weaveSetupPayoff.findUnique({
      where: { fromBeatId_toBeatId: { fromBeatId: from.id, toBeatId: to.id } },
    });
    if (existing) throw rejected("That setup→payoff link already exists.");

    const id = newId("wvs");
    const note = input.note?.trim() ?? "";
    await tx.weaveSetupPayoff.create({
      data: {
        id,
        workspaceId: project.workspaceId,
        fromBeatId: from.id,
        toBeatId: to.id,
        note,
      },
    });
    await writeAudit(tx, {
      projectId,
      action: "weave_setup_payoff.add",
      actor: UI_ACTOR,
      summary: `Linked setup "${from.title}" → payoff "${to.title}"`,
      details: { relationId: id, fromBeatId: from.id, toBeatId: to.id },
    });
    return {
      id,
      fromBeatId: from.id,
      fromTitle: from.title,
      fromGridId: from.gridId,
      fromProjectId: from.projectId,
      fromProjectTitle: from.project.title,
      toBeatId: to.id,
      toTitle: to.title,
      toGridId: to.gridId,
      toProjectId: to.projectId,
      toProjectTitle: to.project.title,
      note,
      createdAt: new Date(),
    };
  });
}

export async function removeWeaveSetupPayoff(db: Db, projectId: string, relationId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const project = await tx.project.findFirst({
      where: { id: projectId, trashedAt: null },
      select: { workspaceId: true },
    });
    if (!project) throw new NotFoundError(`Project ${projectId} not found`);
    const row = await tx.weaveSetupPayoff.findFirst({
      where: { id: relationId, workspaceId: project.workspaceId },
      include: { fromBeat: { select: { title: true } }, toBeat: { select: { title: true } } },
    });
    if (!row) throw rejected("That setup→payoff link is not in this series workspace.");
    await tx.weaveSetupPayoff.delete({ where: { id: relationId } });
    await writeAudit(tx, {
      projectId,
      action: "weave_setup_payoff.remove",
      actor: UI_ACTOR,
      summary: `Removed setup→payoff between "${row.fromBeat.title}" and "${row.toBeat.title}"`,
      details: { relationId },
    });
  });
}

/**
 * Beats linked to a chapter or scene (Write Plot tab). Same stable beat IDs as
 * Weave freeform / plot grid. Does not create or reorder manuscript records.
 */
export async function listWeaveBeatsForManuscript(
  db: DbOrTx,
  projectId: string,
  manuscriptRecordId: string,
): Promise<
  Array<{
    id: string;
    title: string;
    body: string;
    decision: WeaveDecision | "";
    decisionLabel: string;
    threadId: string | null;
    threadTitle: string | null;
    gridId: string;
    gridTitle: string;
    layoutMode: WeaveLayoutMode;
  }>
> {
  const record = await db.record.findFirst({
    where: { id: manuscriptRecordId, projectId, trashedAt: null },
    select: { id: true, type: true },
  });
  if (!record || !isManuscriptType(record.type) || record.type === "scene_note") return [];
  const beats = await db.weaveBeat.findMany({
    where: { projectId, manuscriptRecordId },
    orderBy: [{ gridId: "asc" }, { cellOrder: "asc" }, { zIndex: "asc" }, { id: "asc" }],
    include: {
      grid: { select: { id: true, title: true, layoutMode: true } },
      thread: { select: { id: true, title: true } },
    },
  });
  return beats.map((b) => ({
    id: b.id,
    title: b.title,
    body: b.body,
    decision: isWeaveDecision(b.decision) ? b.decision : "",
    decisionLabel: decisionLabel(b.decision),
    threadId: b.threadId,
    threadTitle: b.thread?.title ?? null,
    gridId: b.grid.id,
    gridTitle: b.grid.title,
    layoutMode: layoutModeOf(b.grid.layoutMode),
  }));
}

/** Beats in other projects of the same workspace (for series setup/payoff pickers). */
export async function listSeriesWeaveBeats(
  db: DbOrTx,
  projectId: string,
): Promise<
  Array<{
    id: string;
    title: string;
    gridId: string;
    gridTitle: string;
    projectId: string;
    projectTitle: string;
    bookName: string | null;
  }>
> {
  const project = await db.project.findFirst({
    where: { id: projectId, trashedAt: null },
    select: { workspaceId: true },
  });
  if (!project) return [];
  const beats = await db.weaveBeat.findMany({
    where: { project: { workspaceId: project.workspaceId, trashedAt: null } },
    orderBy: [{ projectId: "asc" }, { title: "asc" }, { id: "asc" }],
    include: {
      grid: { select: { id: true, title: true } },
      project: { select: { id: true, title: true, bookName: true } },
    },
  });
  return beats.map((b) => ({
    id: b.id,
    title: b.title,
    gridId: b.grid.id,
    gridTitle: b.grid.title,
    projectId: b.project.id,
    projectTitle: b.project.title,
    bookName: b.project.bookName,
  }));
}

export async function listWeaveTemplates(db: DbOrTx, projectId: string): Promise<WeaveTemplateView[]> {
  const rows = await db.weaveTemplate.findMany({
    where: { projectId },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    include: { beats: { orderBy: [{ position: "asc" }, { id: "asc" }] } },
  });
  return rows.map(templateViewOf);
}

export async function getWeaveTemplate(db: DbOrTx, projectId: string, templateId: string): Promise<WeaveTemplateView> {
  const row = await db.weaveTemplate.findFirst({
    where: { id: templateId, projectId },
    include: { beats: { orderBy: [{ position: "asc" }, { id: "asc" }] } },
  });
  if (!row) throw new NotFoundError(`Weave template ${templateId} not found`);
  return templateViewOf(row);
}

function templateViewOf(row: {
  id: string;
  projectId: string;
  title: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
  beats: Array<{
    id: string;
    title: string;
    body: string;
    decision: string;
    x: number;
    y: number;
    width: number;
    height: number;
    zIndex: number;
    position: number;
  }>;
}): WeaveTemplateView {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    beats: row.beats.map((b) => ({
      id: b.id,
      title: b.title,
      body: b.body,
      decision: isWeaveDecision(b.decision) ? b.decision : "",
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      zIndex: b.zIndex,
      position: b.position,
    })),
  };
}

export async function createWeaveTemplate(
  db: Db,
  projectId: string,
  input: { title: string; description?: string },
): Promise<WeaveTemplateView> {
  const title = input.title.trim();
  if (!title) throw rejected("Give the template a title.");
  return db.$transaction(async (tx) => {
    const project = await tx.project.findFirst({ where: { id: projectId, trashedAt: null }, select: { id: true } });
    if (!project) throw new NotFoundError(`Project ${projectId} not found`);
    const id = newId("wvt");
    await tx.weaveTemplate.create({
      data: { id, projectId, title, description: input.description?.trim() ?? "" },
    });
    await writeAudit(tx, {
      projectId,
      action: "weave_template.create",
      actor: UI_ACTOR,
      summary: `Created Weave template "${title}"`,
      details: { templateId: id },
    });
    return getWeaveTemplate(tx, projectId, id);
  });
}

export async function updateWeaveTemplate(
  db: Db,
  projectId: string,
  templateId: string,
  input: { title?: string; description?: string },
): Promise<WeaveTemplateView> {
  return db.$transaction(async (tx) => {
    const row = await tx.weaveTemplate.findFirst({ where: { id: templateId, projectId } });
    if (!row) throw new NotFoundError(`Weave template ${templateId} not found`);
    const data: { title?: string; description?: string } = {};
    if (typeof input.title === "string") {
      const title = input.title.trim();
      if (!title) throw rejected("Give the template a title.");
      data.title = title;
    }
    if (typeof input.description === "string") data.description = input.description.trim();
    await tx.weaveTemplate.update({ where: { id: templateId }, data });
    await writeAudit(tx, {
      projectId,
      action: "weave_template.update",
      actor: UI_ACTOR,
      summary: `Updated Weave template`,
      details: { templateId, ...data },
    });
    return getWeaveTemplate(tx, projectId, templateId);
  });
}

export async function deleteWeaveTemplate(db: Db, projectId: string, templateId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const row = await tx.weaveTemplate.findFirst({ where: { id: templateId, projectId } });
    if (!row) throw new NotFoundError(`Weave template ${templateId} not found`);
    await tx.weaveTemplateBeat.deleteMany({ where: { templateId } });
    await tx.weaveTemplate.delete({ where: { id: templateId } });
    await writeAudit(tx, {
      projectId,
      action: "weave_template.delete",
      actor: UI_ACTOR,
      summary: `Deleted Weave template "${row.title}"`,
      details: { templateId },
    });
  });
}

export async function upsertWeaveTemplateBeat(
  db: Db,
  projectId: string,
  templateId: string,
  input: {
    beatId?: string;
    title: string;
    body?: string;
    decision?: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    position?: number;
  },
): Promise<WeaveTemplateView> {
  return db.$transaction(async (tx) => {
    const template = await tx.weaveTemplate.findFirst({ where: { id: templateId, projectId } });
    if (!template) throw new NotFoundError(`Weave template ${templateId} not found`);
    const title = input.title.trim() || "Beat";
    const decision = input.decision?.trim() ?? "";
    if (decision && !isWeaveDecision(decision)) throw rejected("Unknown Weave decision.");
    if (input.beatId) {
      const existing = await tx.weaveTemplateBeat.findFirst({ where: { id: input.beatId, templateId } });
      if (!existing) throw rejected("That template beat was not found.");
      await tx.weaveTemplateBeat.update({
        where: { id: input.beatId },
        data: {
          title,
          body: input.body ?? existing.body,
          decision,
          x: Math.round(input.x),
          y: Math.round(input.y),
          ...(typeof input.width === "number" ? { width: Math.max(120, Math.round(input.width)) } : {}),
          ...(typeof input.height === "number" ? { height: Math.max(80, Math.round(input.height)) } : {}),
          ...(typeof input.position === "number" ? { position: input.position } : {}),
        },
      });
    } else {
      const max = await tx.weaveTemplateBeat.aggregate({ where: { templateId }, _max: { position: true, zIndex: true } });
      await tx.weaveTemplateBeat.create({
        data: {
          id: newId("wvx"),
          templateId,
          title,
          body: input.body?.trim() ?? "",
          decision,
          x: Math.round(input.x),
          y: Math.round(input.y),
          width: typeof input.width === "number" ? Math.max(120, Math.round(input.width)) : 220,
          height: typeof input.height === "number" ? Math.max(80, Math.round(input.height)) : 140,
          zIndex: (max._max.zIndex ?? -1) + 1,
          position: typeof input.position === "number" ? input.position : (max._max.position ?? -1) + 1,
        },
      });
    }
    await tx.weaveTemplate.update({ where: { id: templateId }, data: { updatedAt: new Date() } });
    await writeAudit(tx, {
      projectId,
      action: "weave_template.beat.upsert",
      actor: UI_ACTOR,
      summary: `Edited beats on Weave template "${template.title}"`,
      details: { templateId },
    });
    return getWeaveTemplate(tx, projectId, templateId);
  });
}

export async function removeWeaveTemplateBeat(
  db: Db,
  projectId: string,
  templateId: string,
  beatId: string,
): Promise<WeaveTemplateView> {
  return db.$transaction(async (tx) => {
    const template = await tx.weaveTemplate.findFirst({ where: { id: templateId, projectId } });
    if (!template) throw new NotFoundError(`Weave template ${templateId} not found`);
    const beat = await tx.weaveTemplateBeat.findFirst({ where: { id: beatId, templateId } });
    if (!beat) throw rejected("That template beat was not found.");
    await tx.weaveTemplateBeat.delete({ where: { id: beatId } });
    await tx.weaveTemplate.update({ where: { id: templateId }, data: { updatedAt: new Date() } });
    await writeAudit(tx, {
      projectId,
      action: "weave_template.beat.remove",
      actor: UI_ACTOR,
      summary: `Removed a beat from Weave template "${template.title}"`,
      details: { templateId, beatId },
    });
    return getWeaveTemplate(tx, projectId, templateId);
  });
}

/** Applies a template as a new independent grid copy (no live link to the template). */
export async function applyWeaveTemplate(
  db: Db,
  projectId: string,
  templateId: string,
  input: { title?: string; viewKind: WeaveViewKind },
): Promise<WeaveGridView> {
  if (!isWeaveViewKind(input.viewKind)) throw rejected("Unknown Weave view kind.");
  return db.$transaction(async (tx) => {
    const template = await tx.weaveTemplate.findFirst({
      where: { id: templateId, projectId },
      include: { beats: { orderBy: [{ position: "asc" }, { id: "asc" }] } },
    });
    if (!template) throw new NotFoundError(`Weave template ${templateId} not found`);
    const title = (input.title?.trim() || `${template.title} copy`).trim();
    const gridId = newId("wvg");
    const placed = template.beats.map((b) => ({ beat: b, thread: readThreadLine(b.body) }));
    const threadTitles: string[] = [];
    for (const row of placed) {
      const threadTitle = row.thread.threadTitle;
      if (threadTitle && !threadTitles.includes(threadTitle)) threadTitles.push(threadTitle);
    }
    await tx.weaveGrid.create({
      data: {
        id: gridId,
        projectId,
        title,
        viewKind: input.viewKind,
        layoutMode: threadTitles.length ? "plot_grid" : "freeform",
        sourceTemplateId: template.id,
      },
    });
    const threadIds = new Map<string, string>();
    for (const [position, threadTitle] of threadTitles.entries()) {
      const threadId = newId("wth");
      threadIds.set(threadTitle, threadId);
      await tx.weaveThread.create({
        data: { id: threadId, gridId, projectId, title: threadTitle, position },
      });
    }
    const cellOrder = new Map<string, number>();
    for (const row of placed) {
      const threadTitle = row.thread.threadTitle;
      const threadId = threadTitle ? threadIds.get(threadTitle) ?? null : null;
      const orderKey = threadId ?? "";
      const order = cellOrder.get(orderKey) ?? 0;
      cellOrder.set(orderKey, order + 1);
      await tx.weaveBeat.create({
        data: {
          id: newId("wvb"),
          gridId,
          projectId,
          title: row.beat.title,
          body: row.thread.body,
          decision: row.beat.decision,
          threadId,
          cellOrder: order,
          x: row.beat.x,
          y: row.beat.y,
          width: row.beat.width,
          height: row.beat.height,
          zIndex: row.beat.zIndex,
        },
      });
    }
    await writeAudit(tx, {
      projectId,
      action: "weave_template.apply",
      actor: UI_ACTOR,
      summary: `Applied Weave template "${template.title}" as "${title}"`,
      details: { templateId, gridId, viewKind: input.viewKind, beatCount: template.beats.length },
    });
    return getWeaveGrid(tx, projectId, gridId);
  });
}

/** Save the current grid's beats into a new editable template (structure only). */
export async function saveWeaveGridAsTemplate(
  db: Db,
  projectId: string,
  gridId: string,
  input: { title: string; description?: string },
): Promise<WeaveTemplateView> {
  const title = input.title.trim();
  if (!title) throw rejected("Give the template a title.");
  return db.$transaction(async (tx) => {
    const grid = await requireGrid(tx, projectId, gridId);
    const beats = await tx.weaveBeat.findMany({
      where: { gridId },
      orderBy: [{ zIndex: "asc" }, { id: "asc" }],
      include: { thread: { select: { title: true } } },
    });
    const templateId = newId("wvt");
    await tx.weaveTemplate.create({
      data: {
        id: templateId,
        projectId,
        title,
        description: input.description?.trim() ?? `From ${grid.title}`,
      },
    });
    let position = 0;
    for (const b of beats) {
      await tx.weaveTemplateBeat.create({
        data: {
          id: newId("wvx"),
          templateId,
          title: b.title,
          body: b.thread?.title && !readThreadLine(b.body).threadTitle ? withThreadLine(b.thread.title, b.body) : b.body,
          decision: b.decision,
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
          zIndex: b.zIndex,
          position: position++,
        },
      });
    }
    await writeAudit(tx, {
      projectId,
      action: "weave_template.save_from_grid",
      actor: UI_ACTOR,
      summary: `Saved Weave grid "${grid.title}" as template "${title}"`,
      details: { templateId, gridId, beatCount: beats.length },
    });
    return getWeaveTemplate(tx, projectId, templateId);
  });
}

async function requireManuscriptLink(tx: Tx, projectId: string, recordId: string): Promise<string> {
  const record = await tx.record.findFirst({
    where: { id: recordId, projectId, trashedAt: null },
    select: { id: true, type: true, title: true },
  });
  if (!record) throw rejected("That chapter or scene is not in this project.", recordId);
  if (!isRecordType(record.type) || !isManuscriptType(record.type) || record.type === "scene_note") {
    throw rejected("Beats link only to chapters or scenes.", recordId);
  }
  return record.id;
}

async function requireThread(tx: Tx, projectId: string, gridId: string, threadId: string): Promise<string> {
  const thread = await tx.weaveThread.findFirst({ where: { id: threadId, gridId, projectId }, select: { id: true } });
  if (!thread) throw rejected("That story thread is not on this Weave grid.");
  return thread.id;
}

/** Switch freeform canvas ↔ plot-grid. Never changes beat x/y or manuscript order. */
export async function setWeaveLayoutMode(
  db: Db,
  projectId: string,
  gridId: string,
  layoutMode: WeaveLayoutMode,
): Promise<WeaveGridView> {
  if (!isWeaveLayoutMode(layoutMode)) throw rejected("Unknown Weave layout.");
  return db.$transaction(async (tx) => {
    await requireGrid(tx, projectId, gridId);
    await tx.weaveGrid.update({ where: { id: gridId }, data: { layoutMode } });
    await writeAudit(tx, {
      projectId,
      action: "weave_grid.layout",
      actor: UI_ACTOR,
      summary: `Set Weave layout to ${WEAVE_LAYOUT_LABELS[layoutMode]}`,
      details: { gridId, layoutMode },
    });
    return getWeaveGrid(tx, projectId, gridId);
  });
}

export async function addWeaveThread(
  db: Db,
  projectId: string,
  gridId: string,
  input: { title: string },
): Promise<WeaveThreadView> {
  return db.$transaction(async (tx) => {
    await requireGrid(tx, projectId, gridId);
    const title = input.title.trim() || "Thread";
    const max = await tx.weaveThread.aggregate({ where: { gridId }, _max: { position: true } });
    const position = (max._max.position ?? -1) + 1;
    const id = newId("wth");
    await tx.weaveThread.create({
      data: { id, gridId, projectId, title, position },
    });
    await tx.weaveGrid.update({ where: { id: gridId }, data: { updatedAt: new Date() } });
    await writeAudit(tx, {
      projectId,
      action: "weave_thread.add",
      actor: UI_ACTOR,
      summary: `Added story thread "${title}"`,
      details: { gridId, threadId: id },
    });
    return {
      id,
      gridId,
      title,
      position,
      createdAt: new Date(),
    };
  });
}

export async function renameWeaveThread(
  db: Db,
  projectId: string,
  gridId: string,
  threadId: string,
  title: string,
): Promise<WeaveThreadView> {
  const next = title.trim();
  if (!next) throw rejected("Give the story thread a title.");
  return db.$transaction(async (tx) => {
    await requireGrid(tx, projectId, gridId);
    await requireThread(tx, projectId, gridId, threadId);
    await tx.weaveThread.update({ where: { id: threadId }, data: { title: next } });
    await tx.weaveGrid.update({ where: { id: gridId }, data: { updatedAt: new Date() } });
    await writeAudit(tx, {
      projectId,
      action: "weave_thread.rename",
      actor: UI_ACTOR,
      summary: `Renamed story thread to "${next}"`,
      details: { gridId, threadId, title: next },
    });
    const thread = await tx.weaveThread.findFirstOrThrow({ where: { id: threadId } });
    return {
      id: thread.id,
      gridId: thread.gridId,
      title: thread.title,
      position: thread.position,
      createdAt: thread.createdAt,
    };
  });
}

/** Reorder story-thread columns. Never changes manuscript book order. */
export async function reorderWeaveThreads(
  db: Db,
  projectId: string,
  gridId: string,
  orderedThreadIds: string[],
): Promise<WeaveGridView> {
  return db.$transaction(async (tx) => {
    await requireGrid(tx, projectId, gridId);
    const existing = await tx.weaveThread.findMany({
      where: { gridId, projectId },
      select: { id: true },
      orderBy: [{ position: "asc" }, { id: "asc" }],
    });
    const existingIds = new Set(existing.map((t) => t.id));
    if (orderedThreadIds.length !== existing.length || orderedThreadIds.some((id) => !existingIds.has(id))) {
      throw rejected("Thread list does not match this Weave grid.");
    }
    let position = 0;
    for (const id of orderedThreadIds) {
      await tx.weaveThread.update({ where: { id }, data: { position: position++ } });
    }
    await tx.weaveGrid.update({ where: { id: gridId }, data: { updatedAt: new Date() } });
    await writeAudit(tx, {
      projectId,
      action: "weave_thread.reorder",
      actor: UI_ACTOR,
      summary: `Reordered story threads`,
      details: { gridId, orderedThreadIds },
    });
    return getWeaveGrid(tx, projectId, gridId);
  });
}

export async function deleteWeaveThread(
  db: Db,
  projectId: string,
  gridId: string,
  threadId: string,
): Promise<WeaveGridView> {
  return db.$transaction(async (tx) => {
    await requireGrid(tx, projectId, gridId);
    const thread = await tx.weaveThread.findFirst({ where: { id: threadId, gridId, projectId } });
    if (!thread) throw rejected("That story thread is not on this Weave grid.");
    await tx.weaveBeat.updateMany({ where: { threadId }, data: { threadId: null } });
    await tx.weaveThread.delete({ where: { id: threadId } });
    const remaining = await tx.weaveThread.findMany({
      where: { gridId },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    let position = 0;
    for (const row of remaining) {
      await tx.weaveThread.update({ where: { id: row.id }, data: { position: position++ } });
    }
    await tx.weaveGrid.update({ where: { id: gridId }, data: { updatedAt: new Date() } });
    await writeAudit(tx, {
      projectId,
      action: "weave_thread.delete",
      actor: UI_ACTOR,
      summary: `Deleted story thread "${thread.title}"`,
      details: { gridId, threadId },
    });
    return getWeaveGrid(tx, projectId, gridId);
  });
}

/**
 * Place a beat in a plot-grid cell (thread column × optional manuscript row).
 * Never calls moveInBook; freeform x/y are left unchanged.
 */
export async function placeWeaveBeat(
  db: Db,
  projectId: string,
  gridId: string,
  beatId: string,
  input: { threadId: string | null; manuscriptRecordId?: string | null; cellOrder?: number },
): Promise<WeaveBeatView> {
  return updateWeaveBeat(db, projectId, gridId, beatId, {
    threadId: input.threadId,
    ...(input.manuscriptRecordId !== undefined ? { manuscriptRecordId: input.manuscriptRecordId } : {}),
    ...(typeof input.cellOrder === "number" ? { cellOrder: input.cellOrder } : {}),
  });
}

function plotCellKey(threadId: string | null, manuscriptRecordId: string | null): string | null {
  if (!threadId || !manuscriptRecordId) return null;
  return `${threadId}::${manuscriptRecordId}`;
}

/**
 * Move a beat between plot-grid cells (or to Unplaced) and renumber cellOrder in
 * the affected stacks. Never calls moveInBook; freeform x/y are left unchanged.
 */
export async function relocateWeaveBeat(
  db: Db,
  projectId: string,
  gridId: string,
  beatId: string,
  input: { threadId: string | null; manuscriptRecordId: string | null; cellOrder: number },
): Promise<WeaveBeatView[]> {
  return db.$transaction(async (tx) => {
    await requireGrid(tx, projectId, gridId);
    const moving = await tx.weaveBeat.findFirst({ where: { id: beatId, gridId, projectId } });
    if (!moving) throw rejected("That beat is not on this Weave grid.");

    const destThreadId = input.threadId ? await requireThread(tx, projectId, gridId, input.threadId) : null;
    const destManuscriptId = input.manuscriptRecordId
      ? await requireManuscriptLink(tx, projectId, input.manuscriptRecordId)
      : null;
    const insertAt = Math.max(0, Math.round(input.cellOrder));

    const all = await tx.weaveBeat.findMany({ where: { gridId, projectId } });
    const srcKey = plotCellKey(moving.threadId, moving.manuscriptRecordId);
    const destKey = plotCellKey(destThreadId, destManuscriptId);

    const stacks = new Map<string, typeof all>();
    for (const beat of all) {
      if (beat.id === beatId) continue;
      const key = plotCellKey(beat.threadId, beat.manuscriptRecordId);
      if (!key) continue;
      const list = stacks.get(key) ?? [];
      list.push(beat);
      stacks.set(key, list);
    }
    for (const list of stacks.values()) {
      list.sort((a, b) => a.cellOrder - b.cellOrder || a.zIndex - b.zIndex || a.id.localeCompare(b.id));
    }

    type OrderPatch = {
      id: string;
      threadId?: string | null;
      manuscriptRecordId?: string | null;
      cellOrder: number;
    };
    const patches: OrderPatch[] = [];

    if (destKey && destThreadId && destManuscriptId) {
      const target = [...(stacks.get(destKey) ?? [])];
      const idx = Math.min(insertAt, target.length);
      target.splice(idx, 0, moving);
      target.forEach((beat, cellOrder) => {
        patches.push({
          id: beat.id,
          threadId: destThreadId,
          manuscriptRecordId: destManuscriptId,
          cellOrder,
        });
      });
      if (srcKey && srcKey !== destKey) {
        (stacks.get(srcKey) ?? []).forEach((beat, cellOrder) => {
          patches.push({ id: beat.id, cellOrder });
        });
      }
    } else {
      patches.push({
        id: beatId,
        threadId: destThreadId,
        manuscriptRecordId: destManuscriptId,
        cellOrder: insertAt,
      });
      if (srcKey) {
        (stacks.get(srcKey) ?? []).forEach((beat, cellOrder) => {
          patches.push({ id: beat.id, cellOrder });
        });
      }
    }

    for (const patch of patches) {
      await tx.weaveBeat.update({
        where: { id: patch.id },
        data: {
          cellOrder: patch.cellOrder,
          ...(patch.threadId !== undefined ? { threadId: patch.threadId } : {}),
          ...(patch.manuscriptRecordId !== undefined ? { manuscriptRecordId: patch.manuscriptRecordId } : {}),
        },
      });
    }

    await tx.weaveGrid.update({ where: { id: gridId }, data: { updatedAt: new Date() } });
    await writeAudit(tx, {
      projectId,
      action: "weave_beat.relocate",
      actor: UI_ACTOR,
      summary: `Moved a Weave beat on the plot grid`,
      details: {
        gridId,
        beatId,
        threadId: destThreadId,
        manuscriptRecordId: destManuscriptId,
        cellOrder: insertAt,
      },
    });

    const view = await getWeaveGrid(tx, projectId, gridId);
    return view.beats;
  });
}

/** Clear manuscript links / world refs / setup-payoff ends when records are permanently deleted. */
export async function clearWeaveForDeletedRecordsInTx(tx: Tx, recordIds: readonly string[]): Promise<void> {
  if (recordIds.length === 0) return;
  const ids = { in: [...recordIds] };
  await tx.weaveBeat.updateMany({ where: { manuscriptRecordId: ids }, data: { manuscriptRecordId: null } });
  await tx.weaveBeatWorldRef.deleteMany({ where: { recordId: ids } });
}
