import { newId } from "@/domain/ids";
import { errorIssue } from "@/domain/issues";
import { getWeaveBeatPreset, type WeaveBeatPreset } from "@/world/weaveBeatPresets";
import type { Db, Tx } from "../db";
import { writeAudit } from "./auditService";
import { MutationRejectedError, NotFoundError, StaleRevisionError } from "./errors";
import { createRecord } from "./recordService";
import {
  getWeaveGrid,
  isWeaveSurface,
  isWeaveViewKind,
  resolveWeaveSurface,
  WEAVE_SURFACES,
  WEAVE_VIEW_LABELS,
  type WeaveGridView,
  type WeaveSurface,
  type WeaveViewKind,
} from "./weaveService";

export { WEAVE_SURFACES, isWeaveSurface, resolveWeaveSurface, type WeaveSurface };

/*
 * Beat-sheet-first planning on existing Weave grids.
 * Adopting a starter copies framework stages into WeaveStructure /
 * WeaveStructureStage. Author story ideas stay WeaveBeat rows and link
 * explicitly via WeaveStageIdea. Starter updates never overwrite adopted copies.
 * Removing a structure clears stage links only — ideas and manuscript stay.
 */

const UI_ACTOR = "author";

function rejected(message: string, code: "INVALID_CHANGE" | "INVALID_REFERENCE" = "INVALID_CHANGE"): MutationRejectedError {
  return new MutationRejectedError([errorIssue(code, message)]);
}

function staleIdea(message: string) {
  // Client keeps the unsaved local text when this fails — do not clear the form.
  return new StaleRevisionError(errorIssue("STALE_REVISION", message));
}

export interface WeaveStageIdeaView {
  linkId: string;
  beatId: string;
  title: string;
  body: string;
  contentRevision: number;
  position: number;
  /** How many stages (any structure on this grid) share this idea. */
  sharedStageCount: number;
}

export interface WeaveStructureStageView {
  id: string;
  structureId: string;
  stageKey: string;
  title: string;
  guidance: string;
  notes: string;
  groupKey: string;
  groupTitle: string;
  position: number;
  contentRevision: number;
  ideas: WeaveStageIdeaView[];
}

export interface WeaveStructureView {
  id: string;
  gridId: string;
  sourcePresetId: string;
  sourceVersion: number;
  title: string;
  description: string;
  attribution: string;
  position: number;
  contentRevision: number;
  createdAt: Date;
  updatedAt: Date;
  stages: WeaveStructureStageView[];
}

