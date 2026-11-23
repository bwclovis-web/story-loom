import type { TaxonomyNavSummary } from "@/world/taxonomy";
import {
  recordMatchesTaxonomyFilter,
  taxonomyFilterActive,
  type TaxonomyFilterValue,
} from "@/world/taxonomyDiscovery";
import { isRecordRelationEndpoint } from "@/world/recordRelations";
import type { RecordType } from "@/domain/recordTypes";
import type { WorldScope } from "@/domain/assignments";

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

export type RelationshipEdgeFamily = "place" | "record" | "link" | "mention";

const LINK_RELATION_LABELS = { linked: "Linked reference" } as const;
const MENTION_RELATION_LABELS = {
  named_in: "Named in manuscript",
  mentioned_by: "Mentioned by text",
} as const;

export interface RelationshipEdge {
  id: string;
  fromRecordId: string;
  toRecordId: string;
  kind: string;
  kindLabel: string;
  family: RelationshipEdgeFamily;
  /** book | series when the edge is an explicit place/record relation. */
  scope?: "book" | "series";
}

export interface RelationshipNode {
  id: string;
  title: string;
  typeLabel: string;
  /** Set when the record has a primary profile image. */
  profileImageUrl?: string | null;
  /** Populated on the all-connections graph for filters. */
  recordType?: string;
  authorityStatus?: string | null;
  draftId?: string | null;
  /** Home book project id when this node is a series-shared sibling reference. */
  homeProjectId?: string | null;
  homeLabel?: string | null;
  worldScope?: WorldScope | string | null;
  taxonomy?: TaxonomyNavSummary | null;
}

export type RelationshipNeighborMode = "matching_only" | "with_neighbors";

export interface TaxonomyGraphFilterResult {
  nodes: RelationshipNode[];
  edges: RelationshipEdge[];
  matchingIds: Set<string>;
  neighborIds: Set<string>;
}

/**
 * Filter graph nodes by taxonomy. `with_neighbors` keeps 1-hop neighbors of
 * matching nodes; `matching_only` keeps only matching nodes and edges between them.
 */
export function filterGraphByTaxonomy(
  nodes: readonly RelationshipNode[],
  edges: readonly RelationshipEdge[],
  filter: TaxonomyFilterValue,
  neighborMode: RelationshipNeighborMode = "with_neighbors",
  allowedKinds?: Set<string>,
): TaxonomyGraphFilterResult {
  if (!taxonomyFilterActive(filter)) {
    return {
      nodes: [...nodes],
      edges: [...edges],
      matchingIds: new Set(),
      neighborIds: new Set(),
    };
  }
  const matchingIds = new Set(
    nodes.filter((n) => recordMatchesTaxonomyFilter(n.taxonomy, filter)).map((n) => n.id),
  );
  const kindOk = (edge: RelationshipEdge) =>
    !allowedKinds || allowedKinds.has(edgeKindKey(edge.family, edge.kind));
  const visibleEdges = edges.filter(kindOk);

  if (neighborMode === "matching_only") {
    const edgeOut = visibleEdges.filter(
      (e) => matchingIds.has(e.fromRecordId) && matchingIds.has(e.toRecordId),
    );
    return {
      nodes: nodes.filter((n) => matchingIds.has(n.id)),
      edges: edgeOut,
      matchingIds,
      neighborIds: new Set(),
    };
  }

  const neighborIds = new Set<string>();
  for (const e of visibleEdges) {
    if (matchingIds.has(e.fromRecordId) && !matchingIds.has(e.toRecordId)) neighborIds.add(e.toRecordId);
    if (matchingIds.has(e.toRecordId) && !matchingIds.has(e.fromRecordId)) neighborIds.add(e.fromRecordId);
  }
  const keep = new Set([...matchingIds, ...neighborIds]);
  const edgeOut = visibleEdges.filter((e) => keep.has(e.fromRecordId) && keep.has(e.toRecordId));
  return {
    nodes: nodes.filter((n) => keep.has(n.id)),
    edges: edgeOut,
    matchingIds,
    neighborIds,
  };
}

export type RelationshipEligibilityProblem =
  | { code: "endpoint_type"; message: string }
  | { code: "series_scope"; message: string }
  | { code: "self"; message: string };

