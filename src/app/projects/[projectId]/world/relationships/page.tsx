import { WorldToolHeader } from "@/components/world/WorldToolHeader";
import { getDb } from "@/server/db";
import { listManuscriptDrafts } from "@/server/services/draftService";
import { findProject } from "@/server/services/projectService";
import {
  loadProjectAllConnectionsGraph,
  loadProjectRelationshipGraph,
} from "@/server/services/relationshipGraphService";
import { listAvailableWorldCategories } from "@/server/services/worldCategoryService";
import { WORLD } from "@/ui/labels";
import { worldSurfaceCrumbs } from "@/ui/worldDestinations";
import type { CustomTaxonomyCategoryOption } from "@/world/customCategories";
import { RelationshipExplorer } from "./RelationshipExplorer";

export const dynamic = "force-dynamic";

export default async function RelationshipsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ focus?: string; steps?: string; connection?: string }>;
}) {
  const { projectId } = await params;
  const query = await searchParams;
  const stepsRaw = Number(query.steps ?? "2");
  const steps = Number.isFinite(stepsRaw) ? Math.min(6, Math.max(1, Math.round(stepsRaw))) : 2;
  const db = getDb();
  const [graph, allConnections, drafts, project, availableCategories] = await Promise.all([
    loadProjectRelationshipGraph(db, projectId),
    loadProjectAllConnectionsGraph(db, projectId),
    listManuscriptDrafts(db, projectId),
    findProject(db, projectId),
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
  const focus =
    query.focus && [...graph.nodes, ...allConnections.nodes].some((n) => n.id === query.focus) ? query.focus : "";
  const initialConnectionMode = query.connection === "all" ? "all" : "explicit";

  return (
    <>
      <WorldToolHeader
        projectId={projectId}
        items={worldSurfaceCrumbs(projectId, "relationships")}
        title={WORLD.relationships}
        lead={WORLD.relationshipsLead}
      />
      <RelationshipExplorer
        projectId={projectId}
        graph={graph}
        allConnections={allConnections}
        drafts={drafts}
        customCategories={customCategories}
        seriesNamed={Boolean(project?.seriesName?.trim())}
        initialFocus={focus}
        initialSteps={steps}
        initialConnectionMode={initialConnectionMode}
      />
    </>
  );
}
