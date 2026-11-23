import { notFound } from "next/navigation";
import { ProjectPageHeader } from "@/components/library/ProjectPageHeader";
import { ProjectOnboarding } from "@/components/shell/ProjectOnboarding";
import { getDb } from "@/server/db";
import { NotFoundError } from "@/server/services/errors";
import { listAvailableReferences } from "@/server/services/seriesBibleService";
import { listAvailableWorldCategories } from "@/server/services/worldCategoryService";
import { loadProjectRelationshipGraph } from "@/server/services/relationshipGraphService";
import { getWorldMap, listWorldMaps } from "@/server/services/worldMapService";
import { buildMapGeographyTree } from "@/world/mapGeography";
import { RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import { SERIES } from "@/ui/labels";
import { seriesBookLabel } from "@/world/seriesHome";
import { worldSurfaceCrumbs } from "@/ui/worldDestinations";
import type { CustomTaxonomyCategoryOption } from "@/world/customCategories";
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

  const [available, availableCategories] = await Promise.all([
    listAvailableReferences(db, projectId, { linkableOnly: true }),
    listAvailableWorldCategories(db, projectId),
  ]);
  const customCategories: CustomTaxonomyCategoryOption[] = availableCategories.map((row) => ({
    slug: row.slug,
    label: row.label,
    description: row.description,
    parentCategorySlug: row.parentCategorySlug,
    shared: Boolean(row.home),
    homeLabel: row.home ? row.home.bookName?.trim() || row.home.title : null,
  }));
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

  return (
    <div className="visual-workspace">
      <ProjectPageHeader
        projectId={projectId}
        title={map.title}
        crumbs={worldSurfaceCrumbs(projectId, "maps", map.title)}
        gettingStarted={<ProjectOnboarding projectId={projectId} quiet marked />}
      />
      <MapCanvas
        projectId={projectId}
        map={map}
        records={available.map((entry) => ({
          id: entry.record.id,
          title: entry.record.title,
          typeLabel: RECORD_TYPE_LABELS[entry.record.type],
          homeLabel: entry.home ? SERIES.homeBadge(seriesBookLabel(entry.home)) : null,
          worldScope: entry.worldScope,
          taxonomy: entry.taxonomy,
        }))}
        customCategories={customCategories}
        otherMaps={otherMaps}
        initialPinId={query.pin ?? null}
        geography={geography}
      />
    </div>
  );
}
