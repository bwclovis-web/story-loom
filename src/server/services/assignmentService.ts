import {
  DRAFT_KIND_LABELS,
  DRAFT_KINDS,
  isDraftKind,
  isWorldScope,
  normalizeOptionalName,
  WORLD_SCOPE_LABELS,
  WORLD_SCOPES,
  type DraftKind,
  type WorldScope,
} from "@/domain/assignments";
import { newId } from "@/domain/ids";
import { errorIssue, hasErrors, type Issue } from "@/domain/issues";
import { sha256, stableStringify, type JsonValue } from "@/domain/json";
import { isWorldType } from "@/ui/world";
import type { Db, DbOrTx, Tx } from "../db";
import { writeAudit } from "./auditService";
import { MutationRejectedError, NotFoundError } from "./errors";
import { getProject } from "./projectService";
import { LIVE_PROJECT } from "./trashFilters";

export interface ManuscriptGroupInput {
  /** Keep an existing group id, or omit for a new one (preview allocates). */
  id?: string | null;
  label: string;
  position: number;
  draftKind?: DraftKind | null;
  chapterIds: string[];
}

export interface WorldScopeInput {
  recordId: string;
  scope: WorldScope | null;
}

/** Author's proposed assignments. Preview normalizes this into a canonical plan. */
export interface AssignmentProposal {
  seriesName?: string | null;
  bookName?: string | null;
  draftKind?: DraftKind | null;
  groups?: ManuscriptGroupInput[];
  worldScopes?: WorldScopeInput[];
}

export interface ManuscriptGroupPlan {
  id: string;
  label: string;
  position: number;
  draftKind: DraftKind | null;
  chapterIds: string[];
  sceneIds: string[];
}

/** Canonical plan returned by preview and required by apply. */
export interface AssignmentPlan {
  seriesName: string | null;
  bookName: string | null;
  draftKind: DraftKind | null;
  groups: ManuscriptGroupPlan[];
  worldScopes: Array<{ recordId: string; scope: WorldScope | null }>;
}

export interface AssignmentChangeSummary {
  seriesName: { from: string | null; to: string | null } | null;
  bookName: { from: string | null; to: string | null } | null;
  draftKind: { from: DraftKind | null; to: DraftKind | null } | null;
  groupsAdded: number;
  groupsRemoved: number;
  groupsRenamed: number;
  chaptersGrouped: number;
  chaptersUngrouped: number;
  worldScopeChanges: number;
  noEffectiveChange: boolean;
}

export interface AssignmentPreview {
  projectId: string;
  assignmentRevision: number;
  previewToken: string;
  plan: AssignmentPlan;
  current: AssignmentPlan;
  changes: AssignmentChangeSummary;
  issues: Issue[];
  chapters: Array<{ id: string; title: string; groupId: string | null }>;
  worldRecords: Array<{ id: string; title: string; type: string; scope: WorldScope | null }>;
}

export type ApplyAssignmentsResult =
  | { status: "applied"; assignmentRevision: number; changes: AssignmentChangeSummary }
  | { status: "already_applied"; assignmentRevision: number; changes: AssignmentChangeSummary }
  | { status: "rejected"; issues: Issue[] };

interface LiveRows {
  project: {
    id: string;
    seriesName: string | null;
    bookName: string | null;
    draftKind: string | null;
    assignmentRevision: number;
  };
  groups: Array<{ id: string; label: string; position: number; draftKind: string | null }>;
  chapters: Array<{ id: string; title: string; groupId: string | null }>;
  scenes: Array<{ id: string; title: string; parentRecordId: string | null; groupId: string | null }>;
  world: Array<{ id: string; title: string; type: string; worldScope: string | null }>;
}