export interface WeavePlanningRowView {
  id: string;
  gridId: string;
  title: string;
  position: number;
  contentRevision: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface WeavePlanPlanningView {
  grid: WeaveGridView;
  surface: WeaveSurface;
  structures: WeaveStructureView[];
  planningRows: WeavePlanningRowView[];
}

async function requireLiveGrid(tx: Tx, projectId: string, gridId: string) {
  const grid = await tx.weaveGrid.findFirst({ where: { id: gridId, projectId } });
  if (!grid) throw new NotFoundError(`Weave grid ${gridId} not found`);
  if (!isWeaveViewKind(grid.viewKind)) throw rejected("Unknown Weave view kind.");
  return grid as typeof grid & { viewKind: WeaveViewKind };
}

function stageKeyFor(preset: WeaveBeatPreset, index: number, beatKey: string): string {
  const key = beatKey.trim() || `stage-${index + 1}`;
  return key;
}

async function loadStructures(tx: Tx, projectId: string, gridId: string): Promise<WeaveStructureView[]> {
  const structures = await tx.weaveStructure.findMany({
    where: { gridId, projectId },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    include: {
      stages: {
        orderBy: [{ position: "asc" }, { id: "asc" }],
        include: {
          ideas: {
            orderBy: [{ position: "asc" }, { id: "asc" }],
            include: { beat: { select: { id: true, title: true, body: true, contentRevision: true } } },
          },
        },
      },
    },
  });
  const shareCounts = new Map<string, number>();
  for (const structure of structures) {
    for (const stage of structure.stages) {
      for (const link of stage.ideas) {
        shareCounts.set(link.beatId, (shareCounts.get(link.beatId) ?? 0) + 1);
      }
    }
  }
  return structures.map((structure) => ({
    id: structure.id,
    gridId: structure.gridId,
    sourcePresetId: structure.sourcePresetId,
    sourceVersion: structure.sourceVersion,
    title: structure.title,
    description: structure.description,
    attribution: structure.attribution,
    position: structure.position,
    contentRevision: structure.contentRevision,
    createdAt: structure.createdAt,
    updatedAt: structure.updatedAt,
    stages: structure.stages.map((stage) => ({
      id: stage.id,
      structureId: stage.structureId,
      stageKey: stage.stageKey,
      title: stage.title,
      guidance: stage.guidance,
      notes: stage.notes,
      groupKey: stage.groupKey,
      groupTitle: stage.groupTitle,
      position: stage.position,
      contentRevision: stage.contentRevision,
      ideas: stage.ideas.map((link) => ({
        linkId: link.id,
        beatId: link.beat.id,
        title: link.beat.title,
        body: link.beat.body,
        contentRevision: link.beat.contentRevision,
        position: link.position,
        sharedStageCount: shareCounts.get(link.beat.id) ?? 1,
      })),
    })),
  }));
}

async function loadPlanningRows(tx: Tx, projectId: string, gridId: string): Promise<WeavePlanningRowView[]> {
  const rows = await tx.weavePlanningRow.findMany({
    where: { gridId, projectId },
    orderBy: [{ position: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    gridId: row.gridId,
    title: row.title,
    position: row.position,
    contentRevision: row.contentRevision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export async function getWeavePlanPlanning(db: Db, projectId: string, gridId: string): Promise<WeavePlanPlanningView> {
  const grid = await getWeaveGrid(db, projectId, gridId);
  const row = await db.weaveGrid.findFirst({
    where: { id: gridId, projectId },
    select: { preferredSurface: true, layoutMode: true },
  });
  if (!row) throw new NotFoundError(`Weave grid ${gridId} not found`);
  const [structures, planningRows] = await Promise.all([
    loadStructures(db, projectId, gridId),
    loadPlanningRows(db, projectId, gridId),
  ]);
  return {
    grid,
    surface: resolveWeaveSurface(row),
    structures,
    planningRows,
  };
}

export type AdoptStructuresResult =
  | { ok: true; gridId: string; structureIds: string[]; preferredSurface: WeaveSurface }
  | { ok: false; needsDuplicateConfirm: true; duplicates: { presetId: string; title: string }[] };

/**
 * Atomically adopt one or more starters onto a plan.
 * Does not create story ideas or reinterpret existing beat prose as guidance.
 * Existing grids keep their preferredSurface unless this is the first structure
 * adoption and surface was legacy-null — then beat_sheet is set.
 * Pass confirmDuplicates to intentionally adopt a starter already on the plan.
 */
export async function adoptWeaveStructures(
  db: Db,
  projectId: string,
  input: {
    presetIds: string[];
    /** Existing grid, or omit with viewKind to create a new plan. */
    gridId?: string;
    viewKind?: WeaveViewKind;
    title?: string;
    confirmDuplicates?: boolean;
    /** Client token to make double-submit safe within one plan. */
    clientRequestId?: string;
  },
): Promise<AdoptStructuresResult> {
  const presetIds = [...new Set(input.presetIds.map((id) => id.trim()).filter(Boolean))];
  if (!presetIds.length) throw rejected("Choose at least one story structure.");
  const presets: WeaveBeatPreset[] = [];
  for (const id of presetIds) {
    const preset = getWeaveBeatPreset(id);
    if (!preset) throw rejected(`Unknown beat sheet: ${id}.`);
    presets.push(preset);
  }

  return db.$transaction(async (tx) => {
    const project = await tx.project.findFirst({
      where: { id: projectId, trashedAt: null },
      select: { id: true },
    });
    if (!project) throw new NotFoundError(`Project ${projectId} not found`);

    let gridId = input.gridId?.trim() || "";
    let createdGrid = false;
    if (gridId) {
      await requireLiveGrid(tx, projectId, gridId);
    } else {
      const viewKind = input.viewKind ?? "original";
      if (!isWeaveViewKind(viewKind)) throw rejected("Unknown Weave view kind.");
      gridId = newId("wvg");
      const title =
        input.title?.trim() ||
        (presets.length === 1 ? presets[0]!.title : WEAVE_VIEW_LABELS[viewKind]);
      await tx.weaveGrid.create({
        data: {
          id: gridId,
          projectId,
          title,
          viewKind,
          layoutMode: "plot_grid",
          preferredSurface: "beat_sheet",
        },
      });
      createdGrid = true;
    }

    if (input.clientRequestId?.trim()) {
      const token = input.clientRequestId.trim().slice(0, 80);
      const prior = await tx.auditEntry.findFirst({
        where: {
          projectId,
          action: "weave_structure.adopt",
          detailsJson: { contains: `"clientRequestId":"${token}"` },
        },
        orderBy: { createdAt: "desc" },
      });
      if (prior) {
        const details = (() => {
          try {
            return JSON.parse(prior.detailsJson) as { gridId?: string; structureIds?: string[] };
          } catch {
            return {};
          }
        })();
        if (details.gridId === gridId && Array.isArray(details.structureIds) && details.structureIds.length) {
          const grid = await tx.weaveGrid.findFirstOrThrow({ where: { id: gridId } });
          return {
            ok: true as const,
            gridId,
            structureIds: details.structureIds,
            preferredSurface: resolveWeaveSurface(grid),
          };
        }
      }
    }

    const existing = await tx.weaveStructure.findMany({
      where: { gridId, projectId, sourcePresetId: { in: presets.map((p) => p.id) } },
      select: { sourcePresetId: true, title: true },
    });
    if (existing.length && !input.confirmDuplicates) {
      const seen = new Map(existing.map((row) => [row.sourcePresetId, row.title]));
      return {
        ok: false as const,
        needsDuplicateConfirm: true,
        duplicates: presets
          .filter((preset) => seen.has(preset.id))
          .map((preset) => ({ presetId: preset.id, title: seen.get(preset.id) ?? preset.title })),
      };
    }

    const maxPos = await tx.weaveStructure.aggregate({ where: { gridId }, _max: { position: true } });
    let nextPos = (maxPos._max.position ?? -1) + 1;
    const structureIds: string[] = [];
    const threadTitle = new Map<string, string>();

    for (const preset of presets) {
      for (const thread of preset.threads) threadTitle.set(thread.key, thread.title);
      const structureId = newId("wst");
      structureIds.push(structureId);
      await tx.weaveStructure.create({
        data: {
          id: structureId,
          gridId,
          projectId,
          sourcePresetId: preset.id,
          sourceVersion: preset.version,
          title: preset.title,
          description: preset.description,
          attribution: preset.attribution,
          position: nextPos,
        },
      });
      nextPos += 1;
      for (const [index, beat] of preset.beats.entries()) {
        await tx.weaveStructureStage.create({
          data: {
            id: newId("wss"),
            structureId,
            gridId,
            projectId,
            stageKey: stageKeyFor(preset, index, beat.key),
            title: beat.title,
            guidance: beat.prompt,
            notes: "",
            groupKey: beat.threadKey,
            groupTitle: threadTitle.get(beat.threadKey) ?? beat.threadKey,
            position: index,
          },
        });
      }
    }

    const grid = await tx.weaveGrid.findFirstOrThrow({ where: { id: gridId } });
    // New structure-based plans open Beat sheet. Existing plans keep their surface
    // (null preferredSurface → legacy freeform / chapter grid). Never silently
    // switch an old plan's default view.
    if (createdGrid) {
      await tx.weaveGrid.update({
        where: { id: gridId },
        data: { preferredSurface: "beat_sheet", layoutMode: "plot_grid", updatedAt: new Date() },
      });
    } else {
      await tx.weaveGrid.update({ where: { id: gridId }, data: { updatedAt: new Date() } });
    }
    const preferredSurface = createdGrid ? "beat_sheet" : resolveWeaveSurface(grid);

    await writeAudit(tx, {
      projectId,
      action: "weave_structure.adopt",
      actor: UI_ACTOR,
      summary:
        presets.length === 1
          ? `Adopted structure “${presets[0]!.title}”`
          : `Adopted ${presets.length} story structures`,
      details: {
        gridId,
        structureIds,
        presetIds: presets.map((p) => p.id),
        createdGrid,
        preferredSurface,
        ...(input.clientRequestId?.trim() ? { clientRequestId: input.clientRequestId.trim().slice(0, 80) } : {}),
      },
    });

    return { ok: true as const, gridId, structureIds, preferredSurface };
  });
}

export interface RemoveStructurePreview {
  structureId: string;
  title: string;
  stageCount: number;
  linkCount: number;
  distinctIdeaCount: number;
  message: string;
}

export async function previewRemoveWeaveStructure(
  db: Db,
  projectId: string,
  structureId: string,
): Promise<RemoveStructurePreview> {
  const structure = await db.weaveStructure.findFirst({
    where: { id: structureId, projectId },
    include: { stages: { include: { ideas: { select: { beatId: true } } } } },
  });
  if (!structure) throw new NotFoundError(`Weave structure ${structureId} not found`);
  const beatIds = new Set<string>();
  let linkCount = 0;
  for (const stage of structure.stages) {
    for (const link of stage.ideas) {
      linkCount += 1;
      beatIds.add(link.beatId);
    }
  }
  return {
    structureId: structure.id,
    title: structure.title,
    stageCount: structure.stages.length,
    linkCount,
    distinctIdeaCount: beatIds.size,
    message: `Remove “${structure.title}”? ${beatIds.size} story idea${beatIds.size === 1 ? "" : "s"} and all manuscript records stay. ${linkCount} stage link${linkCount === 1 ? "" : "s"} will be cleared.`,
  };
}

/** Removes the structure and its stages/links. Story ideas and manuscript records stay. */
export async function removeWeaveStructure(db: Db, projectId: string, structureId: string): Promise<RemoveStructurePreview> {
  const preview = await previewRemoveWeaveStructure(db, projectId, structureId);
  await db.$transaction(async (tx) => {
    const structure = await tx.weaveStructure.findFirst({ where: { id: structureId, projectId } });
    if (!structure) throw new NotFoundError(`Weave structure ${structureId} not found`);
    const stageIds = (
      await tx.weaveStructureStage.findMany({ where: { structureId }, select: { id: true } })
    ).map((s) => s.id);
    if (stageIds.length) {
      await tx.weaveStageIdea.deleteMany({ where: { stageId: { in: stageIds } } });
      await tx.weaveStructureStage.deleteMany({ where: { structureId } });
    }
    await tx.weaveStructure.delete({ where: { id: structureId } });
    await tx.weaveGrid.update({ where: { id: structure.gridId }, data: { updatedAt: new Date() } });
    await writeAudit(tx, {
      projectId,
      action: "weave_structure.remove",
      actor: UI_ACTOR,
      summary: `Removed structure “${structure.title}”`,
      details: {
        gridId: structure.gridId,
        structureId,
        ideasKept: preview.distinctIdeaCount,
        linksCleared: preview.linkCount,
        stagesRemoved: preview.stageCount,
      },
    });
  });
  return preview;
}

/**
 * Author-defined structure on a plan. sourcePresetId is "custom" so it never
 * collides with curated starter IDs. Stages keep optional group titles.
 */
export async function createCustomWeaveStructure(
  db: Db,
  projectId: string,
  gridId: string,
  input: {
    title: string;
    attribution?: string;
    description?: string;
    stages: Array<{ title: string; guidance?: string; groupKey?: string; groupTitle?: string }>;
  },
): Promise<WeaveStructureView> {
  const title = input.title.trim();
  if (!title) throw rejected("Name the custom structure.");
  const stages = input.stages
    .map((stage, index) => ({
      title: stage.title.trim(),
      guidance: (stage.guidance ?? "").trim(),
      groupKey: (stage.groupKey ?? stage.groupTitle ?? "").trim().toLowerCase().replace(/\s+/g, "-") || `group-${index}`,
      groupTitle: (stage.groupTitle ?? "").trim(),
      index,
    }))
    .filter((stage) => stage.title.length > 0);
  if (!stages.length) throw rejected("Add at least one stage with a title.");

  return db.$transaction(async (tx) => {
    await requireLiveGrid(tx, projectId, gridId);
    const maxPos = await tx.weaveStructure.aggregate({ where: { gridId }, _max: { position: true } });
    const structureId = newId("wst");
    await tx.weaveStructure.create({
      data: {
        id: structureId,
        gridId,
        projectId,
        sourcePresetId: "custom",
        sourceVersion: 1,
        title,
        description: (input.description ?? "").trim(),
        attribution: (input.attribution ?? "").trim(),
        position: (maxPos._max.position ?? -1) + 1,
      },
    });
    for (const stage of stages) {
      await tx.weaveStructureStage.create({
        data: {
          id: newId("wss"),
          structureId,
          gridId,
          projectId,
          stageKey: `custom-${stage.index}-${stage.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "stage"}`,
          title: stage.title,
          guidance: stage.guidance,
          notes: "",
          groupKey: stage.groupKey,
          groupTitle: stage.groupTitle,
          position: stage.index,
        },
      });
    }
    await tx.weaveGrid.update({ where: { id: gridId }, data: { updatedAt: new Date() } });
    await writeAudit(tx, {
      projectId,
      action: "weave_structure.custom",
      actor: UI_ACTOR,
      summary: `Created custom structure “${title}”`,
      details: { gridId, structureId, stageCount: stages.length },
    });
    const list = await loadStructures(tx, projectId, gridId);
    const found = list.find((row) => row.id === structureId);
    if (!found) throw rejected("Custom structure missing after save.");
    return found;
  });
}

export async function setWeavePreferredSurface(
  db: Db,
  projectId: string,
  gridId: string,
  surface: WeaveSurface,
): Promise<WeaveSurface> {
  if (!isWeaveSurface(surface)) throw rejected("Unknown plan view.");
  return db.$transaction(async (tx) => {
    const grid = await requireLiveGrid(tx, projectId, gridId);
    const layoutMode =
      surface === "freeform" ? "freeform" : surface === "beat_sheet" ? grid.layoutMode : "plot_grid";
    await tx.weaveGrid.update({
      where: { id: gridId },
      data: { preferredSurface: surface, layoutMode },
    });
    await writeAudit(tx, {
      projectId,
      action: "weave_grid.surface",
      actor: UI_ACTOR,
      summary: `Set Weave view to ${surface}`,
      details: { gridId, preferredSurface: surface, layoutMode },
    });
    return surface;
  });
}

export async function updateWeaveStageNotes(
  db: Db,
  projectId: string,
  stageId: string,
  input: { notes: string; expectedRevision: number },
): Promise<WeaveStructureStageView> {
  return db.$transaction(async (tx) => {
    const stage = await tx.weaveStructureStage.findFirst({ where: { id: stageId, projectId } });
    if (!stage) throw new NotFoundError(`Weave stage ${stageId} not found`);
    if (stage.contentRevision !== input.expectedRevision) {
      throw staleIdea("This stage's notes changed elsewhere. Your local notes were kept.");
    }
    await tx.weaveStructureStage.update({
      where: { id: stageId },
      data: { notes: input.notes, contentRevision: stage.contentRevision + 1 },
    });
    await tx.weaveGrid.update({ where: { id: stage.gridId }, data: { updatedAt: new Date() } });
    await writeAudit(tx, {
      projectId,
      action: "weave_stage.notes",
      actor: UI_ACTOR,
      summary: `Updated notes on “${stage.title}”`,
      details: { gridId: stage.gridId, stageId, contentRevision: stage.contentRevision + 1 },
    });
    const structures = await loadStructures(tx, projectId, stage.gridId);
    const found = structures.flatMap((s) => s.stages).find((s) => s.id === stageId);
    if (!found) throw rejected("That stage is missing after save.");
    return found;
  });
}

export async function updateWeaveIdeaText(
  db: Db,
  projectId: string,
  beatId: string,
  input: { title?: string; body?: string; expectedRevision: number },
): Promise<{ beatId: string; title: string; body: string; contentRevision: number }> {
  return db.$transaction(async (tx) => {
    const beat = await tx.weaveBeat.findFirst({ where: { id: beatId, projectId } });
    if (!beat) throw new NotFoundError(`Weave beat ${beatId} not found`);
    if (beat.contentRevision !== input.expectedRevision) {
      throw staleIdea("This story idea changed elsewhere. Your local text was kept.");
    }
    const data: { title?: string; body?: string; contentRevision: number } = {
      contentRevision: beat.contentRevision + 1,
    };
    if (typeof input.title === "string") {
      const title = input.title.trim();
      if (!title) throw rejected("Give the story idea a title.");
      data.title = title;
    }
    if (typeof input.body === "string") data.body = input.body;
    await tx.weaveBeat.update({ where: { id: beatId }, data });
    await tx.weaveGrid.update({ where: { id: beat.gridId }, data: { updatedAt: new Date() } });
    await writeAudit(tx, {
      projectId,
      action: "weave_idea.update",
      actor: UI_ACTOR,
      summary: `Updated story idea “${data.title ?? beat.title}”`,
      details: { gridId: beat.gridId, beatId, contentRevision: data.contentRevision },
    });
    const next = await tx.weaveBeat.findFirstOrThrow({ where: { id: beatId } });
    return {
      beatId: next.id,
      title: next.title,
      body: next.body,
      contentRevision: next.contentRevision,
    };
  });
}

export async function addIdeaToWeaveStage(
  db: Db,
  projectId: string,
  stageId: string,
  input: { title?: string; body?: string; existingBeatId?: string },
): Promise<WeaveStageIdeaView> {
  return db.$transaction(async (tx) => {
    const stage = await tx.weaveStructureStage.findFirst({ where: { id: stageId, projectId } });
    if (!stage) throw new NotFoundError(`Weave stage ${stageId} not found`);
    let beatId = input.existingBeatId?.trim() || "";
    if (beatId) {
      const beat = await tx.weaveBeat.findFirst({ where: { id: beatId, projectId, gridId: stage.gridId } });
      if (!beat) throw rejected("That story idea is not on this plan.");
    } else {
      beatId = newId("wvb");
      const title = input.title?.trim() || "Story idea";
      const maxZ = await tx.weaveBeat.aggregate({ where: { gridId: stage.gridId }, _max: { zIndex: true } });
      await tx.weaveBeat.create({
        data: {
          id: beatId,
          gridId: stage.gridId,
          projectId,
          title,
          body: input.body ?? "",
          x: 48,
          y: 48 + stage.position * 24,
          zIndex: (maxZ._max.zIndex ?? -1) + 1,
          contentRevision: 1,
        },
      });
    }
    const existing = await tx.weaveStageIdea.findUnique({
      where: { stageId_beatId: { stageId, beatId } },
    });
    if (existing) throw rejected("That idea is already linked to this stage.");
    const maxPos = await tx.weaveStageIdea.aggregate({ where: { stageId }, _max: { position: true } });
    const linkId = newId("wsi");
    await tx.weaveStageIdea.create({
      data: {
        id: linkId,
        stageId,
        beatId,
        projectId,
        position: (maxPos._max.position ?? -1) + 1,
      },
    });
    await tx.weaveGrid.update({ where: { id: stage.gridId }, data: { updatedAt: new Date() } });
    await writeAudit(tx, {
      projectId,
      action: "weave_stage.idea_link",
      actor: UI_ACTOR,
      summary: `Linked a story idea to “${stage.title}”`,
      details: { gridId: stage.gridId, stageId, beatId, linkId },
    });
    const structures = await loadStructures(tx, projectId, stage.gridId);
    const found = structures
      .flatMap((s) => s.stages)
      .flatMap((s) => s.ideas)
      .find((idea) => idea.linkId === linkId);
    if (!found) throw rejected("Link missing after save.");
    return found;
  });
}

export async function unlinkIdeaFromWeaveStage(
  db: Db,
  projectId: string,
  stageId: string,
  beatId: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const stage = await tx.weaveStructureStage.findFirst({ where: { id: stageId, projectId } });
    if (!stage) throw new NotFoundError(`Weave stage ${stageId} not found`);
    const link = await tx.weaveStageIdea.findUnique({
      where: { stageId_beatId: { stageId, beatId } },
    });
    if (!link) throw rejected("That idea is not linked to this stage.");
    await tx.weaveStageIdea.delete({ where: { id: link.id } });
    await tx.weaveGrid.update({ where: { id: stage.gridId }, data: { updatedAt: new Date() } });
    await writeAudit(tx, {
      projectId,
      action: "weave_stage.idea_unlink",
      actor: UI_ACTOR,
      summary: `Unlinked a story idea from “${stage.title}”`,
      details: { gridId: stage.gridId, stageId, beatId },
    });
  });
}

/** Clone the idea's title/body into a new beat and replace the link on this stage. */
export async function forkIdeaOnWeaveStage(
  db: Db,
  projectId: string,
  stageId: string,
  beatId: string,
): Promise<WeaveStageIdeaView> {
  return db.$transaction(async (tx) => {
    const stage = await tx.weaveStructureStage.findFirst({ where: { id: stageId, projectId } });
    if (!stage) throw new NotFoundError(`Weave stage ${stageId} not found`);
    const link = await tx.weaveStageIdea.findUnique({
      where: { stageId_beatId: { stageId, beatId } },
    });
    if (!link) throw rejected("That idea is not linked to this stage.");
    const source = await tx.weaveBeat.findFirst({ where: { id: beatId, projectId, gridId: stage.gridId } });
    if (!source) throw rejected("That story idea is not on this plan.");
    const copyId = newId("wvb");
    const maxZ = await tx.weaveBeat.aggregate({ where: { gridId: stage.gridId }, _max: { zIndex: true } });
    await tx.weaveBeat.create({
      data: {
        id: copyId,
        gridId: stage.gridId,
        projectId,
        title: source.title,
        body: source.body,
        decision: source.decision,
        threadId: source.threadId,
        planningRowId: source.planningRowId,
        cellOrder: source.cellOrder,
        x: source.x + 16,
        y: source.y + 16,
        width: source.width,
        height: source.height,
        zIndex: (maxZ._max.zIndex ?? -1) + 1,
        contentRevision: 1,
      },
    });
    await tx.weaveStageIdea.delete({ where: { id: link.id } });
    const newLinkId = newId("wsi");
    await tx.weaveStageIdea.create({
      data: {
        id: newLinkId,
        stageId,
        beatId: copyId,
        projectId,
        position: link.position,
      },
    });
    await tx.weaveGrid.update({ where: { id: stage.gridId }, data: { updatedAt: new Date() } });
    await writeAudit(tx, {
      projectId,
      action: "weave_stage.idea_fork",
      actor: UI_ACTOR,
      summary: `Made an independent copy of “${source.title}”`,
      details: { gridId: stage.gridId, stageId, sourceBeatId: beatId, beatId: copyId },
    });
    const structures = await loadStructures(tx, projectId, stage.gridId);
    const found = structures
      .flatMap((s) => s.stages)
      .flatMap((s) => s.ideas)
      .find((idea) => idea.linkId === newLinkId);
    if (!found) throw rejected("Forked idea missing after save.");
    return found;
  });
}

export async function addWeavePlanningRow(
  db: Db,
  projectId: string,
  gridId: string,
  input: { title?: string } = {},
): Promise<WeavePlanningRowView> {
  return db.$transaction(async (tx) => {
    await requireLiveGrid(tx, projectId, gridId);
    const maxPos = await tx.weavePlanningRow.aggregate({ where: { gridId }, _max: { position: true } });
    const id = newId("wpr");
    await tx.weavePlanningRow.create({
      data: {
        id,
        gridId,
        projectId,
        title: input.title?.trim() ?? "",
        position: (maxPos._max.position ?? -1) + 1,
      },
    });
    await tx.weaveGrid.update({ where: { id: gridId }, data: { updatedAt: new Date() } });
    await writeAudit(tx, {
      projectId,
      action: "weave_planning_row.add",
      actor: UI_ACTOR,
      summary: "Added a planning moment",
      details: { gridId, planningRowId: id },
    });
    const rows = await loadPlanningRows(tx, projectId, gridId);
    return rows.find((row) => row.id === id)!;
  });
}

export async function renameWeavePlanningRow(
  db: Db,
  projectId: string,
  gridId: string,
  planningRowId: string,
  title: string,
): Promise<WeavePlanningRowView> {
  return db.$transaction(async (tx) => {
    await requireLiveGrid(tx, projectId, gridId);
    const row = await tx.weavePlanningRow.findFirst({ where: { id: planningRowId, gridId, projectId } });
    if (!row) throw rejected("That planning moment is not on this plan.");
    const nextTitle = title.trim();
    if (nextTitle !== row.title) {
      await tx.weavePlanningRow.update({
        where: { id: planningRowId },
        data: { title: nextTitle, contentRevision: row.contentRevision + 1 },
      });
      await tx.weaveGrid.update({ where: { id: gridId }, data: { updatedAt: new Date() } });
      await writeAudit(tx, {
        projectId,
        action: "weave_planning_row.rename",
        actor: UI_ACTOR,
        summary: `Renamed planning moment to “${nextTitle || "Untitled"}”`,
        details: { gridId, planningRowId, title: nextTitle },
      });
    }
    const rows = await loadPlanningRows(tx, projectId, gridId);
    return rows.find((item) => item.id === planningRowId)!;
  });
}

export async function reorderWeavePlanningRows(
  db: Db,
  projectId: string,
  gridId: string,
  orderedRowIds: string[],
): Promise<WeavePlanningRowView[]> {
  return db.$transaction(async (tx) => {
    await requireLiveGrid(tx, projectId, gridId);
    const existing = await tx.weavePlanningRow.findMany({
      where: { gridId, projectId },
      select: { id: true },
      orderBy: [{ position: "asc" }, { id: "asc" }],
    });
    const existingIds = new Set(existing.map((row) => row.id));
    if (orderedRowIds.length !== existing.length || orderedRowIds.some((id) => !existingIds.has(id))) {
      throw rejected("Planning moment list does not match this plan.");
    }
    let position = 0;
    for (const id of orderedRowIds) {
      await tx.weavePlanningRow.update({ where: { id }, data: { position: position++ } });
    }
    await tx.weaveGrid.update({ where: { id: gridId }, data: { updatedAt: new Date() } });
    await writeAudit(tx, {
      projectId,
      action: "weave_planning_row.reorder",
      actor: UI_ACTOR,
      summary: "Reordered planning moments",
      details: { gridId, orderedRowIds },
    });
    return loadPlanningRows(tx, projectId, gridId);
  });
}

export async function placeIdeaOnPlanningRow(
  db: Db,
  projectId: string,
  gridId: string,
  beatId: string,
  input: { planningRowId: string | null; threadId?: string | null; cellOrder?: number },
): Promise<void> {
  await db.$transaction(async (tx) => {
    await requireLiveGrid(tx, projectId, gridId);
    const beat = await tx.weaveBeat.findFirst({ where: { id: beatId, gridId, projectId } });
    if (!beat) throw rejected("That story idea is not on this plan.");
    let planningRowId: string | null = input.planningRowId;
    if (planningRowId) {
      const row = await tx.weavePlanningRow.findFirst({ where: { id: planningRowId, gridId, projectId } });
      if (!row) throw rejected("That planning moment is not on this plan.");
    }
    let threadId = input.threadId === undefined ? beat.threadId : input.threadId;
    if (threadId) {
      const thread = await tx.weaveThread.findFirst({ where: { id: threadId, gridId, projectId } });
      if (!thread) throw rejected("That story thread is not on this plan.");
    }
    const cellOrder =
      typeof input.cellOrder === "number" && Number.isFinite(input.cellOrder)
        ? Math.max(0, Math.round(input.cellOrder))
        : beat.cellOrder;
    await tx.weaveBeat.update({
      where: { id: beatId },
      data: { planningRowId, threadId, cellOrder },
    });
    await tx.weaveGrid.update({ where: { id: gridId }, data: { updatedAt: new Date() } });
    await writeAudit(tx, {
      projectId,
      action: "weave_idea.place_planning",
      actor: UI_ACTOR,
      summary: "Placed a story idea on the story grid",
      details: { gridId, beatId, planningRowId, threadId, cellOrder },
    });
  });
}

/**
 * Compatibility: manuscriptRecordId remains the primary single link.
 * Extra placements live in WeaveBeatManuscriptLink. Setting the primary
 * also upserts/removes the position-0 link row when the multi table is used.
 * Word counts never read beat bodies — only Record prose.
 */
export async function setWeaveIdeaManuscriptPlacements(
  db: Db,
  projectId: string,
  beatId: string,
  recordIds: string[],
): Promise<{ primaryId: string | null; recordIds: string[] }> {
  return db.$transaction(async (tx) => {
    const beat = await tx.weaveBeat.findFirst({ where: { id: beatId, projectId } });
    if (!beat) throw new NotFoundError(`Weave beat ${beatId} not found`);
    const unique = [...new Set(recordIds.map((id) => id.trim()).filter(Boolean))];
    for (const recordId of unique) {
      const record = await tx.record.findFirst({
        where: { id: recordId, projectId, trashedAt: null },
        select: { id: true, type: true },
      });
      if (!record || (record.type !== "manuscript_chapter" && record.type !== "manuscript_scene")) {
        throw rejected("Only chapters or scenes can be linked to a story idea.", "INVALID_REFERENCE");
      }
    }
    await tx.weaveBeatManuscriptLink.deleteMany({ where: { beatId } });
    for (const [position, recordId] of unique.entries()) {
      await tx.weaveBeatManuscriptLink.create({
        data: { id: newId("wml"), beatId, projectId, recordId, position },
      });
    }
    const primaryId = unique[0] ?? null;
    await tx.weaveBeat.update({ where: { id: beatId }, data: { manuscriptRecordId: primaryId } });
    await tx.weaveGrid.update({ where: { id: beat.gridId }, data: { updatedAt: new Date() } });
    await writeAudit(tx, {
      projectId,
      action: "weave_idea.manuscript_links",
      actor: UI_ACTOR,
      summary: "Updated manuscript placements for a story idea",
      details: { gridId: beat.gridId, beatId, recordIds: unique, primaryId },
    });
    return { primaryId, recordIds: unique };
  });
}

export async function listWeaveIdeaManuscriptPlacements(
  db: Db,
  projectId: string,
  beatId: string,
): Promise<string[]> {
  const beat = await db.weaveBeat.findFirst({
    where: { id: beatId, projectId },
    select: { manuscriptRecordId: true },
  });
  if (!beat) throw new NotFoundError(`Weave beat ${beatId} not found`);
  const links = await db.weaveBeatManuscriptLink.findMany({
    where: { beatId, projectId },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { recordId: true },
  });
  if (links.length) return links.map((link) => link.recordId);
  return beat.manuscriptRecordId ? [beat.manuscriptRecordId] : [];
}

export type WeavePlanChapterOp =
  | { beatId: string; action: "link"; recordId: string }
  | { beatId: string; action: "create"; title: string; draftId?: string | null };

/**
 * Explicit chapter mapping from planning ideas. Already-linked ideas are
 * skipped so retries do not create duplicate chapters. Never copies beat
 * prose into the manuscript; blank creates stay empty.
 */
export async function applyWeavePlanChapterMappings(
  db: Db,
  projectId: string,
  gridId: string,
  ops: WeavePlanChapterOp[],
): Promise<{ applied: number; skipped: number; recordIds: string[] }> {
  await getWeaveGrid(db, projectId, gridId);
  let applied = 0;
  let skipped = 0;
  const recordIds: string[] = [];
  for (const op of ops) {
    const beat = await db.weaveBeat.findFirst({ where: { id: op.beatId, gridId, projectId } });
    if (!beat) throw rejected("That story idea is not on this plan.");
    if (beat.manuscriptRecordId) {
      skipped += 1;
      recordIds.push(beat.manuscriptRecordId);
      continue;
    }
    if (op.action === "link") {
      const record = await db.record.findFirst({
        where: { id: op.recordId, projectId, trashedAt: null },
        select: { id: true, type: true },
      });
      if (!record || (record.type !== "manuscript_chapter" && record.type !== "manuscript_scene")) {
        throw rejected("Only chapters or scenes can be linked to a story idea.", "INVALID_REFERENCE");
      }
      await setWeaveIdeaManuscriptPlacements(db, projectId, beat.id, [record.id]);
      applied += 1;
      recordIds.push(record.id);
      continue;
    }
    const title = op.title.trim() || beat.title.trim() || "Chapter";
    const chapterId = newId("rec");
    await createRecord(db, projectId, {
      recordId: chapterId,
      type: "manuscript_chapter",
      title,
      body: "",
      authorityStatus: "draft",
      draftId: op.draftId ?? null,
    });
    await setWeaveIdeaManuscriptPlacements(db, projectId, beat.id, [chapterId]);
    applied += 1;
    recordIds.push(chapterId);
  }
  await writeAudit(db, {
    projectId,
    action: "weave_plan_chapters.apply",
    actor: UI_ACTOR,
    summary: `Mapped ${applied} planning idea${applied === 1 ? "" : "s"} to chapters`,
    details: { gridId, applied, skipped, recordIds },
  });
  return { applied, skipped, recordIds };
}
