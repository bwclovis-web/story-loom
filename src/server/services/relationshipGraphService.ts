import { isRecordType, RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import { parseJsonObject } from "@/domain/json";
import type { DbOrTx } from "../db";
import { PLACE_RELATION_LABELS, isPlaceRelationKind } from "./placeRelationService";
import {
  isRecordRelationEndpoint,
  isRecordRelationKind,
  recordRelationKindLabel,
} from "./recordRelationService";
import { primaryRecordImagesByRecordId, recordImagePublicPath } from "./imageService";
import type { RelationshipEdge, RelationshipNode } from "@/world/relationshipGraph";

export interface ProjectRelationshipGraph {
  nodes: RelationshipNode[];
  edges: RelationshipEdge[];
  /** Records that may appear as focus (any endpoint with at least one edge). */
  focusChoices: RelationshipNode[];
}

export async function loadProjectRelationshipGraph(db: DbOrTx, projectId: string): Promise<ProjectRelationshipGraph> {
  const [placeRows, recordRows] = await Promise.all([
    listPlaceEdges(db, projectId),
    listRecordEdges(db, projectId),
  ]);
  const edges = [...placeRows, ...recordRows];
  const nodeIds = new Set<string>();
  for (const e of edges) {
    nodeIds.add(e.fromRecordId);
    nodeIds.add(e.toRecordId);
  }
  const records =
    nodeIds.size > 0
      ? await db.record.findMany({
          where: { projectId, trashedAt: null, id: { in: [...nodeIds] } },
          select: { id: true, title: true, type: true, fields: true },
          orderBy: [{ title: "asc" }, { id: "asc" }],
        })
      : [];
  const primaryByRecord = await primaryRecordImagesByRecordId(db, projectId, [...nodeIds]);
  const nodes: RelationshipNode[] = records.flatMap((r) =>
    isRecordType(r.type)
      ? [
          {
            id: r.id,
            title: r.title,
            typeLabel: RECORD_TYPE_LABELS[r.type],
            profileImageUrl: primaryByRecord.has(r.id)
              ? recordImagePublicPath(projectId, primaryByRecord.get(r.id)!)
              : null,
          },
        ]
      : [],
  );
  const choiceRows = await db.record.findMany({
    where: { projectId, trashedAt: null, type: { in: ["character_dossier", "worldbuilding"] } },
    select: { id: true, title: true, type: true, fields: true },
    orderBy: [{ title: "asc" }, { id: "asc" }],
  });
  const focusChoices = choiceRows.flatMap((r) => {
    if (!isRecordType(r.type)) return [];
    if (!isRecordRelationEndpoint(r.type, parseJsonObject(r.fields))) return [];
    return [{ id: r.id, title: r.title, typeLabel: RECORD_TYPE_LABELS[r.type] }];
  });
  return { nodes, edges, focusChoices };
}

async function listPlaceEdges(db: DbOrTx, projectId: string): Promise<RelationshipEdge[]> {
  if (!("placeRelation" in db) || !(db as { placeRelation?: { findMany: unknown } }).placeRelation) return [];
  try {
    const rows = await db.placeRelation.findMany({
      where: { projectId, from: { trashedAt: null }, to: { trashedAt: null } },
      orderBy: [{ kind: "asc" }, { id: "asc" }],
    });
    return rows.flatMap((r) => {
      if (!isPlaceRelationKind(r.kind)) return [];
      return [
        {
          id: r.id,
          fromRecordId: r.fromRecordId,
          toRecordId: r.toRecordId,
          kind: r.kind,
          kindLabel: PLACE_RELATION_LABELS[r.kind],
          family: "place" as const,
        },
      ];
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2021") return [];
    throw error;
  }
}

async function listRecordEdges(db: DbOrTx, projectId: string): Promise<RelationshipEdge[]> {
  if (!("recordRelation" in db) || !(db as { recordRelation?: { findMany: unknown } }).recordRelation) return [];
  try {
    const rows = await db.recordRelation.findMany({
      where: { projectId, from: { trashedAt: null }, to: { trashedAt: null } },
      orderBy: [{ kind: "asc" }, { customLabel: "asc" }, { id: "asc" }],
    });
    return rows.flatMap((r) => {
      if (!isRecordRelationKind(r.kind)) return [];
      return [
        {
          id: r.id,
          fromRecordId: r.fromRecordId,
          toRecordId: r.toRecordId,
          kind: r.kind,
          kindLabel: recordRelationKindLabel(r.kind, r.customLabel),
          family: "record" as const,
        },
      ];
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2021") return [];
    throw error;
  }
}