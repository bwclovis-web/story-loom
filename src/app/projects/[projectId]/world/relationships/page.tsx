import { WorldToolHeader } from "@/components/world/WorldToolHeader";
import { getDb } from "@/server/db";
import { listManuscriptDrafts } from "@/server/services/draftService";
import {
  loadProjectAllConnectionsGraph,
  loadProjectRelationshipGraph,
} from "@/server/services/relationshipGraphService";
import { WORLD } from "@/ui/labels";
import { worldSurfaceCrumbs } from "@/ui/worldDestinations";
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
  const [graph, allConnections, drafts] = await Promise.all([
    loadProjectRelationshipGraph(db, projectId),
    loadProjectAllConnectionsGraph(db, projectId),
    listManuscriptDrafts(db, projectId),
  ]);
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
        initialFocus={focus}
        initialSteps={steps}
        initialConnectionMode={initialConnectionMode}
      />
    </>
  );
}