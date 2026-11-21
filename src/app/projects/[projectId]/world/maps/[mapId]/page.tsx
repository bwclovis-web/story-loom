import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { getDb } from "@/server/db";
import { NotFoundError } from "@/server/services/errors";
import { listRecords } from "@/server/services/recordService";
import { loadProjectRelationshipGraph } from "@/server/services/relationshipGraphService";
import { getWorldMap, listWorldMaps } from "@/server/services/worldMapService";
import { buildMapGeographyTree } from "@/world/mapGeography";
import { isLinkableReferenceType, RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import { isWorldType } from "@/ui/world";
import { SHELL, WORLD } from "@/ui/labels";
import { MapCanvas } from "../MapCanvas";

export const dynamic = "force-dynamic";

export default async function WorldMapPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; mapId: string }>;
  searchParams: Promise<{ pin?: string }>;
}) {
  const { projectId, mapId } = await params;
  const query = await searchParams;
  const db = getDb();
  let map;
  try {
    map = await getWorldMap(db, projectId, mapId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const records = (await listRecords(db, projectId)).filter(
    (r) => isWorldType(r.type) || isLinkableReferenceType(r.type),
  );
  const otherMaps = (await listWorldMaps(db, projectId).catch(() => []))
    .filter((item) => item.id !== map.id)
    .map((item) => ({ id: item.id, title: item.title }));
  const graph = await loadProjectRelationshipGraph(db, projectId).catch(() => ({
    nodes: [],
    edges: [],
    focusChoices: [],
  }));
  const pinsByRecordId = new Map<string, string>();
  for (const pin of map.pins) {
    if (pin.recordId && !pin.unavailable) pinsByRecordId.set(pin.recordId, pin.id);
  }
  const geography = buildMapGeographyTree(graph.nodes, graph.edges, pinsByRecordId);
  const base = `/projects/${encodeURIComponent(projectId)}`;

  return (
    <>
      <Breadcrumbs
        label={WORLD.breadcrumb}
        items={[
          { href: `${base}/world`, label: SHELL.world },
          { href: `${base}/world/maps`, label: WORLD.maps },
          { label: map.title, current: true },
        ]}
      />
      <MapCanvas
        projectId={projectId}
        map={map}
        records={records.map((r) => ({
          id: r.id,
          title: r.title,
          typeLabel: RECORD_TYPE_LABELS[r.type],
        }))}
        otherMaps={otherMaps}
        initialPinId={query.pin ?? null}
        geography={geography}
      />
    </>
  );
}
