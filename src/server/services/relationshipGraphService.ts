import { isRecordType, RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import { isAuthorityStatus } from "@/domain/statuses";
import { parseJsonObject } from "@/domain/json";
import type { CrossRefIndex } from "@/writing/crossRefs";
import type { DbOrTx } from "../db";
import { loadCrossRefIndex } from "./crossRefService";
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

/** Full knowledge graph: explicit relations, reference links, and computed mentions. */
export interface ProjectAllConnectionsGraph extends ProjectRelationshipGraph {
  allNodes: RelationshipNode[];
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

export async function loadProjectAllConnectionsGraph(
  db: DbOrTx,
  projectId: string,
): Promise<ProjectAllConnectionsGraph> {
  const [placeRows, recordRows, linkRows, crossRefs] = await Promise.all([
    listPlaceEdges(db, projectId),
    listRecordEdges(db, projectId),
    listRecordLinkEdges(db, projectId),
    loadCrossRefIndex(db, projectId),
  ]);
  const mentionRows = buildMentionEdges(crossRefs);
  const edges = [...placeRows, ...recordRows, ...linkRows, ...mentionRows];

  const records = await db.record.findMany({
    where: { projectId, trashedAt: null },
    select: { id: true, title: true, type: true, fields: true, authorityStatus: true, draftId: true },
    orderBy: [{ title: "asc" }, { id: "asc" }],
  });

  const primaryByRecord = await primaryRecordImagesByRecordId(
    db,
    projectId,
    records.map((r) => r.id),
  );

  const allNodes: RelationshipNode[] = records.flatMap((r) =>
    isRecordType(r.type)
      ? [
          {
            id: r.id,
            title: r.title,
            typeLabel: RECORD_TYPE_LABELS[r.type],
            recordType: r.type,
            authorityStatus: isAuthorityStatus(r.authorityStatus) ? r.authorityStatus : null,
            draftId: r.draftId,
            profileImageUrl: primaryByRecord.has(r.id)
              ? recordImagePublicPath(projectId, primaryByRecord.get(r.id)!)
              : null,
          },
        ]
      : [],
  );

  const connectedIds = new Set<string>();
  for (const e of edges) {
    connectedIds.add(e.fromRecordId);
    connectedIds.add(e.toRecordId);
  }
  const nodes = allNodes.filter((n) => connectedIds.has(n.id));
  const focusChoices = allNodes.filter((n) => connectedIds.has(n.id)).slice(0, 500);

  return { nodes, allNodes, edges, focusChoices };
}

/** Mention edges from a loaded cross-reference index (read-only, not stored). */
export function buildMentionEdges(index: CrossRefIndex): RelationshipEdge[] {
  const edges: RelationshipEdge[] = [];
  const seen = new Set<string>();
  const add = (edge: RelationshipEdge) => {
    const key = `${edge.fromRecordId}:${edge.toRecordId}:${edge.kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push(edge);
  };

  for (const [proseId, hits] of index.named) {
    const prose = index.records.get(proseId);
    if (!prose) continue;
    for (const targetId of hits.keys()) {
      const target = index.records.get(targetId);
      if (!target) continue;
      add({
        id: `mention:named:${proseId}:${targetId}`,
        fromRecordId: proseId,
        toRecordId: targetId,
        kind: "named_in",
        kindLabel: "Named in manuscript",
        family: "mention",
      });
    }
  }

  const fileOwner = new Map<string, string>();
  for (const [key, targets] of index.files) {
    const best = targets[0];
    if (best) fileOwner.set(key, best.recordId);
  }
  const idOwner = new Map<string, string>();
  for (const [id, targets] of index.ids) {
    const best = targets[0];
    if (best) idOwner.set(id, best.recordId);
  }

  for (const [fromId, mention] of index.mentions) {
    for (const [key] of mention.files) {
      const owner = fileOwner.get(key);
      if (!owner || owner === fromId) continue;
      add({
        id: `mention:file:${fromId}:${owner}:${key}`,
        fromRecordId: fromId,
        toRecordId: owner,
        kind: "mentioned_by",
        kindLabel: "Mentioned by text",
        family: "mention",
      });
    }
    for (const id of mention.ids) {
      const owner = idOwner.get(id);
      if (!owner || owner === fromId) continue;
      add({
        id: `mention:id:${fromId}:${owner}:${id}`,
        fromRecordId: fromId,
        toRecordId: owner,
        kind: "mentioned_by",
        kindLabel: "Mentioned by text",
        family: "mention",
      });
    }
  }

  return edges;
}

async function listRecordLinkEdges(db: DbOrTx, projectId: string): Promise<RelationshipEdge[]> {
  if (!("recordLink" in db) || !(db as { recordLink?: { findMany: unknown } }).recordLink) return [];
  try {
    const rows = await db.recordLink.findMany({
      where: { projectId, from: { trashedAt: null }, to: { trashedAt: null } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.map((r) => ({
      id: r.id,
      fromRecordId: r.fromRecordId,
      toRecordId: r.toRecordId,
      kind: "linked",
      kindLabel: "Linked reference",
      family: "link" as const,
    }));
  } catch (error) {
    if ((error as { code?: string }).code === "P2021") return [];
    throw error;
  }
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