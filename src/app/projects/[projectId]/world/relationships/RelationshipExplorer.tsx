"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { profileGraphNode } from "@/components/world/ProfileGraphNode";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Atoms/Button";
import { RadioGroup } from "@/components/ui/RadioGroup";
import { SegmentedControl, SegmentedOption } from "@/components/ui/SegmentedControl";
import { AUTHORITY_STATUSES } from "@/domain/statuses";
import { RECORD_TYPES, RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import type { ManuscriptDraftView } from "@/server/services/draftService";
import type { ProjectAllConnectionsGraph, ProjectRelationshipGraph } from "@/server/services/relationshipGraphService";
import { RELATIONSHIP, WORLD } from "@/ui/labels";
import {
  ALL_CONNECTION_KIND_OPTIONS,
  buildFamilyForest,
  buildGeographyForest,
  buildOrganizationForest,
  DEFAULT_ALL_CONNECTION_KINDS,
  DEFAULT_GRAPH_KINDS,
  filterConnectionGraph,
  GRAPH_KIND_OPTIONS,
  edgeKindKey,
  layoutRadial,
  subgraphByHops,
  type RelationshipEdge,
  type RelationshipNode,
  type RelationshipTreeNode,
} from "@/world/relationshipGraph";

type ExplorerView = "graph" | "family" | "organization" | "geography";
type Presentation = "diagram" | "list";
type ConnectionMode = "explicit" | "all";

export function RelationshipExplorer({
  projectId,
  graph,
  allConnections,
  drafts,
  initialFocus,
  initialSteps,
  initialConnectionMode,
}: {
  projectId: string;
  graph: ProjectRelationshipGraph;
  allConnections: ProjectAllConnectionsGraph;
  drafts: ManuscriptDraftView[];
  initialFocus: string;
  initialSteps: number;
  initialConnectionMode: ConnectionMode;
}) {
  const router = useRouter();
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>(initialConnectionMode);
  const [view, setView] = useState<ExplorerView>("graph");
  const [presentation, setPresentation] = useState<Presentation>("diagram");
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState(initialFocus);
  const [steps, setSteps] = useState(initialSteps);
  const [kinds, setKinds] = useState<Set<string>>(() => new Set(DEFAULT_GRAPH_KINDS));
  const [recordTypeFilter, setRecordTypeFilter] = useState("");
  const [authorityFilter, setAuthorityFilter] = useState("");
  const [draftFilter, setDraftFilter] = useState<string | null>(null);
  const [orphansOnly, setOrphansOnly] = useState(false);
  const controlsId = useId();
  const inspectorId = useId();
  const modeGroupId = useId();

  const allowedKinds = kinds;
  const kindOptions = connectionMode === "all" ? ALL_CONNECTION_KIND_OPTIONS : GRAPH_KIND_OPTIONS;

  const filteredAll = useMemo(() => {
    if (connectionMode !== "all") return null;
    return filterConnectionGraph(allConnections.allNodes, allConnections.edges, {
      allowedKinds,
      recordType: recordTypeFilter || null,
      authorityStatus: authorityFilter || null,
      draftId: draftFilter,
      orphansOnly,
    });
  }, [
    allConnections,
    allowedKinds,
    authorityFilter,
    connectionMode,
    draftFilter,
    orphansOnly,
    recordTypeFilter,
  ]);

  const baseGraph = connectionMode === "all" && filteredAll ? filteredAll : { nodes: graph.nodes, edges: graph.edges };
  const subgraph = useMemo(
    () =>
      orphansOnly && connectionMode === "all"
        ? { nodes: filteredAll?.nodes ?? [], edges: [] }
        : subgraphByHops(baseGraph.nodes, baseGraph.edges, focusId || null, steps, allowedKinds),
    [allowedKinds, baseGraph, connectionMode, filteredAll, focusId, orphansOnly, steps],
  );
  const positions = useMemo(
    () => (presentation === "diagram" && view === "graph" ? layoutRadial(subgraph.nodes, subgraph.edges, focusId || null, 720, 420) : new Map()),
    [subgraph, focusId, presentation, view],
  );
  const selectedEdge = subgraph.edges.find((edge) => edge.id === selectedEdgeId) ?? null;

  const family = useMemo(() => buildFamilyForest(graph.nodes, graph.edges), [graph]);
  const organization = useMemo(() => buildOrganizationForest(graph.nodes, graph.edges), [graph]);
  const geography = useMemo(() => buildGeographyForest(graph.nodes, graph.edges), [graph]);

  const pushQuery = (nextFocus: string, nextSteps: number, nextMode: ConnectionMode) => {
    const q = new URLSearchParams();
    if (nextFocus) q.set("focus", nextFocus);
    if (nextSteps !== 2) q.set("steps", String(nextSteps));
    if (nextMode === "all") q.set("connection", "all");
    const text = q.toString();
    router.replace(text ? `${base}/world/relationships?${text}` : `${base}/world/relationships`);
  };

  const setConnectionModeAndUrl = (next: ConnectionMode) => {
    setConnectionMode(next);
    setKinds(new Set(next === "all" ? DEFAULT_ALL_CONNECTION_KINDS : DEFAULT_GRAPH_KINDS));
    if (next === "all") setView("graph");
    pushQuery(focusId, steps, next);
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

      <RadioGroup
        legend={RELATIONSHIP.connectionMode}
        name={modeGroupId}
        value={connectionMode}
        onValueChange={(value) => setConnectionModeAndUrl(value as ConnectionMode)}
        layout="row"
        options={[
          { value: "explicit", label: RELATIONSHIP.modeExplicit },
          { value: "all", label: RELATIONSHIP.modeAllConnections },
        ]}
        hint={connectionMode === "explicit" ? RELATIONSHIP.explicitOnlyNote : undefined}
      />

      {connectionMode === "all" ? (
        <Banner tone="info">{RELATIONSHIP.allConnectionsBanner}</Banner>
      ) : null}

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
          <SegmentedOption
            key={key}
            selected={view === key}
            disabled={connectionMode === "all" && key !== "graph"}
            onClick={() => setView(key)}
          >
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
                pushQuery(e.target.value, steps, connectionMode);
              }}
            >
              <option value="">{WORLD.relationshipFocusAll}</option>
              {(connectionMode === "all" ? allConnections.nodes : graph.nodes).map((c) => (
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
                pushQuery(focusId, n, connectionMode);
              }}
            />
          </label>
        </div>
      ) : null}

      {connectionMode === "all" && view === "graph" ? (
        <div className="row relationship-all-filters" style={{ flexWrap: "wrap", gap: "0.75rem", alignItems: "end" }}>
          <label className="world-toolbar-field">
            {RELATIONSHIP.filterRecordType}
            <select value={recordTypeFilter} onChange={(e) => setRecordTypeFilter(e.target.value)}>
              <option value="">{RELATIONSHIP.filterRecordTypeAll}</option>
              {RECORD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {RECORD_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </label>
          <label className="world-toolbar-field">
            {RELATIONSHIP.filterAuthority}
            <select value={authorityFilter} onChange={(e) => setAuthorityFilter(e.target.value)}>
              <option value="">{RELATIONSHIP.filterAuthorityAll}</option>
              {AUTHORITY_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          {drafts.length > 0 ? (
            <label className="world-toolbar-field">
              {RELATIONSHIP.filterDraft}
              <select
                value={draftFilter === null ? "__all__" : draftFilter}
                onChange={(e) => {
                  const v = e.target.value;
                  setDraftFilter(v === "__all__" ? null : v);
                }}
              >
                <option value="__all__">{RELATIONSHIP.filterDraftAll}</option>
                <option value="">{RELATIONSHIP.filterDraftLegacy}</option>
                {drafts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <Button
            type="button"
            variant={orphansOnly ? "primary" : "secondary"}
            aria-pressed={orphansOnly}
            onClick={() => setOrphansOnly((v) => !v)}
          >
            {RELATIONSHIP.orphansOnly}
          </Button>
        </div>
      ) : null}

      {view === "graph" ? (
        <SegmentedControl label={WORLD.relationshipKindFilters} className="relationship-kind-toggles" size="sm">
          {kindOptions.map((opt) => (
            <SegmentedOption key={opt.id} selected={kinds.has(opt.id)} onClick={() => toggleKind(opt.id)}>
              {opt.label}
            </SegmentedOption>
          ))}
        </SegmentedControl>
      ) : null}
      </div>

      {(connectionMode === "explicit" ? graph.edges.length === 0 : allConnections.edges.length === 0) ? (
        <p className="muted">
          {connectionMode === "all" ? RELATIONSHIP.allConnectionsNoData : WORLD.relationshipNoData}
        </p>
      ) : orphansOnly && connectionMode === "all" && !(filteredAll?.nodes.length ?? 0) ? (
        <p className="muted">{RELATIONSHIP.orphansEmpty}</p>
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
              orphansOnly={orphansOnly && connectionMode === "all"}
            />
          ) : orphansOnly && connectionMode === "all" ? (
            <NodeList projectId={projectId} nodes={subgraph.nodes} />
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
      ) : connectionMode === "all" ? null : view === "family" ? (
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

      <p className="small muted">
        {connectionMode === "all" ? RELATIONSHIP.allConnectionsBanner : WORLD.relationshipSourceNote}
      </p>
    </div>
  );
}

function recordHref(projectId: string, recordId: string) {
  return `/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(recordId)}`;
}

function NodeList({ projectId, nodes }: { projectId: string; nodes: RelationshipNode[] }) {
  if (!nodes.length) return <p className="muted small">{RELATIONSHIP.orphansEmpty}</p>;
  return (
    <ul className="relationship-edge-list" aria-label={RELATIONSHIP.listNodeLabel}>
      {nodes.map((n) => (
        <li key={n.id}>
          <Link href={recordHref(projectId, n.id)}>{n.title}</Link>
          <span className="small muted"> ({n.typeLabel})</span>
        </li>
      ))}
    </ul>
  );
}

function GraphSvg({
  projectId,
  nodes,
  edges,
  positions,
  focusId,
  selectedId,
  onSelect,
  orphansOnly = false,
}: {
  projectId: string;
  nodes: RelationshipNode[];
  edges: RelationshipEdge[];
  positions: Map<string, { x: number; y: number }>;
  focusId: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  orphansOnly?: boolean;
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
          const href = recordHref(projectId, n.id);
          const short = n.title.length > 22 ? `${n.title.slice(0, 20)}…` : n.title;
          return (
            <g key={n.id}>
              <a href={href} aria-label={`${RELATIONSHIP.nodeOpenRecord}: ${n.title}`}>
                {profileGraphNode(n.id, p.x, p.y, r, n.title, n.profileImageUrl, n.id === focusId)}
              </a>
              <text x={p.x} y={p.y + r + 14} textAnchor="middle" className="relationship-node-label">
                <a href={href}>{short}</a>
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="small muted">
        {orphansOnly && !edges.length ? (
          <p>{RELATIONSHIP.orphansHint}</p>
        ) : (
          <ul className="relationship-node-links">
            {nodes.map((n) => (
              <li key={n.id}>
                <Link href={recordHref(projectId, n.id)}>{n.title}</Link>
              </li>
            ))}
          </ul>
        )}
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