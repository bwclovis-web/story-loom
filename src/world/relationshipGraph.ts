const PLACE_RELATION_KINDS = ["part_of", "flows_into", "governed_by"] as const;
const PLACE_RELATION_LABELS: Record<(typeof PLACE_RELATION_KINDS)[number], string> = {
  part_of: "Part of",
  flows_into: "Flows into",
  governed_by: "Governed by",
};

const RECORD_RELATION_KINDS = [
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

const RECORD_RELATION_LABELS: Record<Exclude<(typeof RECORD_RELATION_KINDS)[number], "custom">, string> = {
  parent_of: "Parent of",
  sibling_of: "Sibling of",
  spouse_of: "Spouse of",
  member_of: "Member of",
  leads: "Leads",
  serves: "Serves",
  allied_with: "Allied with",
  rival_of: "Rival of",
};

function recordKindLabel(kind: (typeof RECORD_RELATION_KINDS)[number]): string {
  return kind === "custom" ? "Custom (record)" : RECORD_RELATION_LABELS[kind];
}

export type RelationshipEdgeFamily = "place" | "record";

export interface RelationshipEdge {
  id: string;
  fromRecordId: string;
  toRecordId: string;
  kind: string;
  kindLabel: string;
  family: RelationshipEdgeFamily;
}

export interface RelationshipNode {
  id: string;
  title: string;
  typeLabel: string;
  /** Set when the record has a primary profile image. */
  profileImageUrl?: string | null;
}

export interface RelationshipTreeNode {
  id: string;
  title: string;
  typeLabel: string;
  profileImageUrl?: string | null;
  children: RelationshipTreeNode[];
}

export const GRAPH_KIND_OPTIONS: { id: string; label: string; family: RelationshipEdgeFamily }[] = [
  ...PLACE_RELATION_KINDS.map((kind) => ({
    id: `place:${kind}`,
    label: PLACE_RELATION_LABELS[kind],
    family: "place" as const,
  })),
  ...RECORD_RELATION_KINDS.map((kind) => ({
    id: `record:${kind}`,
    label: recordKindLabel(kind),
    family: "record" as const,
  })),
];

export const DEFAULT_GRAPH_KINDS = new Set(GRAPH_KIND_OPTIONS.map((k) => k.id));

export function edgeKindKey(family: RelationshipEdgeFamily, kind: string): string {
  return `${family}:${kind}`;
}

function edgeAllowed(edge: RelationshipEdge, allowed: Set<string>): boolean {
  return allowed.has(edgeKindKey(edge.family, edge.kind));
}

/** Undirected hop expansion from `focusId`; empty focus returns the filtered full graph. */
export function subgraphByHops(
  nodes: readonly RelationshipNode[],
  edges: readonly RelationshipEdge[],
  focusId: string | null,
  steps: number,
  allowedKinds: Set<string>,
): { nodes: RelationshipNode[]; edges: RelationshipEdge[] } {
  const filtered = edges.filter((e) => edgeAllowed(e, allowedKinds));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  if (!focusId) {
    const nodeIds = new Set<string>();
    for (const e of filtered) {
      nodeIds.add(e.fromRecordId);
      nodeIds.add(e.toRecordId);
    }
    return {
      nodes: [...nodeIds].map((id) => byId.get(id)).filter((n): n is RelationshipNode => !!n),
      edges: filtered,
    };
  }
  if (!byId.has(focusId)) return { nodes: [], edges: [] };

  const adj = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a)!.add(b);
  };
  for (const e of filtered) {
    add(e.fromRecordId, e.toRecordId);
    add(e.toRecordId, e.fromRecordId);
  }

  const seen = new Set<string>([focusId]);
  let frontier = [focusId];
  for (let hop = 0; hop < steps && frontier.length; hop++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbor of adj.get(id) ?? []) {
        if (seen.has(neighbor)) continue;
        seen.add(neighbor);
        next.push(neighbor);
      }
    }
    frontier = next;
  }

  const edgeOut = filtered.filter((e) => seen.has(e.fromRecordId) && seen.has(e.toRecordId));
  return {
    nodes: [...seen].map((id) => byId.get(id)).filter((n): n is RelationshipNode => !!n),
    edges: edgeOut,
  };
}

