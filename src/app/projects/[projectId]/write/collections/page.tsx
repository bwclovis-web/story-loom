import { notFound } from "next/navigation";
import { ProjectPageHeader } from "@/components/library/ProjectPageHeader";
import { HelpHint } from "@/components/HelpHint";
import { getDb } from "@/server/db";
import { findProject } from "@/server/services/projectService";
import { listSmartCollections } from "@/server/services/smartCollectionService";
import { SHELL, SMART_COLLECTIONS } from "@/ui/labels";
import { SmartCollectionsPanel } from "./SmartCollectionsPanel";

export const dynamic = "force-dynamic";

export default async function SmartCollectionsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const db = getDb();
  const project = await findProject(db, projectId);
  if (!project) notFound();
  const collections = await listSmartCollections(db, projectId, "manuscript");
  const base = `/projects/${encodeURIComponent(projectId)}`;

  return (
    <>
      <ProjectPageHeader
        projectId={projectId}
        title={SMART_COLLECTIONS.heading}
        description={SMART_COLLECTIONS.lead}
        crumbs={[
          { href: `${base}/write`, label: SHELL.write },
          { label: SMART_COLLECTIONS.heading, current: true },
        ]}
      />
      <HelpHint anchor="smart-collections" topic="smart collections">
        {SMART_COLLECTIONS.lead}
      </HelpHint>
      <SmartCollectionsPanel projectId={projectId} collections={collections} />
    </>
  );
}