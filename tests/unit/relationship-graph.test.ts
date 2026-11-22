import { describe, expect, it } from "vitest";
import {
  buildGeographyForest,
  buildOrganizationForest,
  DEFAULT_GRAPH_KINDS,
  edgeKindKey,
  filterConnectionGraph,
  subgraphByHops,
  DEFAULT_ALL_CONNECTION_KINDS,
  type RelationshipEdge,
  type RelationshipNode,
} from "@/world/relationshipGraph";

const nodes: RelationshipNode[] = [
  { id: "a", title: "Aldric", typeLabel: "Character dossier" },
  { id: "b", title: "Guild", typeLabel: "Worldbuilding" },
  { id: "c", title: "Quay", typeLabel: "Worldbuilding" },
  { id: "d", title: "River", typeLabel: "Worldbuilding" },
];

const edges: RelationshipEdge[] = [
  {
    id: "r1",
    fromRecordId: "a",
    toRecordId: "b",
    kind: "member_of",
    kindLabel: "Member of",
    family: "record",
  },
  {
    id: "p1",
    fromRecordId: "c",
    toRecordId: "d",
    kind: "part_of",
    kindLabel: "Part of",
    family: "place",
  },
  {
    id: "p2",
    fromRecordId: "d",
    toRecordId: "b",
    kind: "governed_by",
    kindLabel: "Governed by",
    family: "place",
  },
];

describe("relationship graph", () => {
  it("limits hops from a focus record", () => {
    const kinds = new Set(DEFAULT_GRAPH_KINDS);
    const one = subgraphByHops(nodes, edges, "a", 1, kinds);
    expect(one.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
    const two = subgraphByHops(nodes, edges, "c", 2, kinds);
    expect(two.nodes.map((n) => n.id).sort()).toEqual(["b", "c", "d"]);
  });

  it("filters by kind", () => {
    const placeOnly = new Set([edgeKindKey("place", "part_of")]);
    const sub = subgraphByHops(nodes, edges, "c", 3, placeOnly);
    expect(sub.edges).toHaveLength(1);
    expect(sub.edges[0]?.kind).toBe("part_of");
  });

  it("builds geography tree from part_of", () => {
    const tree = buildGeographyForest(nodes, edges);
    const river = tree.find((t) => t.id === "d");
    expect(river?.children[0]?.id).toBe("c");
  });

  it("builds organization tree from member edges", () => {
    const tree = buildOrganizationForest(nodes, edges);
    expect(tree.some((t) => t.id === "b" && t.children.some((c) => c.id === "a"))).toBe(true);
  });

  it("lists orphan nodes when requested", () => {
    const rich: RelationshipNode[] = [
      ...nodes,
      { id: "lonely", title: "Lonely note", typeLabel: "Research note", recordType: "research_note" },
    ];
    const filtered = filterConnectionGraph(rich, edges, {
      allowedKinds: DEFAULT_ALL_CONNECTION_KINDS,
      recordType: "research_note",
      authorityStatus: null,
      draftId: null,
      orphansOnly: true,
    });
    expect(filtered.nodes.map((n) => n.id)).toEqual(["lonely"]);
    expect(filtered.edges).toHaveLength(0);
  });
});