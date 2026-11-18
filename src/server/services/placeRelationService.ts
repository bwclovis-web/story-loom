import { newId } from "@/domain/ids";
import { errorIssue } from "@/domain/issues";
import { isLinkableReferenceType, isRecordType, RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import { isAuthorityStatus, type AuthorityStatus } from "@/domain/statuses";
import type { Db, DbOrTx } from "../db";
import { writeAudit } from "./auditService";
import { MutationRejectedError, NotFoundError } from "./errors";

/*
 * Explicit World place relationships. Independent of board cards and map pins:
 * moving cards or pins never creates or changes these rows.
 */

const UI_ACTOR = "author";

export const PLACE_RELATION_KINDS = ["part_of", "flows_into", "governed_by"] as const;
export type PlaceRelationKind = (typeof PLACE_RELATION_KINDS)[number];

export const PLACE_RELATION_LABELS: Record<PlaceRelationKind, string> = {
  part_of: "Part of",
  flows_into: "Flows into",
  governed_by: "Governed by",
};

export function isPlaceRelationKind(v: string): v is PlaceRelationKind {
  return (PLACE_RELATION_KINDS as readonly string[]).includes(v);
}

export interface PlaceRelationView {
  id: string;
  kind: PlaceRelationKind;
  kindLabel: string;
  fromRecordId: string;
  fromTitle: string;
  fromTypeLabel: string;
  fromStatus: AuthorityStatus;
  toRecordId: string;
  toTitle: string;
  toTypeLabel: string;
  toStatus: AuthorityStatus;
  createdAt: Date;
}

function rejected(message: string, recordId?: string): MutationRejectedError {
  return new MutationRejectedError([errorIssue("INVALID_REFERENCE", message, recordId ? { recordId } : {})]);
}

async function loadLiveRef(db: DbOrTx, projectId: string, recordId: string) {
  const row = await db.record.findFirst({
    where: { id: recordId, projectId, trashedAt: null },
    select: { id: true, title: true, type: true, authorityStatus: true },
  });
  if (!row) throw rejected(`Record ${recordId} does not exist in this project.`, recordId);
  if (!isRecordType(row.type) || !isLinkableReferenceType(row.type)) {
    throw rejected("Place relationships are only between reference records.", recordId);
  }
  if (!isAuthorityStatus(row.authorityStatus)) throw rejected("Unknown authority status.", recordId);
  return { ...row, type: row.type, authorityStatus: row.authorityStatus };
}

function viewOf(
  r: {
    id: string;
    kind: string;
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
  const rows = await db.placeRelation.findMany({
    where: {
      projectId,
      OR: [{ fromRecordId: recordId }, { toRecordId: recordId }],
      from: { trashedAt: null },
      to: { trashedAt: null },
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
  input: { fromRecordId: string; toRecordId: string; kind: PlaceRelationKind },
): Promise<PlaceRelationView> {
  if (!isPlaceRelationKind(input.kind)) throw rejected("Unknown relationship kind.");
  if (input.fromRecordId === input.toRecordId) throw rejected("A place cannot relate to itself.", input.fromRecordId);

  return db.$transaction(async (tx) => {
    const project = await tx.project.findFirst({ where: { id: projectId, trashedAt: null }, select: { id: true } });
    if (!project) throw new NotFoundError(`Project ${projectId} not found`);
    const from = await loadLiveRef(tx, projectId, input.fromRecordId);
    const to = await loadLiveRef(tx, projectId, input.toRecordId);
    const existing = await tx.placeRelation.findUnique({
      where: {
        fromRecordId_toRecordId_kind: {
          fromRecordId: from.id,
          toRecordId: to.id,
          kind: input.kind,
        },
      },
    });
    if (existing) throw rejected(`That "${PLACE_RELATION_LABELS[input.kind]}" relationship already exists.`, from.id);

    const id = newId("plr");
    await tx.placeRelation.create({
      data: {
        id,
        projectId,
        fromRecordId: from.id,
        toRecordId: to.id,
        kind: input.kind,
      },
    });
    await writeAudit(tx, {
      projectId,
      action: "place_relation.add",
      actor: UI_ACTOR,
      summary: `"${from.title}" ${PLACE_RELATION_LABELS[input.kind].toLowerCase()} "${to.title}"`,
      details: { relationId: id, kind: input.kind, fromRecordId: from.id, toRecordId: to.id },
    });
    return {
      id,
      kind: input.kind,
      kindLabel: PLACE_RELATION_LABELS[input.kind],
      fromRecordId: from.id,
      fromTitle: from.title,
      fromTypeLabel: RECORD_TYPE_LABELS[from.type],
      fromStatus: from.authorityStatus,
      toRecordId: to.id,
      toTitle: to.title,
      toTypeLabel: RECORD_TYPE_LABELS[to.type],
      toStatus: to.authorityStatus,
      createdAt: new Date(),
    };
  });
}

export async function removePlaceRelation(db: Db, projectId: string, relationId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const row = await tx.placeRelation.findFirst({
      where: { id: relationId, projectId },
      include: { from: { select: { title: true } }, to: { select: { title: true } } },
    });
    if (!row) throw rejected("That relationship is not in this project.");
    await tx.placeRelation.delete({ where: { id: relationId } });
    await writeAudit(tx, {
      projectId,
      action: "place_relation.remove",
      actor: UI_ACTOR,
      summary: `Removed relationship between "${row.from.title}" and "${row.to.title}"`,
      details: { relationId, kind: row.kind, fromRecordId: row.fromRecordId, toRecordId: row.toRecordId },
    });
  });
}
