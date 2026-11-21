"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { profileGraphNode } from "@/components/world/ProfileGraphNode";
import { SegmentedControl, SegmentedOption } from "@/components/ui/SegmentedControl";
import type { ProjectRelationshipGraph } from "@/server/services/relationshipGraphService";
import { WORLD } from "@/ui/labels";
import {
  buildFamilyForest,
  buildGeographyForest,
  buildOrganizationForest,
  DEFAULT_GRAPH_KINDS,
  GRAPH_KIND_OPTIONS,
  edgeKindKey,
  layoutRadial,
  subgraphByHops,
  type RelationshipEdge,
  type RelationshipTreeNode,
} from "@/world/relationshipGraph";

type ExplorerView = "graph" | "family" | "organization" | "geography";
type Presentation = "diagram" | "list";

export function RelationshipExplorer({
  projectId,
  graph,
  initialFocus,
  initialSteps,
}: {
  projectId: string;
  graph: ProjectRelationshipGraph;
  initialFocus: string;
  initialSteps: number;
}) {
  const router = useRouter();
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const [view, setView] = useState<ExplorerView>("graph");
  const [presentation, setPresentation] = useState<Presentation>("diagram");
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState(initialFocus);
  const [steps, setSteps] = useState(initialSteps);
  const [kinds, setKinds] = useState<Set<string>>(() => new Set(DEFAULT_GRAPH_KINDS));
  const controlsId = useId();
  const inspectorId = useId();

  const allowedKinds = kinds;
  const subgraph = useMemo(
    () => subgraphByHops(graph.nodes, graph.edges, focusId || null, steps, allowedKinds),
    [graph, focusId, steps, allowedKinds],
  );
  const positions = useMemo(
    () => (presentation === "diagram" && view === "graph" ? layoutRadial(subgraph.nodes, subgraph.edges, focusId || null, 720, 420) : new Map()),
    [subgraph, focusId, presentation, view],
  );
  const selectedEdge = subgraph.edges.find((edge) => edge.id === selectedEdgeId) ?? null;

  const family = useMemo(() => buildFamilyForest(graph.nodes, graph.edges), [graph]);
  const organization = useMemo(() => buildOrganizationForest(graph.nodes, graph.edges), [graph]);
  const geography = useMemo(() => buildGeographyForest(graph.nodes, graph.edges), [graph]);

  const pushFocus = (nextFocus: string, nextSteps: number) => {
    const q = new URLSearchParams();
    if (nextFocus) q.set("focus", nextFocus);
    if (nextSteps !== 2) q.set("steps", String(nextSteps));
    const text = q.toString();
    router.replace(text ? `${base}/world/relationships?${text}` : `${base}/world/relationships`);
  };

  const toggleKind = (key: string) => {
    setKinds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="relationship-explorer stack" aria-labelledby={controlsId}>
      <h2 id={controlsId} className="visually-hidden">
        {WORLD.relationshipExplorerControls}
      </h2>

      <div className="relationship-toolbar">
      <SegmentedControl label={WORLD.relationshipViewTabs}>
        {(
          [
            ["graph", WORLD.relationshipGraphView],
            ["family", WORLD.relationshipFamilyView],
            ["organization", WORLD.relationshipOrganizationView],
            ["geography", WORLD.relationshipGeographyView],
          ] as const
        ).map(([key, label]) => (
          <SegmentedOption key={key} selected={view === key} onClick={() => setView(key)}>
            {label}
          </SegmentedOption>
        ))}
      </SegmentedControl>

      <SegmentedControl label={WORLD.relationshipPresentationTabs}>
        {(
          [
            ["diagram", WORLD.relationshipDiagram],
            ["list", WORLD.relationshipListView],
          ] as const
        ).map(([key, label]) => (
          <SegmentedOption key={key} selected={presentation === key} onClick={() => setPresentation(key as Presentation)}>
            {label}
          </SegmentedOption>
        ))}
      </SegmentedControl>

      {view === "graph" ? (
        <div className="row" style={{ flexWrap: "wrap", gap: "0.75rem", alignItems: "end" }}>
          <label className="world-toolbar-field">
            {WORLD.relationshipFocus}
            <select
              value={focusId}
              onChange={(e) => {
                setFocusId(e.target.value);
                pushFocus(e.target.value, steps);
              }}
            >
              <option value="">{WORLD.relationshipFocusAll}</option>
              {graph.nodes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title} ({c.typeLabel})
                </option>
              ))}
            </select>
          </label>
          <label className="world-toolbar-field">
            {WORLD.relationshipSteps}
            <input
              type="number"
              min={1}
              max={6}
              value={steps}
              onChange={(e) => {
                const n = Math.min(6, Math.max(1, Number(e.target.value) || 1));
                setSteps(n);
                pushFocus(focusId, n);
              }}
            />
          </label>
        </div>
      ) : null}

      {view === "graph" ? (
        <SegmentedControl label={WORLD.relationshipKindFilters} className="relationship-kind-toggles" size="sm">
          {GRAPH_KIND_OPTIONS.map((opt) => (
            <SegmentedOption key={opt.id} selected={kinds.has(opt.id)} onClick={() => toggleKind(opt.id)}>
              {opt.label}
            </SegmentedOption>
          ))}
        </SegmentedControl>
      ) : null}
      </div>

      {graph.edges.length === 0 ? (
        <p className="muted">{WORLD.relationshipNoData}</p>
      ) : view === "graph" ? (
        <div className="relationship-workspace">
          {presentation === "diagram" ? (
            <GraphSvg
              projectId={projectId}
              nodes={subgraph.nodes}
              edges={subgraph.edges}
              positions={positions}
              focusId={focusId || null}
              selectedId={selectedEdge?.id ?? null}
              onSelect={setSelectedEdgeId}
            />
          ) : (
            <EdgeList
              projectId={projectId}
              edges={subgraph.edges}
              nodes={subgraph.nodes}
              selectedId={selectedEdge?.id ?? null}
              onSelect={setSelectedEdgeId}
            />
          )}
          <RelationshipInspector
            id={inspectorId}
            projectId={projectId}
            edge={selectedEdge}
            nodes={subgraph.nodes}
          />
        </div>
      ) : view === "family" ? (
        presentation === "diagram" ? (
          <ForestDiagram projectId={projectId} trees={family.tree} extras={family.loose} nodes={graph.nodes} />
        ) : (
          <ForestList projectId={projectId} trees={family.tree} extras={family.loose} nodes={graph.nodes} />
        )
      ) : view === "organization" ? (
        presentation === "diagram" ? (
          <ForestDiagram projectId={projectId} trees={organization} nodes={graph.nodes} />
        ) : (
          <ForestList projectId={projectId} trees={organization} nodes={graph.nodes} />
        )
      ) : presentation === "diagram" ? (
        <ForestDiagram projectId={projectId} trees={geography} nodes={graph.nodes} />
      ) : (
        <ForestList projectId={projectId} trees={geography} nodes={graph.nodes} />
      )}

      <p className="small muted">{WORLD.relationshipSourceNote}</p>
    </div>
  );
}