async function loadLive(db: DbOrTx, projectId: string): Promise<LiveRows> {
  const project = await db.project.findFirst({
    where: { id: projectId, ...LIVE_PROJECT },
    select: {
      id: true,
      seriesName: true,
      bookName: true,
      draftKind: true,
      assignmentRevision: true,
    },
  });
  if (!project) throw new NotFoundError(`Project ${projectId} not found`);
  const [groups, chapters, scenes, world] = await Promise.all([
    db.manuscriptGroup.findMany({
      where: { projectId },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { id: true, label: true, position: true, draftKind: true },
    }),
    db.record.findMany({
      where: { projectId, type: "manuscript_chapter", trashedAt: null },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { id: true, title: true, groupId: true },
    }),
    db.record.findMany({
      where: { projectId, type: "manuscript_scene", trashedAt: null },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { id: true, title: true, parentRecordId: true, groupId: true },
    }),
    db.record.findMany({
      where: {
        projectId,
        trashedAt: null,
        type: { in: ["character_dossier", "worldbuilding", "canon_decision", "continuity_note", "reference_note"] },
      },
      orderBy: [{ title: "asc" }, { id: "asc" }],
      select: { id: true, title: true, type: true, worldScope: true },
    }),
  ]);
  return { project, groups, chapters, scenes, world };
}

function scenesByChapter(scenes: LiveRows["scenes"]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const s of scenes) {
    if (!s.parentRecordId) continue;
    const list = map.get(s.parentRecordId) ?? [];
    list.push(s.id);
    map.set(s.parentRecordId, list);
  }
  return map;
}

function currentPlan(live: LiveRows): AssignmentPlan {
  const byChapter = scenesByChapter(live.scenes);
  const chapterGroup = new Map(live.chapters.map((c) => [c.id, c.groupId]));
  return {
    seriesName: live.project.seriesName,
    bookName: live.project.bookName,
    draftKind: isDraftKind(live.project.draftKind) ? live.project.draftKind : null,
    groups: live.groups.map((g) => {
      const chapterIds = live.chapters.filter((c) => c.groupId === g.id).map((c) => c.id);
      const sceneIds = chapterIds.flatMap((id) => byChapter.get(id) ?? []);
      return {
        id: g.id,
        label: g.label,
        position: g.position,
        draftKind: isDraftKind(g.draftKind) ? g.draftKind : null,
        chapterIds,
        sceneIds,
      };
    }),
    worldScopes: live.world.map((w) => ({
      recordId: w.id,
      scope: isWorldScope(w.worldScope) ? w.worldScope : null,
    })),
  };
}

