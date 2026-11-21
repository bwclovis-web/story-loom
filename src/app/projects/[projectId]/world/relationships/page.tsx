import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { WorldSurfaceNav } from "@/components/world/WorldSurfaceNav";
import { getDb } from "@/server/db";
import { loadProjectRelationshipGraph } from "@/server/services/relationshipGraphService";
import { SHELL, WORLD } from "@/ui/labels";
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
  const base = `/projects/${encodeURIComponent(projectId)}`;

  return (
    <>
      <Breadcrumbs
        label={WORLD.breadcrumb}
        items={[
          { href: `${base}/world`, label: SHELL.world },
          { label: WORLD.relationships, current: true },
        ]}
      />
      <PageHeader title={WORLD.relationships} lead={WORLD.relationshipsLead} />
      <WorldSurfaceNav projectId={projectId} current="relationships" />
      <RelationshipExplorer projectId={projectId} graph={graph} initialFocus={focus} initialSteps={steps} />
    </>
  );
}