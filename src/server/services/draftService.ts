import { compareBookOrder } from "@/domain/bookOrder";
import {
  DRAFT_KIND_LABELS,
  defaultDraftLabel,
  isDraftKind,
  type DraftKind,
} from "@/domain/assignments";
import { newId } from "@/domain/ids";
import { errorIssue } from "@/domain/issues";
import {
  MANUSCRIPT_TYPES,
  isManuscriptType,
  RECORD_TYPE_LABELS,
  type RecordType,
} from "@/domain/recordTypes";
import type { Db, DbOrTx, Tx } from "../db";
import { writeAudit } from "./auditService";
import { MutationRejectedError, NotFoundError } from "./errors";
import {
  applyMutationsInTx,
  type CreateRecordMutation,
  type MutationContext,
} from "./mutationService";

/*
 * Same-project Zero draft and Author manuscript trees. Draft rows, draftId on
 * records, rewrite source pins, and reading/export defaults are structural
 * metadata: they create no revisions and never change record text. Blank
 * rewrite pages are created only through mutationService.
 */

const UI_ACTOR = "author";

export interface ManuscriptDraftView {
  id: string;
  projectId: string;
  kind: DraftKind;
  label: string;
  completedAt: Date | null;
  createdAt: Date;
}

export interface ProjectDraftDefaults {
  defaultReadingDraftId: string | null;
  defaultExportDraftId: string | null;
}

export interface StartAuthorRewriteResult {
  /** True when Author manuscript already existed; no new records were created. */
  alreadyExisted: boolean;
  zeroDraft: ManuscriptDraftView;
  authorDraft: ManuscriptDraftView;
  /** First chapter of the author draft, if any, for opening Write. */
  openRecordId: string | null;
  createdRecordIds: string[];
}

function uiContext(projectId: string): MutationContext {
  return {
    projectId,
    actor: UI_ACTOR,
    source: { kind: "ui" },
    scope: "manuscript",
    protectedOverrides: new Set(),
  };
}

function rejected(message: string): MutationRejectedError {
  return new MutationRejectedError([errorIssue("INVALID_CHANGE", message)]);
}

function toDraftView(row: {
  id: string;
  projectId: string;
  kind: string;
  label: string;
  completedAt: Date | null;
  createdAt: Date;
}): ManuscriptDraftView {
  if (!isDraftKind(row.kind)) throw new Error(`Unknown draft kind in database: ${row.kind}`);
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    label: row.label,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
  };
}