function normalizeProposal(input: AssignmentProposal, live: LiveRows): { plan: AssignmentPlan; issues: Issue[] } {
  const issues: Issue[] = [];
  const chapterIds = new Set(live.chapters.map((c) => c.id));
  const worldIds = new Set(live.world.map((w) => w.id));
  const existingGroupIds = new Set(live.groups.map((g) => g.id));
  const byChapter = scenesByChapter(live.scenes);

  const seriesName = normalizeOptionalName(input.seriesName ?? null);
  const bookName = normalizeOptionalName(input.bookName ?? null);
  let draftKind: DraftKind | null = null;
  if (input.draftKind != null && input.draftKind !== ("" as DraftKind)) {
    if (!isDraftKind(input.draftKind)) {
      issues.push(errorIssue("SCHEMA_INVALID", `Draft must be ${DRAFT_KINDS.map((k) => DRAFT_KIND_LABELS[k]).join(" or ")}, or none.`));
    } else {
      draftKind = input.draftKind;
    }
  }

  const seenChapters = new Set<string>();
  const groupsIn = [...(input.groups ?? [])].sort((a, b) => a.position - b.position || a.label.localeCompare(b.label));
  const groups: ManuscriptGroupPlan[] = [];
  for (const [i, g] of groupsIn.entries()) {
    const label = g.label.trim();
    if (!label) {
      issues.push(errorIssue("SCHEMA_INVALID", `Group ${i + 1} needs a name.`, { path: `groups.${i}.label` }));
      continue;
    }
    let groupDraft: DraftKind | null = null;
    if (g.draftKind != null && g.draftKind !== ("" as DraftKind)) {
      if (!isDraftKind(g.draftKind)) {
        issues.push(errorIssue("SCHEMA_INVALID", `Group "${label}" has an unknown draft kind.`, { path: `groups.${i}.draftKind` }));
      } else {
        groupDraft = g.draftKind;
      }
    }
    const chapterList: string[] = [];
    for (const id of g.chapterIds) {
      if (!chapterIds.has(id)) {
        issues.push(errorIssue("RECORD_NOT_FOUND", `Chapter ${id} is missing or not a chapter of this project.`, { recordId: id }));
        continue;
      }
      if (seenChapters.has(id)) {
        issues.push(errorIssue("DUPLICATE_TARGET", `Chapter ${id} is listed in more than one group.`, { recordId: id }));
        continue;
      }
      seenChapters.add(id);
      chapterList.push(id);
    }
    let id = g.id?.trim() || "";
    if (id) {
      if (!id.startsWith("grp_")) {
        issues.push(errorIssue("SCHEMA_INVALID", `Group id "${id}" is not a manuscript group id.`, { path: `groups.${i}.id` }));
      }
    } else {
      id = newId("grp");
    }
    if (existingGroupIds.has(id) || !g.id) {
      // ok: existing or freshly allocated
    }
    groups.push({
      id,
      label,
      position: i,
      draftKind: groupDraft,
      chapterIds: chapterList,
      sceneIds: chapterList.flatMap((cid) => byChapter.get(cid) ?? []),
    });
  }

  const worldScopes: AssignmentPlan["worldScopes"] = [];
  const seenWorld = new Set<string>();
  for (const [i, w] of (input.worldScopes ?? []).entries()) {
    if (seenWorld.has(w.recordId)) {
      issues.push(errorIssue("DUPLICATE_TARGET", `World record ${w.recordId} is listed more than once.`, { recordId: w.recordId }));
      continue;
    }
    seenWorld.add(w.recordId);
    if (!worldIds.has(w.recordId)) {
      issues.push(
        errorIssue("RECORD_NOT_FOUND", `World record ${w.recordId} is missing or is not a World reference.`, {
          recordId: w.recordId,
          path: `worldScopes.${i}.recordId`,
        }),
      );
      continue;
    }
    if (w.scope != null && !isWorldScope(w.scope)) {
      issues.push(
        errorIssue("SCHEMA_INVALID", `World scope must be ${WORLD_SCOPES.map((s) => WORLD_SCOPE_LABELS[s]).join(" or ")}, or none.`, {
          recordId: w.recordId,
        }),
      );
      continue;
    }
    worldScopes.push({ recordId: w.recordId, scope: w.scope });
  }
  // World records omitted from the proposal keep their current scope.
  for (const w of live.world) {
    if (!seenWorld.has(w.id)) {
      worldScopes.push({ recordId: w.id, scope: isWorldScope(w.worldScope) ? w.worldScope : null });
    }
  }
  worldScopes.sort((a, b) => a.recordId.localeCompare(b.recordId));

  return {
    plan: { seriesName, bookName, draftKind, groups, worldScopes },
    issues,
  };
}

function comparable(plan: AssignmentPlan) {
  return {
    seriesName: plan.seriesName,
    bookName: plan.bookName,
    draftKind: plan.draftKind,
    groups: plan.groups.map((g) => ({
      id: g.id,
      label: g.label,
      position: g.position,
      draftKind: g.draftKind,
      chapterIds: [...g.chapterIds].sort(),
      sceneIds: [...g.sceneIds].sort(),
    })),
    worldScopes: [...plan.worldScopes].sort((a, b) => a.recordId.localeCompare(b.recordId)),
  };
}

function plansEqual(a: AssignmentPlan, b: AssignmentPlan): boolean {
  return stableStringify(comparable(a)) === stableStringify(comparable(b));
}