function recordHref(projectId: string, recordId: string) {
  return `/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(recordId)}`;
}

function GraphSvg({
  projectId,
  nodes,
  edges,
  positions,
  focusId,
  selectedId,
  onSelect,
}: {
  projectId: string;
  nodes: ProjectRelationshipGraph["nodes"];
  edges: RelationshipEdge[];
  positions: Map<string, { x: number; y: number }>;
  focusId: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return (
    <figure className="relationship-figure">
      <svg className="relationship-graph-svg" viewBox="0 0 720 420" aria-label={WORLD.relationshipGraphSvgLabel}>
        {edges.map((e) => {
          const a = positions.get(e.fromRecordId);
          const b = positions.get(e.toRecordId);
          if (!a || !b) return null;
          const label = `${byId.get(e.fromRecordId)?.title} — ${e.kindLabel} → ${byId.get(e.toRecordId)?.title}`;
          return (
            <g
              key={e.id}
              role="button"
              tabIndex={0}
              aria-pressed={selectedId === e.id}
              aria-label={label}
              onClick={() => onSelect(e.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(e.id);
                }
              }}
            >
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={selectedId === e.id ? "relationship-edge selected" : "relationship-edge"} />
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="relationship-edge-hit" />
              <title>{label}</title>
            </g>
          );
        })}
        {nodes.map((n) => {
          const p = positions.get(n.id);
          if (!p) return null;
          const r = n.id === focusId ? 18 : 14;
          return (
            <g key={n.id}>
              {profileGraphNode(n.id, p.x, p.y, r, n.title, n.profileImageUrl, n.id === focusId)}
              <text x={p.x} y={p.y + r + 14} textAnchor="middle" className="relationship-node-label">
                {n.title.length > 22 ? `${n.title.slice(0, 20)}…` : n.title}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="small muted">
        <ul className="relationship-node-links">
          {nodes.map((n) => (
            <li key={n.id}>
              <Link href={recordHref(projectId, n.id)}>{n.title}</Link>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}

function EdgeList({
  projectId,
  edges,
  nodes,
  selectedId = null,
  onSelect,
}: {
  projectId: string;
  edges: RelationshipEdge[];
  nodes: ProjectRelationshipGraph["nodes"];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const titleOf = (id: string) => nodes.find((n) => n.id === id)?.title ?? id;
  if (!edges.length) return <p className="muted small">{WORLD.relationshipSubgraphEmpty}</p>;
  return (
    <ul className="relationship-edge-list" aria-label={WORLD.relationshipEdgeListLabel}>
      {edges.map((e) => (
        <li key={e.id}>
          <Link href={recordHref(projectId, e.fromRecordId)}>{titleOf(e.fromRecordId)}</Link>
          {onSelect ? (
            <button type="button" className="linkish" aria-pressed={selectedId === e.id} onClick={() => onSelect(e.id)}>
              {e.kindLabel}
            </button>
          ) : (
            <span className="small muted"> {e.kindLabel} </span>
          )}
          <Link href={recordHref(projectId, e.toRecordId)}>{titleOf(e.toRecordId)}</Link>
          <span className="small muted"> ({edgeKindKey(e.family, e.kind)})</span>
        </li>
      ))}
    </ul>
  );
}

function RelationshipInspector({
  id,
  projectId,
  edge,
  nodes,
}: {
  id: string;
  projectId: string;
  edge: RelationshipEdge | null;
  nodes: ProjectRelationshipGraph["nodes"];
}) {
  const titleOf = (recordId: string) => nodes.find((node) => node.id === recordId)?.title ?? recordId;
  return (
    <aside className="relationship-inspector" aria-labelledby={id}>
      <h2 id={id}>{WORLD.relationshipSelected}</h2>
      {edge ? (
        <>
          <p>
            <Link href={recordHref(projectId, edge.fromRecordId)}>{titleOf(edge.fromRecordId)}</Link>
          </p>
          <p>{edge.kindLabel}</p>
          <p>
            <Link href={recordHref(projectId, edge.toRecordId)}>{titleOf(edge.toRecordId)}</Link>
          </p>
          <p className="small muted">{WORLD.relationshipSourceNote}</p>
        </>
      ) : (
        <p className="muted">{WORLD.relationshipSelectPrompt}</p>
      )}
    </aside>
  );
}

function ForestList({
  projectId,
  trees,
  extras,
  nodes,
}: {
  projectId: string;
  trees: RelationshipTreeNode[];
  extras?: RelationshipEdge[];
  nodes: ProjectRelationshipGraph["nodes"];
}) {
  const titleOf = (id: string) => nodes.find((n) => n.id === id)?.title ?? id;
  if (!trees.length && !(extras?.length ?? 0)) return <p className="muted small">{WORLD.relationshipTreeEmpty}</p>;
  return (
    <>
      {extras?.length ? (
        <ul className="relationship-edge-list" aria-label={WORLD.relationshipFamilyLoose}>
          {extras.map((e) => (
            <li key={e.id}>
              <Link href={recordHref(projectId, e.fromRecordId)}>{titleOf(e.fromRecordId)}</Link>
              <span className="small muted"> {e.kindLabel} </span>
              <Link href={recordHref(projectId, e.toRecordId)}>{titleOf(e.toRecordId)}</Link>
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="relationship-tree-list" aria-label={WORLD.relationshipTreeListLabel}>
        {trees.map((t) => (
          <TreeListItem key={t.id} projectId={projectId} node={t} depth={0} />
        ))}
      </ul>
    </>
  );
}

function TreeListItem({ projectId, node, depth }: { projectId: string; node: RelationshipTreeNode; depth: number }) {
  return (
    <li style={{ marginLeft: `${depth * 1.25}rem` }}>
      <Link href={recordHref(projectId, node.id)}>
        {node.title}
      </Link>
      <span className="small muted"> ({node.typeLabel})</span>
      {node.children.length ? (
        <ul>
          {node.children.map((child) => (
            <TreeListItem key={child.id} projectId={projectId} node={child} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function ForestDiagram({
  projectId,
  trees,
  extras,
  nodes,
}: {
  projectId: string;
  trees: RelationshipTreeNode[];
  extras?: RelationshipEdge[];
  nodes: ProjectRelationshipGraph["nodes"];
}) {
  return (
    <div className="relationship-tree-diagram">
      {extras?.length ? <ForestList projectId={projectId} trees={[]} extras={extras} nodes={nodes} /> : null}
      {trees.length ? (
        <svg className="relationship-tree-svg" viewBox="0 0 720 420" role="img" aria-label={WORLD.relationshipTreeSvgLabel}>
          {trees.flatMap((tree, i) => layoutTreeSvg(tree, 80 + i * 200, 44, 0, tree.profileImageUrl))}
        </svg>
      ) : (
        <p className="muted small">{WORLD.relationshipTreeEmpty}</p>
      )}
    </div>
  );
}

function layoutTreeSvg(
  node: RelationshipTreeNode,
  x: number,
  y: number,
  depth: number,
  profileUrl: string | null | undefined,
): React.ReactElement[] {
  const out: React.ReactElement[] = [
    <g key={`${node.id}-${depth}`}>
      {profileGraphNode(node.id, x, y, 12, node.title, profileUrl, false)}
      <text x={x} y={y - 16} textAnchor="middle" className="relationship-node-label">
        {node.title.length > 16 ? `${node.title.slice(0, 14)}…` : node.title}
      </text>
    </g>,
  ];
  const childY = y + 48;
  const span = Math.max(60, node.children.length * 72);
  node.children.forEach((child, i) => {
    const childX = x - span / 2 + (i + 0.5) * (span / Math.max(1, node.children.length));
    out.push(
      <line key={`${node.id}-${child.id}-line`} x1={x} y1={y + 6} x2={childX} y2={childY - 6} className="relationship-edge" />,
    );
    out.push(...layoutTreeSvg(child, childX, childY, depth + 1, child.profileImageUrl));
  });
  return out;
}