export async function listManuscriptDrafts(db: DbOrTx, projectId: string): Promise<ManuscriptDraftView[]> {
  const rows = await db.manuscriptDraft.findMany({
    where: { projectId },
    orderBy: [{ kind: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(toDraftView);
}

export async function getManuscriptDraft(db: DbOrTx, projectId: string, draftId: string): Promise<ManuscriptDraftView | null> {
  const row = await db.manuscriptDraft.findFirst({ where: { id: draftId, projectId } });
  return row ? toDraftView(row) : null;
}

export async function getDraftDefaults(db: DbOrTx, projectId: string): Promise<ProjectDraftDefaults> {
  const project = await db.project.findFirst({
    where: { id: projectId, trashedAt: null },
    select: { defaultReadingDraftId: true, defaultExportDraftId: true },
  });
  if (!project) throw new NotFoundError(`Project ${projectId} not found`);
  return {
    defaultReadingDraftId: project.defaultReadingDraftId,
    defaultExportDraftId: project.defaultExportDraftId,
  };
}

/** True when the project has at least one ManuscriptDraft row. */
export async function projectHasDrafts(db: DbOrTx, projectId: string): Promise<boolean> {
  const n = await db.manuscriptDraft.count({ where: { projectId } });
  return n > 0;
}

/** How manuscript lists choose chapters/scenes when drafts exist. */
export type DraftScope =
  | { mode: "legacy" }
  | { mode: "draft"; draftId: string }
  | { mode: "empty" };

export function resolveDraftScope(hasDrafts: boolean, draftId: string | null | undefined): DraftScope {
  if (!hasDrafts) return { mode: "legacy" };
  if (draftId) return { mode: "draft", draftId };
  return { mode: "empty" };
}

/** Prisma where fragment for live manuscript rows under a draft scope. */
export function manuscriptDraftWhere(scope: DraftScope): { draftId?: string; id?: { in: string[] } } {
  if (scope.mode === "legacy") return {};
  if (scope.mode === "draft") return { draftId: scope.draftId };
  return { id: { in: [] } };
}

/** Promote live manuscript chapters/scenes into a Zero draft when none exist yet. */
async function ensureZeroDraftInTx(tx: Tx, projectId: string): Promise<ManuscriptDraftView> {
  const existing = await tx.manuscriptDraft.findFirst({ where: { projectId, kind: "zero_draft" } });
  if (existing) return toDraftView(existing);

  const anyDraft = await tx.manuscriptDraft.count({ where: { projectId } });
  if (anyDraft > 0) {
    throw rejected("This project has drafts but no Zero draft. Start author rewrite needs a Zero draft.");
  }

  const id = newId("drf");
  const label = defaultDraftLabel("zero_draft");
  await tx.manuscriptDraft.create({
    data: { id, projectId, kind: "zero_draft", label },
  });
  await tx.record.updateMany({
    where: { projectId, type: { in: [...MANUSCRIPT_TYPES] }, trashedAt: null },
    data: { draftId: id },
  });
  await writeAudit(tx, {
    projectId,
    action: "draft.promote",
    actor: UI_ACTOR,
    summary: `Promoted manuscript into ${label}`,
    details: { draftId: id, kind: "zero_draft" },
  });
  return toDraftView({
    id,
    projectId,
    kind: "zero_draft",
    label,
    completedAt: null,
    createdAt: new Date(),
  });
}

async function loadOrderedManuscript(
  tx: Tx,
  projectId: string,
  draftId: string,
): Promise<Array<{ id: string; type: string; title: string; parentRecordId: string | null; position: number | null; createdAt: Date; currentRevision: number }>> {
  const rows = await tx.record.findMany({
    where: { projectId, draftId, type: { in: [...MANUSCRIPT_TYPES] }, trashedAt: null },
    select: {
      id: true,
      type: true,
      title: true,
      parentRecordId: true,
      position: true,
      createdAt: true,
      currentRevision: true,
    },
  });
  return [...rows].sort((a, b) =>
    compareBookOrder(
      { id: a.id, position: a.position, createdAt: a.createdAt.toISOString() },
      { id: b.id, position: b.position, createdAt: b.createdAt.toISOString() },
    ),
  );
}

/**
 * Start author rewrite from the Zero draft: create blank Author manuscript pages
 * pinned to exact source revisions. Idempotent when Author manuscript already exists.
 */
export async function startAuthorRewrite(db: Db, projectId: string): Promise<StartAuthorRewriteResult> {
  return db.$transaction(async (tx) => {
    const project = await tx.project.findFirst({
      where: { id: projectId, trashedAt: null },
      select: { id: true, defaultReadingDraftId: true, defaultExportDraftId: true },
    });
    if (!project) throw new NotFoundError(`Project ${projectId} not found`);

    const zeroDraft = await ensureZeroDraftInTx(tx, projectId);

    const existingAuthor = await tx.manuscriptDraft.findFirst({
      where: { projectId, kind: "author_manuscript" },
    });
    if (existingAuthor) {
      const authorDraft = toDraftView(existingAuthor);
      const first = await tx.record.findFirst({
        where: { projectId, draftId: authorDraft.id, type: "manuscript_chapter", trashedAt: null },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        select: { id: true },
      });
      return {
        alreadyExisted: true,
        zeroDraft,
        authorDraft,
        openRecordId: first?.id ?? null,
        createdRecordIds: [],
      };
    }

    const sources = await loadOrderedManuscript(tx, projectId, zeroDraft.id);
    if (sources.length === 0) {
      throw rejected("The Zero draft has no chapters or scenes yet. Add manuscript pages before starting a rewrite.");
    }

    const authorId = newId("drf");
    const authorLabel = defaultDraftLabel("author_manuscript");
    await tx.manuscriptDraft.create({
      data: { id: authorId, projectId, kind: "author_manuscript", label: authorLabel },
    });

    const idMap = new Map<string, string>();
    for (const s of sources) idMap.set(s.id, newId("rec"));

    const mutations: CreateRecordMutation[] = sources.map((s) => {
      if (!isManuscriptType(s.type)) {
        throw rejected(`Cannot copy ${s.type} into an author rewrite.`);
      }
      const type = s.type as RecordType;
      const parentRecordId =
        type === "manuscript_scene" && s.parentRecordId ? (idMap.get(s.parentRecordId) ?? null) : null;
      if (type === "manuscript_scene" && !parentRecordId) {
        throw rejected(`Scene "${s.title}" has no chapter in the Zero draft.`);
      }
      return {
        kind: "create_record" as const,
        recordId: idMap.get(s.id)!,
        type,
        title: s.title,
        body: "",
        fields: {},
        authorityStatus: "draft" as const,
        parentRecordId,
        draftId: authorId,
      };
    });

    // Chapters first so same-batch parent resolution sees them before scenes.
    mutations.sort((a, b) => {
      if (a.type === b.type) return 0;
      return a.type === "manuscript_chapter" ? -1 : 1;
    });

    const batch = await applyMutationsInTx(tx, uiContext(projectId), mutations, {
      action: "draft.start_rewrite",
      summary: `Started ${authorLabel} from ${zeroDraft.label}`,
    });

    // Copy book order positions from the source tree.
    for (const s of sources) {
      const newIdFor = idMap.get(s.id)!;
      await tx.record.update({
        where: { id: newIdFor },
        data: { position: s.position },
      });
    }

    // Pin each new record to the exact source revision at create time.
    let position = 0;
    for (const s of sources) {
      const fromRecordId = idMap.get(s.id)!;
      await tx.rewriteSourceLink.create({
        data: {
          id: newId("rsl"),
          projectId,
          fromRecordId,
          toRecordId: s.id,
          toRevisionNumber: s.currentRevision,
          position: position++,
        },
      });
    }

    await writeAudit(tx, {
      projectId,
      action: "draft.start_rewrite",
      actor: UI_ACTOR,
      summary: `Created ${authorLabel} with ${sources.length} blank ${sources.length === 1 ? "page" : "pages"}`,
      details: {
        zeroDraftId: zeroDraft.id,
        authorDraftId: authorId,
        recordCount: sources.length,
        createdRecordIds: batch.outcomes.map((o) => o.recordId),
        // Defaults must not change on Start.
        defaultReadingDraftId: project.defaultReadingDraftId,
        defaultExportDraftId: project.defaultExportDraftId,
      },
    });

    const firstChapter = sources.find((s) => s.type === "manuscript_chapter");
    return {
      alreadyExisted: false,
      zeroDraft,
      authorDraft: toDraftView({
        id: authorId,
        projectId,
        kind: "author_manuscript",
        label: authorLabel,
        completedAt: null,
        createdAt: new Date(),
      }),
      openRecordId: firstChapter ? idMap.get(firstChapter.id)! : batch.outcomes[0]?.recordId ?? null,
      createdRecordIds: batch.outcomes.map((o) => o.recordId),
    };
  });
}

/** Where an imported chapter's text belongs, and whether a blank rewrite page is needed. */
export interface ManuscriptDraftPlacement {
  /** Draft that holds the chapter text. Null when the project has no drafts. */
  textDraftId: string | null;
  /** Author manuscript that receives a blank page. Set only when both drafts exist. */
  authorDraftId: string | null;
}

export async function manuscriptDraftPlacement(db: DbOrTx, projectId: string): Promise<ManuscriptDraftPlacement> {
  const drafts = await db.manuscriptDraft.findMany({
    where: { projectId },
    select: { id: true, kind: true },
  });
  const zero = drafts.find((d) => d.kind === "zero_draft");
  const author = drafts.find((d) => d.kind === "author_manuscript");
  if (zero && author) return { textDraftId: zero.id, authorDraftId: author.id };
  if (zero) return { textDraftId: zero.id, authorDraftId: null };
  if (author) return { textDraftId: author.id, authorDraftId: null };
  return { textDraftId: null, authorDraftId: null };
}

/**
 * Blank Author manuscript page pinned to one Zero draft chapter.
 * Idempotent when a live rewrite page already pins that chapter.
 */
export async function addBlankRewritePageInTx(
  tx: Tx,
  projectId: string,
  source: { id: string; title: string; currentRevision: number },
  authorDraftId: string,
): Promise<{ recordId: string; created: boolean }> {
  const existing = await tx.rewriteSourceLink.findFirst({
    where: {
      projectId,
      toRecordId: source.id,
      from: { trashedAt: null, draftId: authorDraftId, type: "manuscript_chapter" },
    },
    select: { fromRecordId: true },
  });
  if (existing) return { recordId: existing.fromRecordId, created: false };

  const recordId = newId("rec");
  await applyMutationsInTx(
    tx,
    uiContext(projectId),
    [
      {
        kind: "create_record",
        recordId,
        type: "manuscript_chapter",
        title: source.title,
        body: "",
        fields: {},
        authorityStatus: "draft",
        draftId: authorDraftId,
      },
    ],
    {
      action: "draft.rewrite_page",
      summary: `Added a blank Author manuscript page for "${source.title}"`,
    },
  );
  await tx.rewriteSourceLink.create({
    data: {
      id: newId("rsl"),
      projectId,
      fromRecordId: recordId,
      toRecordId: source.id,
      toRevisionNumber: source.currentRevision,
      position: 0,
    },
  });
  return { recordId, created: true };
}

/**
 * Manuscript chapters imported before draft assignment existed have a null
 * draft id, so neither the Zero draft nor the Author manuscript lists them.
 * Place that text on the Zero draft (or the only draft) and, when a rewrite
 * already exists, add the blank Author manuscript page.
 */
export async function adoptUnassignedManuscript(
  db: Db,
  projectId: string,
): Promise<{ assigned: number; rewritePages: number }> {
  const placement = await manuscriptDraftPlacement(db, projectId);
  if (!placement.textDraftId) return { assigned: 0, rewritePages: 0 };
  const pending = await db.record.count({
    where: { projectId, draftId: null, trashedAt: null, type: { in: [...MANUSCRIPT_TYPES] } },
  });
  if (pending === 0) return { assigned: 0, rewritePages: 0 };

  return db.$transaction(async (tx) => {
    const live = await manuscriptDraftPlacement(tx, projectId);
    if (!live.textDraftId) return { assigned: 0, rewritePages: 0 };
    const orphans = await tx.record.findMany({
      where: { projectId, draftId: null, trashedAt: null, type: { in: [...MANUSCRIPT_TYPES] } },
      select: { id: true, type: true, title: true, currentRevision: true, parentRecordId: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const assignedIds: string[] = [];
    const rewriteIds: string[] = [];
    for (const row of orphans) {
      if (row.type !== "manuscript_chapter") continue;
      const updated = await tx.record.updateMany({
        where: { id: row.id, projectId, draftId: null, trashedAt: null },
        data: { draftId: live.textDraftId },
      });
      if (updated.count !== 1) continue;
      assignedIds.push(row.id);
      if (live.authorDraftId && live.textDraftId !== live.authorDraftId) {
        const page = await addBlankRewritePageInTx(
          tx,
          projectId,
          { id: row.id, title: row.title, currentRevision: row.currentRevision },
          live.authorDraftId,
        );
        if (page.created) rewriteIds.push(page.recordId);
      }
    }
    for (const row of orphans) {
      if (row.type !== "manuscript_scene" || !row.parentRecordId) continue;
      const parent = await tx.record.findFirst({
        where: { id: row.parentRecordId, projectId, trashedAt: null },
        select: { draftId: true },
      });
      if (!parent || parent.draftId !== live.textDraftId) continue;
      const updated = await tx.record.updateMany({
        where: { id: row.id, projectId, draftId: null, trashedAt: null },
        data: { draftId: live.textDraftId },
      });
      if (updated.count === 1) assignedIds.push(row.id);
    }
    if (assignedIds.length > 0) {
      await writeAudit(tx, {
        projectId,
        action: "draft.adopt_unassigned",
        actor: UI_ACTOR,
        summary:
          rewriteIds.length > 0
            ? `Placed ${assignedIds.length} unassigned manuscript ${assignedIds.length === 1 ? "page" : "pages"} on the Zero draft and added ${rewriteIds.length} blank Author manuscript ${rewriteIds.length === 1 ? "page" : "pages"}`
            : `Placed ${assignedIds.length} unassigned manuscript ${assignedIds.length === 1 ? "page" : "pages"} on the current draft`,
        details: {
          recordIds: assignedIds,
          rewriteRecordIds: rewriteIds,
          textDraftId: live.textDraftId,
          authorDraftId: live.authorDraftId,
        },
      });
    }
    return { assigned: assignedIds.length, rewritePages: rewriteIds.length };
  });
}

export async function setDraftCompletion(
  db: Db,
  projectId: string,
  draftId: string,
  completed: boolean,
): Promise<ManuscriptDraftView> {
  return db.$transaction(async (tx) => {
    const draft = await tx.manuscriptDraft.findFirst({ where: { id: draftId, projectId } });
    if (!draft) throw new NotFoundError(`Draft ${draftId} not found`);
    const completedAt = completed ? draft.completedAt ?? new Date() : null;
    if ((draft.completedAt != null) === completed) return toDraftView(draft);
    const updated = await tx.manuscriptDraft.update({
      where: { id: draftId },
      data: { completedAt },
    });
    await writeAudit(tx, {
      projectId,
      action: completed ? "draft.complete" : "draft.uncomplete",
      actor: UI_ACTOR,
      summary: completed
        ? `Marked ${draft.label} complete`
        : `Cleared completion on ${draft.label}`,
      details: { draftId, kind: draft.kind, completedAt: completedAt?.toISOString() ?? null },
    });
    return toDraftView(updated);
  });
}

export async function setDefaultReadingDraft(
  db: Db,
  projectId: string,
  draftId: string | null,
): Promise<ProjectDraftDefaults> {
  return setDefaultDraft(db, projectId, "defaultReadingDraftId", draftId, "reading");
}

export async function setDefaultExportDraft(
  db: Db,
  projectId: string,
  draftId: string | null,
): Promise<ProjectDraftDefaults> {
  return setDefaultDraft(db, projectId, "defaultExportDraftId", draftId, "export");
}

async function setDefaultDraft(
  db: Db,
  projectId: string,
  field: "defaultReadingDraftId" | "defaultExportDraftId",
  draftId: string | null,
  kind: "reading" | "export",
): Promise<ProjectDraftDefaults> {
  return db.$transaction(async (tx) => {
    const project = await tx.project.findFirst({
      where: { id: projectId, trashedAt: null },
      select: { id: true, defaultReadingDraftId: true, defaultExportDraftId: true },
    });
    if (!project) throw new NotFoundError(`Project ${projectId} not found`);
    if (draftId) {
      const draft = await tx.manuscriptDraft.findFirst({ where: { id: draftId, projectId } });
      if (!draft) throw rejected(`Draft ${draftId} does not exist in this project.`);
    }
    await tx.project.update({ where: { id: projectId }, data: { [field]: draftId } });
    await writeAudit(tx, {
      projectId,
      action: kind === "reading" ? "draft.default_reading" : "draft.default_export",
      actor: UI_ACTOR,
      summary:
        draftId == null
          ? `Cleared default ${kind} draft`
          : `Set default ${kind} draft`,
      details: { [field]: draftId },
    });
    return {
      defaultReadingDraftId: field === "defaultReadingDraftId" ? draftId : project.defaultReadingDraftId,
      defaultExportDraftId: field === "defaultExportDraftId" ? draftId : project.defaultExportDraftId,
    };
  });
}

export interface RewriteSourceView {
  linkId: string;
  toRecordId: string;
  toRevisionNumber: number;
  title: string;
  type: string;
  position: number;
  /** True when the live record has moved past the pinned revision. */
  newerThanPin: boolean;
  currentRevision: number;
}

export async function listRewriteSources(
  db: DbOrTx,
  projectId: string,
  fromRecordId: string,
): Promise<RewriteSourceView[]> {
  const rows = await db.rewriteSourceLink.findMany({
    where: { projectId, fromRecordId, to: { trashedAt: null } },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    include: {
      to: { select: { id: true, title: true, type: true, currentRevision: true } },
    },
  });
  return rows.map((r) => ({
    linkId: r.id,
    toRecordId: r.to.id,
    toRevisionNumber: r.toRevisionNumber,
    title: r.to.title,
    type: r.to.type,
    position: r.position,
    newerThanPin: r.to.currentRevision > r.toRevisionNumber,
    currentRevision: r.to.currentRevision,
  }));
}

/** Zero-draft manuscript records that can still be pinned as sources for a rewrite record. */
export async function listAttachableRewriteSources(
  db: DbOrTx,
  projectId: string,
  fromRecordId: string,
): Promise<Array<{ id: string; title: string; type: string; currentRevision: number }>> {
  const from = await db.record.findFirst({
    where: { id: fromRecordId, projectId, trashedAt: null },
    select: { id: true, draftId: true, type: true },
  });
  if (!from || !isManuscriptType(from.type) || !from.draftId) return [];
  const author = await db.manuscriptDraft.findFirst({ where: { id: from.draftId, projectId } });
  if (!author || author.kind !== "author_manuscript") return [];
  const zero = await db.manuscriptDraft.findFirst({ where: { projectId, kind: "zero_draft" } });
  if (!zero) return [];
  const linked = await db.rewriteSourceLink.findMany({
    where: { projectId, fromRecordId },
    select: { toRecordId: true },
  });
  const linkedIds = new Set(linked.map((l) => l.toRecordId));
  const rows = await db.record.findMany({
    where: {
      projectId,
      draftId: zero.id,
      type: { in: [...MANUSCRIPT_TYPES] },
      trashedAt: null,
      id: { notIn: [...linkedIds] },
    },
    select: { id: true, title: true, type: true, currentRevision: true, position: true, createdAt: true },
  });
  return [...rows]
    .sort((a, b) =>
      compareBookOrder(
        { id: a.id, position: a.position, createdAt: a.createdAt.toISOString() },
        { id: b.id, position: b.position, createdAt: b.createdAt.toISOString() },
      ),
    )
    .map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      currentRevision: r.currentRevision,
    }));
}

export async function attachRewriteSource(
  db: Db,
  projectId: string,
  fromRecordId: string,
  toRecordId: string,
  toRevisionNumber?: number,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const from = await tx.record.findFirst({
      where: { id: fromRecordId, projectId, trashedAt: null },
      select: { id: true, title: true, type: true, draftId: true },
    });
    const to = await tx.record.findFirst({
      where: { id: toRecordId, projectId, trashedAt: null },
      select: { id: true, title: true, type: true, draftId: true, currentRevision: true },
    });
    if (!from) throw rejected(`Record ${fromRecordId} does not exist in this project.`);
    if (!to) throw rejected(`Record ${toRecordId} does not exist in this project.`);
    if (!isManuscriptType(from.type)) {
      throw rejected(`Only ${RECORD_TYPE_LABELS.manuscript_chapter}s and ${RECORD_TYPE_LABELS.manuscript_scene}s can have rewrite sources.`);
    }
    if (!isManuscriptType(to.type)) {
      throw rejected("Rewrite sources must be manuscript chapters or scenes.");
    }
    if (!from.draftId || !to.draftId) {
      throw rejected("Both records must belong to a manuscript draft.");
    }
    const [fromDraft, toDraft] = await Promise.all([
      tx.manuscriptDraft.findFirst({ where: { id: from.draftId, projectId } }),
      tx.manuscriptDraft.findFirst({ where: { id: to.draftId, projectId } }),
    ]);
    if (!fromDraft || fromDraft.kind !== "author_manuscript") {
      throw rejected("Rewrite sources can only be attached on Author manuscript pages.");
    }
    if (!toDraft || toDraft.kind !== "zero_draft") {
      throw rejected("Rewrite sources must come from the Zero draft.");
    }
    const revision = toRevisionNumber ?? to.currentRevision;
    if (revision < 1 || revision > to.currentRevision) {
      throw rejected(`Revision ${revision} does not exist on "${to.title}".`);
    }
    const existing = await tx.rewriteSourceLink.findUnique({
      where: { fromRecordId_toRecordId: { fromRecordId, toRecordId } },
    });
    if (existing) throw rejected("That source is already linked here.");
    const maxPos = await tx.rewriteSourceLink.aggregate({
      where: { fromRecordId },
      _max: { position: true },
    });
    const id = newId("rsl");
    await tx.rewriteSourceLink.create({
      data: {
        id,
        projectId,
        fromRecordId,
        toRecordId,
        toRevisionNumber: revision,
        position: (maxPos._max.position ?? -1) + 1,
      },
    });
    await writeAudit(tx, {
      projectId,
      action: "rewrite_source.link",
      actor: UI_ACTOR,
      summary: `Linked source "${to.title}" (revision ${revision}) to "${from.title}"`,
      details: { linkId: id, fromRecordId, toRecordId, toRevisionNumber: revision },
    });
  });
}

export async function detachRewriteSource(
  db: Db,
  projectId: string,
  fromRecordId: string,
  toRecordId: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const link = await tx.rewriteSourceLink.findFirst({
      where: { projectId, fromRecordId, toRecordId },
      include: {
        from: { select: { title: true } },
        to: { select: { title: true } },
      },
    });
    if (!link) throw rejected("That source is not linked here.");
    await tx.rewriteSourceLink.delete({ where: { id: link.id } });
    await writeAudit(tx, {
      projectId,
      action: "rewrite_source.unlink",
      actor: UI_ACTOR,
      summary: `Unlinked source "${link.to.title}" from "${link.from.title}"`,
      details: { linkId: link.id, fromRecordId, toRecordId },
    });
  });
}

export async function getRewriteSourcePreview(
  db: DbOrTx,
  projectId: string,
  toRecordId: string,
  toRevisionNumber: number,
): Promise<{ title: string; body: string; revisionNumber: number; currentRevision: number } | null> {
  const record = await db.record.findFirst({
    where: { id: toRecordId, projectId, trashedAt: null },
    select: { id: true, title: true, currentRevision: true },
  });
  if (!record) return null;
  const revision = await db.revision.findUnique({
    where: { recordId_revisionNumber: { recordId: toRecordId, revisionNumber: toRevisionNumber } },
    select: { title: true, body: true, revisionNumber: true },
  });
  if (!revision) return null;
  return {
    title: revision.title,
    body: revision.body,
    revisionNumber: revision.revisionNumber,
    currentRevision: record.currentRevision,
  };
}

export { DRAFT_KIND_LABELS };
