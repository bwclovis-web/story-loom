"use client";

import Link from "next/link";
import type { MapGeographyNode } from "@/world/mapGeography";
import { WORLD } from "@/ui/labels";

function GeographyList({
  projectId,
  mapId,
  nodes,
  depth,
  onJump,
}: {
  projectId: string;
  mapId: string;
  nodes: readonly MapGeographyNode[];
  depth: number;
  onJump: (pinId: string) => void;
}) {
  return (
    <ul className="map-geography-list" style={{ marginLeft: depth ? "1rem" : 0 }}>
      {nodes.map((node) => (
        <li key={node.id}>
          <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap", alignItems: "baseline" }}>
            <Link href={`/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(node.id)}`}>{node.title}</Link>
            {node.pinId ? (
              <button type="button" className="linklike" onClick={() => onJump(node.pinId!)}>
                {WORLD.showOnMap}
              </button>
            ) : null}
          </div>
          {node.children.length ? (
            <GeographyList projectId={projectId} mapId={mapId} nodes={node.children} depth={depth + 1} onJump={onJump} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function MapGeographyPanel({
  projectId,
  mapId,
  geography,
  onJumpToPin,
}: {
  projectId: string;
  mapId: string;
  geography: readonly MapGeographyNode[];
  onJumpToPin: (pinId: string) => void;
}) {
  if (!geography.length) {
    return <p className="small muted">{WORLD.mapGeographyEmpty}</p>;
  }
  return (
    <section className="stack">
      <h3>{WORLD.mapGeography}</h3>
      <p className="small muted">{WORLD.mapGeographyHint}</p>
      <GeographyList projectId={projectId} mapId={mapId} nodes={geography} depth={0} onJump={onJumpToPin} />
    </section>
  );
}