function summarizeChanges(from: AssignmentPlan, to: AssignmentPlan): AssignmentChangeSummary {
  const fromGroups = new Map(from.groups.map((g) => [g.id, g]));
  const toGroups = new Map(to.groups.map((g) => [g.id, g]));
  let groupsAdded = 0;
  let groupsRemoved = 0;
  let groupsRenamed = 0;
  for (const id of toGroups.keys()) {
    if (!fromGroups.has(id)) groupsAdded += 1;
    else if (fromGroups.get(id)!.label !== toGroups.get(id)!.label) groupsRenamed += 1;
  }
  for (const id of fromGroups.keys()) {
    if (!toGroups.has(id)) groupsRemoved += 1;
  }
  const fromChapterGroup = new Map<string, string | null>();
  for (const g of from.groups) for (const c of g.chapterIds) fromChapterGroup.set(c, g.id);
  const toChapterGroup = new Map<string, string | null>();
  for (const g of to.groups) for (const c of g.chapterIds) toChapterGroup.set(c, g.id);
  const allChapters = new Set([...fromChapterGroup.keys(), ...toChapterGroup.keys()]);
  let chaptersGrouped = 0;
  let chaptersUngrouped = 0;
  for (const id of allChapters) {
    const a = fromChapterGroup.get(id) ?? null;
    const b = toChapterGroup.get(id) ?? null;
    if (a === b) continue;
    if (b && !a) chaptersGrouped += 1;
    else if (a && !b) chaptersUngrouped += 1;
    else {
      chaptersGrouped += 1; // moved between groups
    }
  }
  const fromWorld = new Map(from.worldScopes.map((w) => [w.recordId, w.scope]));
  const toWorld = new Map(to.worldScopes.map((w) => [w.recordId, w.scope]));
  let worldScopeChanges = 0;
  for (const id of new Set([...fromWorld.keys(), ...toWorld.keys()])) {
    if ((fromWorld.get(id) ?? null) !== (toWorld.get(id) ?? null)) worldScopeChanges += 1;
  }
  const seriesName =
    from.seriesName === to.seriesName ? null : { from: from.seriesName, to: to.seriesName };
  const bookName = from.bookName === to.bookName ? null : { from: from.bookName, to: to.bookName };
  const draftKind = from.draftKind === to.draftKind ? null : { from: from.draftKind, to: to.draftKind };
  const noEffectiveChange =
    !seriesName &&
    !bookName &&
    !draftKind &&
    groupsAdded === 0 &&
    groupsRemoved === 0 &&
    groupsRenamed === 0 &&
    chaptersGrouped === 0 &&
    chaptersUngrouped === 0 &&
    worldScopeChanges === 0;
  return {
    seriesName,
    bookName,
    draftKind,
    groupsAdded,
    groupsRemoved,
    groupsRenamed,
    chaptersGrouped,
    chaptersUngrouped,
    worldScopeChanges,
    noEffectiveChange,
  };
}

function previewToken(live: LiveRows, plan: AssignmentPlan): string {
  return sha256(
    stableStringify({
      assignmentRevision: live.project.assignmentRevision,
      chapterIds: live.chapters.map((c) => c.id).sort(),
      worldIds: live.world.map((w) => w.id).sort(),
      plan: comparable(plan),
    }),
  );
}

/** Read-only preview. Writes nothing. Returns a token that apply must present. */
export async function previewAssignments(db: DbOrTx, projectId: string, proposal: AssignmentProposal): Promise<AssignmentPreview> {
  await getProject(db, projectId);
  const live = await loadLive(db, projectId);
  const { plan, issues } = normalizeProposal(proposal, live);
  const current = currentPlan(live);
  const changes = summarizeChanges(current, plan);
  return {
    projectId,
    assignmentRevision: live.project.assignmentRevision,
    previewToken: hasErrors(issues) ? "" : previewToken(live, plan),
    plan,
    current,
    changes,
    issues,
    chapters: live.chapters,
    worldRecords: live.world.map((w) => ({
      id: w.id,
      title: w.title,
      type: w.type,
      scope: isWorldScope(w.worldScope) ? w.worldScope : null,
    })),
  };
}