/** Pure eligibility check for creating a place/record relationship (client-safe). */
export function checkRelationshipEligibility(input: {
  from: { id: string; recordType?: string | null; worldScope?: string | null; fields?: unknown };
  to: { id: string; recordType?: string | null; worldScope?: string | null; fields?: unknown };
  family: "place" | "record";
  scope: "book" | "series";
  seriesNamed: boolean;
}): RelationshipEligibilityProblem | null {
  if (input.from.id === input.to.id) {
    return { code: "self", message: "A record cannot relate to itself." };
  }
  if (input.family === "record") {
    const fromOk =
      input.from.recordType &&
      isRecordRelationEndpoint(input.from.recordType as RecordType, input.from.fields ?? {});
    const toOk =
      input.to.recordType &&
      isRecordRelationEndpoint(input.to.recordType as RecordType, input.to.fields ?? {});
    if (!fromOk || !toOk) {
      return {
        code: "endpoint_type",
        message: "Record relationships need character, organization, or place endpoints.",
      };
    }
  }
  if (input.scope === "series") {
    if (!input.seriesNamed) {
      return {
        code: "series_scope",
        message: "Series-scoped relationships need a named series on this book.",
      };
    }
    if (input.from.worldScope !== "series" || input.to.worldScope !== "series") {
      return {
        code: "series_scope",
        message: "Series-scoped relationships need both ends shared with the whole series.",
      };
    }
  }
  return null;
}

export type GraphKindOption = { id: string; label: string; family: RelationshipEdgeFamily };

export interface RelationshipTreeNode {
  id: string;
  title: string;
  typeLabel: string;
  profileImageUrl?: string | null;
  children: RelationshipTreeNode[];
}

export function edgeKindKey(family: RelationshipEdgeFamily, kind: string): string {
  return `${family}:${kind}`;
}

export const GRAPH_KIND_OPTIONS: GraphKindOption[] = [
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

export const ALL_CONNECTION_EXTRA_KINDS: GraphKindOption[] = [
  {
    id: edgeKindKey("link", "linked"),
    label: LINK_RELATION_LABELS.linked,
    family: "link",
  },
  {
    id: edgeKindKey("mention", "named_in"),
    label: MENTION_RELATION_LABELS.named_in,
    family: "mention",
  },
  {
    id: edgeKindKey("mention", "mentioned_by"),
    label: MENTION_RELATION_LABELS.mentioned_by,
    family: "mention",
  },
];

export const ALL_CONNECTION_KIND_OPTIONS: GraphKindOption[] = [...GRAPH_KIND_OPTIONS, ...ALL_CONNECTION_EXTRA_KINDS];

export const DEFAULT_GRAPH_KINDS = new Set(GRAPH_KIND_OPTIONS.map((k) => k.id));
export const DEFAULT_ALL_CONNECTION_KINDS = new Set(ALL_CONNECTION_KIND_OPTIONS.map((k) => k.id));

function edgeAllowed(edge: RelationshipEdge, allowed: Set<string>): boolean {
  return allowed.has(edgeKindKey(edge.family, edge.kind));
}

const MANUSCRIPT_TYPES = new Set(["manuscript_chapter", "manuscript_scene"]);

function manuscriptMatchesDraft(node: RelationshipNode | undefined, draftFilter: string | null | undefined): boolean {
  if (!node?.recordType || !MANUSCRIPT_TYPES.has(node.recordType)) return true;
  if (draftFilter === undefined || draftFilter === null) return true;
  if (draftFilter === "") return node.draftId == null;
  return node.draftId === draftFilter;
}

export interface ConnectionGraphFilters {
  allowedKinds: Set<string>;
  recordType: string | null;
  authorityStatus: string | null;
  /** Empty string = legacy manuscript (null draftId); null = all drafts. */
  draftId: string | null;
  orphansOnly: boolean;
}

export function filterConnectionGraph(
  nodes: readonly RelationshipNode[],
  edges: readonly RelationshipEdge[],
  filters: ConnectionGraphFilters,
): { nodes: RelationshipNode[]; edges: RelationshipEdge[] } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const candidates = nodes.filter((n) => {
    if (filters.recordType && n.recordType !== filters.recordType) return false;
    if (filters.authorityStatus && n.authorityStatus !== filters.authorityStatus) return false;
    if (filters.draftId !== null && !manuscriptMatchesDraft(n, filters.draftId)) return false;
    return true;
  });
  const candidateIds = new Set(candidates.map((n) => n.id));

  let filtered = edges.filter((e) => edgeAllowed(e, filters.allowedKinds));
  if (filters.draftId !== null) {
    filtered = filtered.filter(
      (e) =>
        manuscriptMatchesDraft(byId.get(e.fromRecordId), filters.draftId) &&
        manuscriptMatchesDraft(byId.get(e.toRecordId), filters.draftId),
    );
  }
  filtered = filtered.filter((e) => candidateIds.has(e.fromRecordId) && candidateIds.has(e.toRecordId));

  if (filters.orphansOnly) {
    const degree = new Map<string, number>();
    for (const id of candidateIds) degree.set(id, 0);
    for (const e of filtered) {
      degree.set(e.fromRecordId, (degree.get(e.fromRecordId) ?? 0) + 1);
      degree.set(e.toRecordId, (degree.get(e.toRecordId) ?? 0) + 1);
    }
    return {
      nodes: candidates.filter((n) => (degree.get(n.id) ?? 0) === 0),
      edges: [],
    };
  }

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