/** Radial layout: focus (or first node) at center, others by BFS depth. */
export function layoutRadial(
  nodes: readonly RelationshipNode[],
  edges: readonly RelationshipEdge[],
  focusId: string | null,
  width: number,
  height: number,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  if (!nodes.length) return positions;
  const center = focusId && nodes.some((n) => n.id === focusId) ? focusId : nodes[0]!.id;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const a = adj.get(e.fromRecordId) ?? [];
    a.push(e.toRecordId);
    adj.set(e.fromRecordId, a);
    const b = adj.get(e.toRecordId) ?? [];
    b.push(e.fromRecordId);
    adj.set(e.toRecordId, b);
  }
  const depth = new Map<string, number>();
  const queue = [center];
  depth.set(center, 0);
  while (queue.length) {
    const id = queue.shift()!;
    for (const next of adj.get(id) ?? []) {
      if (depth.has(next)) continue;
      depth.set(next, depth.get(id)! + 1);
      queue.push(next);
    }
  }
  for (const n of nodes) if (!depth.has(n.id)) depth.set(n.id, 1);

  const layers = new Map<number, string[]>();
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 1;
    const list = layers.get(d) ?? [];
    list.push(n.id);
    layers.set(d, list);
  }

  const cx = width / 2;
  const cy = height / 2;
  const maxR = Math.min(width, height) * 0.42;
  positions.set(center, { x: cx, y: cy });
  for (const [d, ids] of layers) {
    if (d === 0) continue;
    const r = (maxR * d) / Math.max(1, layers.size - 1);
    ids.sort((a, b) => (byId.get(a)?.title ?? "").localeCompare(byId.get(b)?.title ?? ""));
    ids.forEach((id, i) => {
      const angle = (2 * Math.PI * i) / ids.length - Math.PI / 2;
      positions.set(id, { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
    });
  }
  return positions;
}

function pickEdges(edges: readonly RelationshipEdge[], family: RelationshipEdgeFamily, kinds: readonly string[]) {
  const set = new Set(kinds);
  return edges.filter((e) => e.family === family && set.has(e.kind));
}

function buildDirectedTree(
  nodes: readonly RelationshipNode[],
  edges: readonly RelationshipEdge[],
  childOfParent: (edge: RelationshipEdge) => { parentId: string; childId: string },
): RelationshipTreeNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parentOf = new Map<string, string>();
  const children = new Map<string, string[]>();
  for (const e of edges) {
    const { parentId, childId } = childOfParent(e);
    if (!byId.has(parentId) || !byId.has(childId)) continue;
    parentOf.set(childId, parentId);
    const list = children.get(parentId) ?? [];
    list.push(childId);
    children.set(parentId, list);
  }
  const roots = [...byId.keys()].filter((id) => !parentOf.has(id));
  const make = (id: string, trail: Set<string>): RelationshipTreeNode | null => {
    if (trail.has(id)) return null;
    const node = byId.get(id);
    if (!node) return null;
    const nextTrail = new Set(trail);
    nextTrail.add(id);
    const kids = (children.get(id) ?? [])
      .map((childId) => make(childId, nextTrail))
      .filter((c): c is RelationshipTreeNode => !!c)
      .sort((a, b) => a.title.localeCompare(b.title));
    return {
      id,
      title: node.title,
      typeLabel: node.typeLabel,
      profileImageUrl: node.profileImageUrl,
      children: kids,
    };
  };
  return roots
    .map((id) => make(id, new Set()))
    .filter((t): t is RelationshipTreeNode => !!t)
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** `parent_of`: from is parent, to is child; sibling/spouse listed as roots without nesting. */
export function buildFamilyForest(
  nodes: readonly RelationshipNode[],
  edges: readonly RelationshipEdge[],
): { tree: RelationshipTreeNode[]; loose: RelationshipEdge[] } {
  const parentEdges = pickEdges(edges, "record", ["parent_of"]);
  const tree = buildDirectedTree(nodes, parentEdges, (e) => ({ parentId: e.fromRecordId, childId: e.toRecordId }));
  const loose = pickEdges(edges, "record", ["sibling_of", "spouse_of"]);
  return { tree, loose };
}

/** `member_of`: member → organization; `leads` / `serves` treated as member → org for tree roots under org. */
export function buildOrganizationForest(nodes: readonly RelationshipNode[], edges: readonly RelationshipEdge[]): RelationshipTreeNode[] {
  const orgEdges = pickEdges(edges, "record", ["member_of", "leads", "serves"]);
  return buildDirectedTree(nodes, orgEdges, (e) => ({ parentId: e.toRecordId, childId: e.fromRecordId }));
}

export function buildGeographyForest(nodes: readonly RelationshipNode[], edges: readonly RelationshipEdge[]): RelationshipTreeNode[] {
  const partOf = pickEdges(edges, "place", ["part_of"]);
  return buildDirectedTree(nodes, partOf, (e) => ({ parentId: e.toRecordId, childId: e.fromRecordId }));
}