/** Current assignments for the upgrade form (no proposal). */
export async function getAssignmentSnapshot(db: DbOrTx, projectId: string): Promise<AssignmentPreview> {
  await getProject(db, projectId);
  const live = await loadLive(db, projectId);
  const current = currentPlan(live);
  return previewAssignments(db, projectId, {
    seriesName: current.seriesName,
    bookName: current.bookName,
    draftKind: current.draftKind,
    groups: current.groups.map((g) => ({
      id: g.id,
      label: g.label,
      position: g.position,
      draftKind: g.draftKind,
      chapterIds: g.chapterIds,
    })),
    worldScopes: current.worldScopes,
  });
}

async function applyInTx(
  tx: Tx,
  projectId: string,
  plan: AssignmentPlan,
  previewTokenValue: string,
  actor: string,
): Promise<ApplyAssignmentsResult> {
  const live = await loadLive(tx, projectId);
  const { plan: normalized, issues } = normalizeProposal(
    {
      seriesName: plan.seriesName,
      bookName: plan.bookName,
      draftKind: plan.draftKind,
      groups: plan.groups.map((g) => ({
        id: g.id,
        label: g.label,
        position: g.position,
        draftKind: g.draftKind,
        chapterIds: g.chapterIds,
      })),
      worldScopes: plan.worldScopes,
    },
    live,
  );
  if (hasErrors(issues)) return { status: "rejected", issues };

  // Group ids in the plan must match what preview allocated (no silent reallocation on apply).
  const plannedIds = plan.groups.map((g) => g.id).sort().join(",");
  const normalizedIds = normalized.groups.map((g) => g.id).sort().join(",");
  if (plannedIds !== normalizedIds || stableStringify(comparable(plan)) !== stableStringify(comparable(normalized))) {
    return {
      status: "rejected",
      issues: [
        errorIssue(
          "STALE_PREVIEW",
          "This preview no longer matches the project. Chapters or World records may have changed. Preview again, then apply.",
        ),
      ],
    };
  }

  const token = previewToken(live, normalized);
  if (!previewTokenValue || token !== previewTokenValue) {
    return {
      status: "rejected",
      issues: [
        errorIssue(
          "STALE_PREVIEW",
          "This preview is out of date. Preview again, then apply the new summary.",
        ),
      ],
    };
  }

  const current = currentPlan(live);
  const changes = summarizeChanges(current, normalized);
  if (changes.noEffectiveChange || plansEqual(current, normalized)) {
    return { status: "already_applied", assignmentRevision: live.project.assignmentRevision, changes };
  }

  const keepGroupIds = new Set(normalized.groups.map((g) => g.id));
  const existing = new Map(live.groups.map((g) => [g.id, g]));

  // Clear group links on records whose group is going away, then delete those groups.
  const removeIds = live.groups.filter((g) => !keepGroupIds.has(g.id)).map((g) => g.id);
  if (removeIds.length) {
    await tx.record.updateMany({ where: { projectId, groupId: { in: removeIds } }, data: { groupId: null } });
    await tx.manuscriptGroup.deleteMany({ where: { id: { in: removeIds }, projectId } });
  }

  for (const g of normalized.groups) {
    if (existing.has(g.id)) {
      await tx.manuscriptGroup.update({
        where: { id: g.id },
        data: { label: g.label, position: g.position, draftKind: g.draftKind },
      });
    } else {
      await tx.manuscriptGroup.create({
        data: {
          id: g.id,
          projectId,
          label: g.label,
          position: g.position,
          draftKind: g.draftKind,
        },
      });
    }
  }

  const chapterToGroup = new Map<string, string>();
  for (const g of normalized.groups) {
    for (const chapterId of g.chapterIds) chapterToGroup.set(chapterId, g.id);
  }

  for (const chapter of live.chapters) {
    const next = chapterToGroup.get(chapter.id) ?? null;
    if (chapter.groupId !== next) {
      await tx.record.update({ where: { id: chapter.id }, data: { groupId: next } });
    }
  }
  for (const scene of live.scenes) {
    const next = scene.parentRecordId ? (chapterToGroup.get(scene.parentRecordId) ?? null) : null;
    if (scene.groupId !== next) {
      await tx.record.update({ where: { id: scene.id }, data: { groupId: next } });
    }
  }

  const worldNext = new Map(normalized.worldScopes.map((w) => [w.recordId, w.scope]));
  for (const w of live.world) {
    const next = worldNext.get(w.id) ?? null;
    if ((isWorldScope(w.worldScope) ? w.worldScope : null) !== next) {
      await tx.record.update({ where: { id: w.id }, data: { worldScope: next } });
    }
  }

  const nextRevision = live.project.assignmentRevision + 1;
  await tx.project.update({
    where: { id: projectId },
    data: {
      seriesName: normalized.seriesName,
      bookName: normalized.bookName,
      draftKind: normalized.draftKind,
      assignmentRevision: nextRevision,
    },
  });

  await writeAudit(tx, {
    projectId,
    action: "project.assign",
    actor,
    summary: summarizeAudit(normalized, changes),
    details: JSON.parse(
      JSON.stringify({
        assignmentRevision: nextRevision,
        seriesName: normalized.seriesName,
        bookName: normalized.bookName,
        draftKind: normalized.draftKind,
        groups: normalized.groups.map((g) => ({
          id: g.id,
          label: g.label,
          position: g.position,
          draftKind: g.draftKind,
          chapterIds: g.chapterIds,
          sceneIds: g.sceneIds,
        })),
        worldScopes: normalized.worldScopes,
        changes,
      }),
    ) as JsonValue,
  });

  return { status: "applied", assignmentRevision: nextRevision, changes };
}

