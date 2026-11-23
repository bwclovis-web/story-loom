import type { RelationScope } from "@/domain/assignments";
import { newId } from "@/domain/ids";
import { errorIssue } from "@/domain/issues";
import { isLinkableReferenceType, isRecordType, RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import { isAuthorityStatus } from "@/domain/statuses";
import {
  isPlaceRelationKind,
  PLACE_RELATION_KINDS,
  PLACE_RELATION_LABELS,
  type PlaceRelationKind,
  type PlaceRelationView,
} from "@/world/placeRelations";
import type { Db, DbOrTx } from "../db";
import { writeAudit } from "./auditService";
import { MutationRejectedError, NotFoundError } from "./errors";
import {
  normalizeRelationScope,
  relationVisibilityWhere,
  resolveRelationEndpoint,
  resolveWritableRelationScope,
} from "./relationScope";

export {
  isPlaceRelationKind,
  PLACE_RELATION_KINDS,
  PLACE_RELATION_LABELS,
  type PlaceRelationKind,
  type PlaceRelationView,
};

/*
 * Explicit World place relationships. Independent of board cards and map pins:
 * moving cards or pins never creates or changes these rows.
 * scope book = visible only in owning project; series = across sibling books
 * when both endpoints are series-scoped World references.
 */

const UI_ACTOR = "author";

function rejected(message: string, recordId?: string): MutationRejectedError {
  return new MutationRejectedError([errorIssue("INVALID_REFERENCE", message, recordId ? { recordId } : {})]);
}

async function loadLiveRef(db: DbOrTx, projectId: string, recordId: string) {
  const available = await resolveRelationEndpoint(db, projectId, recordId);
  if (!available) throw rejected(`Record ${recordId} is not available in this book.`, recordId);
  if (!isLinkableReferenceType(available.record.type)) {
    throw rejected("Place relationships are only between reference records.", recordId);
  }
  if (!isAuthorityStatus(available.record.authorityStatus)) throw rejected("Unknown authority status.", recordId);
  return available;
}

function viewOf(
  r: {
    id: string;
    kind: string;
    scope?: string | null;
    fromRecordId: string;
    toRecordId: string;
    createdAt: Date;
    from: { title: string; type: string; authorityStatus: string };
    to: { title: string; type: string; authorityStatus: string };
  },
): PlaceRelationView | null {
  if (!isPlaceRelationKind(r.kind)) return null;
  if (!isRecordType(r.from.type) || !isRecordType(r.to.type)) return null;
  if (!isAuthorityStatus(r.from.authorityStatus) || !isAuthorityStatus(r.to.authorityStatus)) return null;
  return {
    id: r.id,
    kind: r.kind,
    kindLabel: PLACE_RELATION_LABELS[r.kind],
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

export async function listPlaceRelationsForRecord(
  db: DbOrTx,
  projectId: string,
  recordId: string,
): Promise<{ outgoing: PlaceRelationView[]; incoming: PlaceRelationView[] }> {
  const visibility = await relationVisibilityWhere(db, projectId);
  const rows = await db.placeRelation.findMany({
    where: {
      AND: [
        visibility,
        { OR: [{ fromRecordId: recordId }, { toRecordId: recordId }] },
        { from: { trashedAt: null } },
        { to: { trashedAt: null } },
      ],
    },
    orderBy: [{ kind: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    include: {
      from: { select: { title: true, type: true, authorityStatus: true } },
      to: { select: { title: true, type: true, authorityStatus: true } },
    },
  });
  const outgoing: PlaceRelationView[] = [];
  const incoming: PlaceRelationView[] = [];
  for (const r of rows) {
    const v = viewOf(r);
    if (!v) continue;
    if (r.fromRecordId === recordId) outgoing.push(v);
    if (r.toRecordId === recordId) incoming.push(v);
  }
  return { outgoing, incoming };
}

export async function addPlaceRelation(
  db: Db,
  projectId: string,
  input: { fromRecordId: string; toRecordId: string; kind: PlaceRelationKind; scope?: RelationScope | string | null },
): Promise<PlaceRelationView> {
  if (!isPlaceRelationKind(input.kind)) throw rejected("Unknown relationship kind.");
  if (input.fromRecordId === input.toRecordId) throw rejected("A place cannot relate to itself.", input.fromRecordId);

  return db.$transaction(async (tx) => {
    const project = await tx.project.findFirst({ where: { id: projectId, trashedAt: null }, select: { id: true } });
    if (!project) throw new NotFoundError(`Project ${projectId} not found`);
    const from = await loadLiveRef(tx, projectId, input.fromRecordId);
    const to = await loadLiveRef(tx, projectId, input.toRecordId);
    const scope = await resolveWritableRelationScope(tx, projectId, from, to, input.scope);
    const existing = await tx.placeRelation.findUnique({
      where: {
        fromRecordId_toRecordId_kind: {
          fromRecordId: from.record.id,
          toRecordId: to.record.id,
          kind: input.kind,
        },
      },
    });
    if (existing) throw rejected(`That "${PLACE_RELATION_LABELS[input.kind]}" relationship already exists.`, from.record.id);

    if (input.kind === "part_of") {
      const cycle = await wouldCreatePartOfCycle(tx, from.record.id, to.record.id);
      if (cycle) throw rejected("That Part of link would create a cycle.", from.record.id);
    }

    const id = newId("plr");
    await tx.placeRelation.create({
      data: {
        id,
        projectId,
        fromRecordId: from.record.id,
        toRecordId: to.record.id,
        kind: input.kind,
        scope,
      },
    });
    await writeAudit(tx, {
      projectId,
      action: "place_relation.add",
      actor: UI_ACTOR,
      summary: `"${from.record.title}" ${PLACE_RELATION_LABELS[input.kind].toLowerCase()} "${to.record.title}"`,
      details: {
        relationId: id,
        kind: input.kind,
        scope,
        fromRecordId: from.record.id,
        toRecordId: to.record.id,
      },
    });
    return {
      id,
      kind: input.kind,
      kindLabel: PLACE_RELATION_LABELS[input.kind],
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

async function wouldCreatePartOfCycle(db: DbOrTx, fromId: string, toId: string): Promise<boolean> {
  const visited = new Set<string>();
  const queue = [toId];
  while (queue.length) {
    const current = queue.shift()!;
    if (current === fromId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const next = await db.placeRelation.findMany({
      where: { fromRecordId: current, kind: "part_of", from: { trashedAt: null }, to: { trashedAt: null } },
      select: { toRecordId: true },
    });
    for (const row of next) queue.push(row.toRecordId);
  }
  return false;
}

export async function removePlaceRelation(db: Db, projectId: string, relationId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const visibility = await relationVisibilityWhere(tx, projectId);
    const row = await tx.placeRelation.findFirst({
      where: { AND: [{ id: relationId }, visibility] },
      include: { from: { select: { title: true } }, to: { select: { title: true } } },
    });
    if (!row) throw rejected("That relationship is not available in this book.");
    await tx.placeRelation.delete({ where: { id: relationId } });
    await writeAudit(tx, {
      projectId,
      action: "place_relation.remove",
      actor: UI_ACTOR,
      summary: `Removed relationship between "${row.from.title}" and "${row.to.title}"`,
      details: {
        relationId,
        kind: row.kind,
        scope: row.scope,
        fromRecordId: row.fromRecordId,
        toRecordId: row.toRecordId,
      },
    });
  });
}
