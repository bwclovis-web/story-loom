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
import { relationVisibilityWhere } from "./relationScope";
import { listAvailableReferences, resolveAvailableReference } from "./seriesBibleService";
import type { RelationshipEdge, RelationshipNode } from "@/world/relationshipGraph";
import { isWorldType } from "@/ui/world";
import { resolveRecordTaxonomy, taxonomyNavSummary } from "@/world/taxonomy";
import { seriesBookLabel } from "@/world/seriesHome";

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
  const nodes = await resolveGraphNodes(db, projectId, [...nodeIds]);
  const available = await listAvailableReferences(db, projectId, { linkableOnly: true });
  const focusChoices = available.flatMap((entry) => {
    if (!isRecordRelationEndpoint(entry.record.type, entry.record.fields)) return [];
    return [
      {
        id: entry.record.id,
        title: entry.record.title,
        typeLabel: RECORD_TYPE_LABELS[entry.record.type],
        homeProjectId: entry.home?.projectId ?? null,
        homeLabel: entry.home ? seriesBookLabel(entry.home) : null,
        worldScope: entry.worldScope,
        taxonomy: entry.taxonomy,
      },
    ];
  });
  return { nodes, edges, focusChoices };
}

function taxonomyForType(type: string, fields: unknown) {
  if (!isRecordType(type) || !isWorldType(type)) return null;
  const parsed = typeof fields === "string" ? parseJsonObject(fields) : (fields as Record<string, unknown>);
  return taxonomyNavSummary(resolveRecordTaxonomy({ type, fields: parsed ?? {} }));
}

async function resolveGraphNodes(
  db: DbOrTx,
  viewingProjectId: string,
  nodeIds: string[],
): Promise<RelationshipNode[]> {
  if (!nodeIds.length) return [];
  const resolved = await Promise.all(
    nodeIds.map(async (id) => [id, await resolveAvailableReference(db, viewingProjectId, id)] as const),
  );
  const nodes: RelationshipNode[] = [];
  const byHome = new Map<string, string[]>();
  for (const [id, available] of resolved) {
    if (!available) continue;
    const homeId = available.home?.projectId ?? viewingProjectId;
    byHome.set(homeId, [...(byHome.get(homeId) ?? []), id]);
    nodes.push({
      id,
      title: available.record.title,
      typeLabel: RECORD_TYPE_LABELS[available.record.type],
      homeProjectId: available.home?.projectId ?? null,
      homeLabel: available.home ? seriesBookLabel(available.home) : null,
      worldScope: available.worldScope,
      taxonomy: available.taxonomy ?? taxonomyForType(available.record.type, available.record.fields),
      recordType: available.record.type,
      authorityStatus: available.record.authorityStatus,
    });
  }
  for (const [homeId, ids] of byHome) {
    const primaryByRecord = await primaryRecordImagesByRecordId(db, homeId, ids);
    for (const node of nodes) {
      if (!primaryByRecord.has(node.id)) continue;
      node.profileImageUrl = recordImagePublicPath(viewingProjectId, primaryByRecord.get(node.id)!);
    }
  }
  nodes.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  return nodes;
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

  const [records, available] = await Promise.all([
    db.record.findMany({
      where: { projectId, trashedAt: null },
      select: {
        id: true,
        title: true,
        type: true,
        fields: true,
        authorityStatus: true,
        draftId: true,
        worldScope: true,
      },
      orderBy: [{ title: "asc" }, { id: "asc" }],
    }),
    listAvailableReferences(db, projectId),
  ]);

  const primaryByRecord = await primaryRecordImagesByRecordId(
    db,
    projectId,
    records.map((r) => r.id),
  );

  const byId = new Map<string, RelationshipNode>();
  for (const r of records) {
    if (!isRecordType(r.type)) continue;
    byId.set(r.id, {
      id: r.id,
      title: r.title,
      typeLabel: RECORD_TYPE_LABELS[r.type],
      recordType: r.type,
      authorityStatus: isAuthorityStatus(r.authorityStatus) ? r.authorityStatus : null,
      draftId: r.draftId,
      worldScope: r.worldScope === "series" || r.worldScope === "book" ? r.worldScope : null,
      taxonomy: taxonomyForType(r.type, r.fields),
      profileImageUrl: primaryByRecord.has(r.id)
        ? recordImagePublicPath(projectId, primaryByRecord.get(r.id)!)
        : null,
    });
  }
  for (const entry of available) {
    if (byId.has(entry.record.id)) {
      const existing = byId.get(entry.record.id)!;
      existing.homeProjectId = entry.home?.projectId ?? null;
      existing.homeLabel = entry.home ? seriesBookLabel(entry.home) : null;
      existing.worldScope = entry.worldScope;
      existing.taxonomy = entry.taxonomy ?? existing.taxonomy;
      continue;
    }
    byId.set(entry.record.id, {
      id: entry.record.id,
      title: entry.record.title,
      typeLabel: RECORD_TYPE_LABELS[entry.record.type],
      recordType: entry.record.type,
      authorityStatus: entry.record.authorityStatus,
      draftId: null,
      homeProjectId: entry.home?.projectId ?? null,
      homeLabel: entry.home ? seriesBookLabel(entry.home) : null,
      worldScope: entry.worldScope,
      taxonomy: entry.taxonomy ?? taxonomyForType(entry.record.type, entry.record.fields),
    });
  }

  const allNodes = [...byId.values()].sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));

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
    const visibility = await relationVisibilityWhere(db, projectId);
    const rows = await db.placeRelation.findMany({
      where: { AND: [visibility, { from: { trashedAt: null } }, { to: { trashedAt: null } }] },
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
          scope: r.scope === "series" ? "series" : "book",
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
    const visibility = await relationVisibilityWhere(db, projectId);
    const rows = await db.recordRelation.findMany({
      where: { AND: [visibility, { from: { trashedAt: null } }, { to: { trashedAt: null } }] },
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
          scope: r.scope === "series" ? "series" : "book",
        },
      ];
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2021") return [];
    throw error;
  }
}