function summarizeAudit(plan: AssignmentPlan, changes: AssignmentChangeSummary): string {
  const parts: string[] = [];
  if (plan.seriesName) parts.push(`series "${plan.seriesName}"`);
  if (plan.bookName) parts.push(`book "${plan.bookName}"`);
  if (plan.draftKind) parts.push(DRAFT_KIND_LABELS[plan.draftKind]);
  if (plan.groups.length) parts.push(`${plan.groups.length} group${plan.groups.length === 1 ? "" : "s"}`);
  if (changes.worldScopeChanges) {
    parts.push(`${changes.worldScopeChanges} World scope${changes.worldScopeChanges === 1 ? "" : "s"}`);
  }
  return parts.length ? `Updated project assignments (${parts.join(", ")})` : "Cleared project assignments";
}

/**
 * Applies a confirmed preview atomically. Revalidates the token against the
 * live project; rejects with STALE_PREVIEW when anything moved. Rerunning the
 * same plan after a successful apply returns already_applied and writes nothing.
 * Never changes record text, revisions, images or links.
 */
export async function applyAssignments(
  db: Db,
  projectId: string,
  input: { plan: AssignmentPlan; previewToken: string; actor?: string },
): Promise<ApplyAssignmentsResult> {
  try {
    return await db.$transaction((tx) =>
      applyInTx(tx, projectId, input.plan, input.previewToken, input.actor ?? "author"),
    );
  } catch (error) {
    if (error instanceof MutationRejectedError) return { status: "rejected", issues: error.issues };
    throw error;
  }
}

/** True when the project has any Series/Book/Draft assignment or manuscript group. */
export function projectHasAssignments(project: {
  seriesName: string | null;
  bookName: string | null;
  draftKind: string | null;
}): boolean {
  return !!(project.seriesName || project.bookName || project.draftKind);
}

export function draftKindLabel(kind: string | null | undefined): string | null {
  return isDraftKind(kind) ? DRAFT_KIND_LABELS[kind] : null;
}

export function worldScopeLabel(scope: string | null | undefined): string | null {
  return isWorldScope(scope) ? WORLD_SCOPE_LABELS[scope] : null;
}

/** Guard used by callers that accidentally pass a non-world type. */
export function assertWorldType(type: string): boolean {
  return isWorldType(type);
}
