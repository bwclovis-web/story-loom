import { newId } from "@/domain/ids";
import { errorIssue } from "@/domain/issues";
import { isLinkableReferenceType, isRecordType, RECORD_TYPE_LABELS, type RecordType } from "@/domain/recordTypes";
import { isAuthorityStatus, type AuthorityStatus } from "@/domain/statuses";
import { parseJsonObject } from "@/domain/json";
import { worldbuildingKindFromFields } from "@/world/worldKinds";
import type { Db, DbOrTx } from "../db";
import { writeAudit } from "./auditService";
import { MutationRejectedError, NotFoundError } from "./errors";

/*
 * Explicit relationships between characters, organizations, and places the author
 * chose as endpoints. Independent of board cards and map pins: moving cards or
 * pins never creates or changes these rows.
 */

const UI_ACTOR = "author";
export const MAX_RECORD_RELATION_LABEL_CHARS = 64;

export const RECORD_RELATION_KINDS = [
  "parent_of",
  "sibling_of",
  "spouse_of",
  "member_of",
  "leads",
  "serves",
  "allied_with",
  "rival_of",
  "custom",
] as const;

export type RecordRelationKind = (typeof RECORD_RELATION_KINDS)[number];

export const RECORD_RELATION_LABELS: Record<Exclude<RecordRelationKind, "custom">, string> = {
  parent_of: "Parent of",
  sibling_of: "Sibling of",
  spouse_of: "Spouse of",
  member_of: "Member of",
  leads: "Leads",
  serves: "Serves",
  allied_with: "Allied with",
  rival_of: "Rival of",
};

export function isRecordRelationKind(v: string): v is RecordRelationKind {
  return (RECORD_RELATION_KINDS as readonly string[]).includes(v);
}

export function recordRelationKindLabel(kind: RecordRelationKind, customLabel = ""): string {
  if (kind === "custom") {
    const label = customLabel.trim();
    return label || "Custom";
  }
  return RECORD_RELATION_LABELS[kind];
}

/** Records that may appear on the Relationships tab or as relation endpoints. */
export function isRecordRelationEndpoint(type: RecordType, fields: unknown): boolean {
  if (type === "character_dossier") return true;
  if (type === "worldbuilding") {
    const kind = worldbuildingKindFromFields(fields);
    return kind === "organization" || kind === "place";
  }
  return false;
}

export function recordShowsRecordRelations(type: RecordType, fields: unknown): boolean {
  return isRecordRelationEndpoint(type, fields);
}

/** Reference records that may be the other end of a record relationship. */
export async function listRecordRelationEndpointChoices(
  db: DbOrTx,
  projectId: string,
): Promise<Array<{ id: string; title: string; typeLabel: string }>> {
  const rows = await db.record.findMany({
    where: { projectId, trashedAt: null },
    orderBy: [{ title: "asc" }, { id: "asc" }],
    select: { id: true, title: true, type: true, fields: true },
  });
  return rows.flatMap((row) => {
    if (!isRecordType(row.type)) return [];
    if (!isRecordRelationEndpoint(row.type, parseJsonObject(row.fields))) return [];
    return [{ id: row.id, title: row.title, typeLabel: RECORD_TYPE_LABELS[row.type] }];
  });
}

export interface RecordRelationView {
  id: string;
  kind: RecordRelationKind;
  kindLabel: string;
  customLabel: string;
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
  const row = await db.record.findFirst({
    where: { id: recordId, projectId, trashedAt: null },
    select: { id: true, title: true, type: true, authorityStatus: true, fields: true },
  });
  if (!row) throw rejected(`Record ${recordId} does not exist in this project.`, recordId);
  if (!isRecordType(row.type) || !isLinkableReferenceType(row.type)) {
    throw rejected("Relationships are only between reference records.", recordId);
  }
  const fields = parseJsonObject(row.fields);
  if (!isRecordRelationEndpoint(row.type, fields)) {
    throw rejected("This record type cannot be a relationship endpoint.", recordId);
  }
  if (!isAuthorityStatus(row.authorityStatus)) throw rejected("Unknown authority status.", recordId);
  return { ...row, type: row.type, authorityStatus: row.authorityStatus };
}

function viewOf(
  r: {
    id: string;
    kind: string;
    customLabel: string;
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
    const rows = await db.recordRelation.findMany({
      where: {
        projectId,
        OR: [{ fromRecordId: recordId }, { toRecordId: recordId }],
        from: { trashedAt: null },
        to: { trashedAt: null },
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
  input: { fromRecordId: string; toRecordId: string; kind: RecordRelationKind; customLabel?: string },
): Promise<RecordRelationView> {
  if (!isRecordRelationKind(input.kind)) throw rejected("Unknown relationship kind.");
  if (input.fromRecordId === input.toRecordId) throw rejected("A record cannot relate to itself.", input.fromRecordId);
  const customLabel = normalizeCustomLabel(input.kind, input.customLabel);

  return db.$transaction(async (tx) => {
    const project = await tx.project.findFirst({ where: { id: projectId, trashedAt: null }, select: { id: true } });
    if (!project) throw new NotFoundError(`Project ${projectId} not found`);
    const from = await loadEndpoint(tx, projectId, input.fromRecordId);
    const to = await loadEndpoint(tx, projectId, input.toRecordId);
    const existing = await tx.recordRelation.findUnique({
      where: {
        fromRecordId_toRecordId_kind_customLabel: {
          fromRecordId: from.id,
          toRecordId: to.id,
          kind: input.kind,
          customLabel,
        },
      },
    });
    if (existing) {
      throw rejected(`That "${recordRelationKindLabel(input.kind, customLabel)}" relationship already exists.`, from.id);
    }

    const id = newId("rrl");
    await tx.recordRelation.create({
      data: {
        id,
        projectId,
        fromRecordId: from.id,
        toRecordId: to.id,
        kind: input.kind,
        customLabel,
      },
    });
    const label = recordRelationKindLabel(input.kind, customLabel);
    await writeAudit(tx, {
      projectId,
      action: "record_relation.add",
      actor: UI_ACTOR,
      summary: `"${from.title}" ${label.toLowerCase()} "${to.title}"`,
      details: { relationId: id, kind: input.kind, customLabel, fromRecordId: from.id, toRecordId: to.id },
    });
    return {
      id,
      kind: input.kind,
      kindLabel: label,
      customLabel,
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

export async function removeRecordRelation(db: Db, projectId: string, relationId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const row = await tx.recordRelation.findFirst({
      where: { id: relationId, projectId },
      include: { from: { select: { title: true } }, to: { select: { title: true } } },
    });
    if (!row) throw rejected("That relationship is not in this project.");
    await tx.recordRelation.delete({ where: { id: relationId } });
    await writeAudit(tx, {
      projectId,
      action: "record_relation.remove",
      actor: UI_ACTOR,
      summary: `Removed relationship between "${row.from.title}" and "${row.to.title}"`,
      details: { relationId, kind: row.kind, customLabel: row.customLabel, fromRecordId: row.fromRecordId, toRecordId: row.toRecordId },
    });
  });
}