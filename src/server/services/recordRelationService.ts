import type { RelationScope } from "@/domain/assignments";
import { newId } from "@/domain/ids";
import { errorIssue } from "@/domain/issues";
import { isLinkableReferenceType, isRecordType, RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import { isAuthorityStatus } from "@/domain/statuses";
import {
  isRecordRelationEndpoint,
  isRecordRelationKind,
  MAX_RECORD_RELATION_LABEL_CHARS,
  RECORD_RELATION_KINDS,
  RECORD_RELATION_LABELS,
  recordRelationKindLabel,
  recordShowsRecordRelations,
  type RecordRelationKind,
  type RecordRelationView,
} from "@/world/recordRelations";
import type { Db, DbOrTx } from "../db";
import { writeAudit } from "./auditService";
import { MutationRejectedError, NotFoundError } from "./errors";
import {
  normalizeRelationScope,
  relationVisibilityWhere,
  resolveRelationEndpoint,
  resolveWritableRelationScope,
} from "./relationScope";
import { listAvailableReferences } from "./seriesBibleService";

export {
  isRecordRelationEndpoint,
  isRecordRelationKind,
  MAX_RECORD_RELATION_LABEL_CHARS,
  RECORD_RELATION_KINDS,
  RECORD_RELATION_LABELS,
  recordRelationKindLabel,
  recordShowsRecordRelations,
  type RecordRelationKind,
  type RecordRelationView,
};

/*
 * Explicit relationships between characters, organizations, and places the author
 * chose as endpoints. Independent of board cards and map pins: moving cards or
 * pins never creates or changes these rows.
 */

const UI_ACTOR = "author";

/** Reference records that may be the other end of a record relationship. */
export async function listRecordRelationEndpointChoices(
  db: DbOrTx,
  projectId: string,
): Promise<Array<{ id: string; title: string; typeLabel: string; homeLabel: string | null }>> {
  const available = await listAvailableReferences(db, projectId, { linkableOnly: true });
  return available.flatMap((entry) => {
    if (!isRecordRelationEndpoint(entry.record.type, entry.record.fields)) return [];
    return [
      {
        id: entry.record.id,
        title: entry.record.title,
        typeLabel: RECORD_TYPE_LABELS[entry.record.type],
        homeLabel: entry.home
          ? entry.home.bookName?.trim() || entry.home.title
          : null,
      },
    ];
  });
}

function rejected(message: string, recordId?: string): MutationRejectedError {
  return new MutationRejectedError([errorIssue("INVALID_REFERENCE", message, recordId ? { recordId } : {})]);
}

function normalizeCustomLabel(kind: RecordRelationKind, raw: string | undefined): string {
  if (kind !== "custom") return "";
  const label = (raw ?? "").trim();
  if (!label) throw rejected("Type a label for a custom relationship.");
  if (label.length > MAX_RECORD_RELATION_LABEL_CHARS) {
    throw rejected(`A custom label can have at most ${MAX_RECORD_RELATION_LABEL_CHARS} characters.`);
  }
  return label;
}

async function loadEndpoint(db: DbOrTx, projectId: string, recordId: string) {
  const available = await resolveRelationEndpoint(db, projectId, recordId);
  if (!available) throw rejected(`Record ${recordId} is not available in this book.`, recordId);
  if (!isLinkableReferenceType(available.record.type)) {
    throw rejected("Relationships are only between reference records.", recordId);
  }
  if (!isRecordRelationEndpoint(available.record.type, available.record.fields)) {
    throw rejected("This record type cannot be a relationship endpoint.", recordId);
  }
  if (!isAuthorityStatus(available.record.authorityStatus)) throw rejected("Unknown authority status.", recordId);
  return available;
}

function viewOf(
  r: {
    id: string;
    kind: string;
    customLabel: string;
    scope?: string | null;
    fromRecordId: string;
    toRecordId: string;
    createdAt: Date;
    from: { title: string; type: string; authorityStatus: string };
    to: { title: string; type: string; authorityStatus: string };
  },
): RecordRelationView | null {
  if (!isRecordRelationKind(r.kind)) return null;
  if (!isRecordType(r.from.type) || !isRecordType(r.to.type)) return null;
  if (!isAuthorityStatus(r.from.authorityStatus) || !isAuthorityStatus(r.to.authorityStatus)) return null;
  return {
    id: r.id,
    kind: r.kind,
    kindLabel: recordRelationKindLabel(r.kind, r.customLabel),
    customLabel: r.customLabel,
    scope: normalizeRelationScope(r.scope),
    fromRecordId: r.fromRecordId,
    fromTitle: r.from.title,
    fromTypeLabel: RECORD_TYPE_LABELS[r.from.type],
    fromStatus: r.from.authorityStatus,
    toRecordId: r.toRecordId,
    toTitle: r.to.title,
    toTypeLabel: RECORD_TYPE_LABELS[r.to.type],
    toStatus: r.to.authorityStatus,
    createdAt: r.createdAt,
  };
}

export async function listRecordRelationsForRecord(
  db: DbOrTx,
  projectId: string,
  recordId: string,
): Promise<{ outgoing: RecordRelationView[]; incoming: RecordRelationView[] }> {
  if (!("recordRelation" in db) || !(db as { recordRelation?: { findMany: unknown } }).recordRelation) {
    return { outgoing: [], incoming: [] };
  }
  try {
    const visibility = await relationVisibilityWhere(db, projectId);
    const rows = await db.recordRelation.findMany({
      where: {
        AND: [
          visibility,
          { OR: [{ fromRecordId: recordId }, { toRecordId: recordId }] },
          { from: { trashedAt: null } },
          { to: { trashedAt: null } },
        ],
      },
      orderBy: [{ kind: "asc" }, { customLabel: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      include: {
        from: { select: { title: true, type: true, authorityStatus: true } },
        to: { select: { title: true, type: true, authorityStatus: true } },
      },
    });
    const outgoing: RecordRelationView[] = [];
    const incoming: RecordRelationView[] = [];
    for (const r of rows) {
      const v = viewOf(r);
      if (!v) continue;
      if (r.fromRecordId === recordId) outgoing.push(v);
      if (r.toRecordId === recordId) incoming.push(v);
    }
    return { outgoing, incoming };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "P2021") return { outgoing: [], incoming: [] };
    throw error;
  }
}

export async function addRecordRelation(
  db: Db,
  projectId: string,
  input: {
    fromRecordId: string;
    toRecordId: string;
    kind: RecordRelationKind;
    customLabel?: string;
    scope?: RelationScope | string | null;
  },
): Promise<RecordRelationView> {
  if (!isRecordRelationKind(input.kind)) throw rejected("Unknown relationship kind.");
  if (input.fromRecordId === input.toRecordId) throw rejected("A record cannot relate to itself.", input.fromRecordId);
  const customLabel = normalizeCustomLabel(input.kind, input.customLabel);

  return db.$transaction(async (tx) => {
    const project = await tx.project.findFirst({ where: { id: projectId, trashedAt: null }, select: { id: true } });
    if (!project) throw new NotFoundError(`Project ${projectId} not found`);
    const from = await loadEndpoint(tx, projectId, input.fromRecordId);
    const to = await loadEndpoint(tx, projectId, input.toRecordId);
    const scope = await resolveWritableRelationScope(tx, projectId, from, to, input.scope);
    const existing = await tx.recordRelation.findUnique({
      where: {
        fromRecordId_toRecordId_kind_customLabel: {
          fromRecordId: from.record.id,
          toRecordId: to.record.id,
          kind: input.kind,
          customLabel,
        },
      },
    });
    if (existing) {
      throw rejected(
        `That "${recordRelationKindLabel(input.kind, customLabel)}" relationship already exists.`,
        from.record.id,
      );
    }

    if (input.kind === "parent_of") {
      const cycle = await wouldCreateParentOfCycle(tx, from.record.id, to.record.id);
      if (cycle) throw rejected("That Parent of link would create a cycle.", from.record.id);
    }

    const id = newId("rrl");
    await tx.recordRelation.create({
      data: {
        id,
        projectId,
        fromRecordId: from.record.id,
        toRecordId: to.record.id,
        kind: input.kind,
        customLabel,
        scope,
      },
    });
    const label = recordRelationKindLabel(input.kind, customLabel);
    await writeAudit(tx, {
      projectId,
      action: "record_relation.add",
      actor: UI_ACTOR,
      summary: `"${from.record.title}" ${label.toLowerCase()} "${to.record.title}"`,
      details: {
        relationId: id,
        kind: input.kind,
        customLabel,
        scope,
        fromRecordId: from.record.id,
        toRecordId: to.record.id,
      },
    });
    return {
      id,
      kind: input.kind,
      kindLabel: label,
      customLabel,
      scope,
      fromRecordId: from.record.id,
      fromTitle: from.record.title,
      fromTypeLabel: RECORD_TYPE_LABELS[from.record.type],
      fromStatus: from.record.authorityStatus,
      toRecordId: to.record.id,
      toTitle: to.record.title,
      toTypeLabel: RECORD_TYPE_LABELS[to.record.type],
      toStatus: to.record.authorityStatus,
      createdAt: new Date(),
    };
  });
}

async function wouldCreateParentOfCycle(db: DbOrTx, fromId: string, toId: string): Promise<boolean> {
  const visited = new Set<string>();
  const queue = [toId];
  while (queue.length) {
    const current = queue.shift()!;
    if (current === fromId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const next = await db.recordRelation.findMany({
      where: { fromRecordId: current, kind: "parent_of", from: { trashedAt: null }, to: { trashedAt: null } },
      select: { toRecordId: true },
    });
    for (const row of next) queue.push(row.toRecordId);
  }
  return false;
}

export async function removeRecordRelation(db: Db, projectId: string, relationId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const visibility = await relationVisibilityWhere(tx, projectId);
    const row = await tx.recordRelation.findFirst({
      where: { AND: [{ id: relationId }, visibility] },
      include: { from: { select: { title: true } }, to: { select: { title: true } } },
    });
    if (!row) throw rejected("That relationship is not available in this book.");
    await tx.recordRelation.delete({ where: { id: relationId } });
    await writeAudit(tx, {
      projectId,
      action: "record_relation.remove",
      actor: UI_ACTOR,
      summary: `Removed relationship between "${row.from.title}" and "${row.to.title}"`,
      details: {
        relationId,
        kind: row.kind,
        customLabel: row.customLabel,
        scope: row.scope,
        fromRecordId: row.fromRecordId,
        toRecordId: row.toRecordId,
      },
    });
  });
}