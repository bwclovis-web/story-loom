import type { RelationshipEdge, RelationshipNode, RelationshipTreeNode } from "./relationshipGraph";
import { buildGeographyForest } from "./relationshipGraph";

export interface MapGeographyNode {
  id: string;
  title: string;
  children: MapGeographyNode[];
  pinId: string | null;
}

export function buildMapGeographyTree(
  nodes: readonly RelationshipNode[],
  edges: readonly RelationshipEdge[],
  pinsByRecordId: ReadonlyMap<string, string>,
): MapGeographyNode[] {
  const forest = buildGeographyForest(nodes, edges);
  const byId = new Map(nodes.map((node) => [node.id, node.title]));
  const mapNode = (node: RelationshipTreeNode): MapGeographyNode => ({
    id: node.id,
    title: byId.get(node.id) ?? node.title,
    pinId: pinsByRecordId.get(node.id) ?? null,
    children: node.children.map(mapNode),
  });
  return forest.map(mapNode);
}