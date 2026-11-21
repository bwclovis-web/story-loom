import { WorldToolHeader } from "@/components/world/WorldToolHeader";
import { getDb } from "@/server/db";
import { loadProjectRelationshipGraph } from "@/server/services/relationshipGraphService";
import { WORLD } from "@/ui/labels";
import { worldSurfaceCrumbs } from "@/ui/worldDestinations";
import { RelationshipExplorer } from "./RelationshipExplorer";

export const dynamic = "force-dynamic";

export default async function RelationshipsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ focus?: string; steps?: string }>;
}) {
  const { projectId } = await params;
  const query = await searchParams;
  const stepsRaw = Number(query.steps ?? "2");
  const steps = Number.isFinite(stepsRaw) ? Math.min(6, Math.max(1, Math.round(stepsRaw))) : 2;
  const graph = await loadProjectRelationshipGraph(getDb(), projectId);
  const focus = query.focus && graph.nodes.some((n) => n.id === query.focus) ? query.focus : "";

  return (
    <>
      <WorldToolHeader
        projectId={projectId}
        items={worldSurfaceCrumbs(projectId, "relationships")}
        title={WORLD.relationships}
        lead={WORLD.relationshipsLead}
      />
      <RelationshipExplorer projectId={projectId} graph={graph} initialFocus={focus} initialSteps={steps} />
    </>
  );
}