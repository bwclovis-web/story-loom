import { notFound } from "next/navigation";
import { ProjectPageHeader } from "@/components/library/ProjectPageHeader";
import { HelpHint } from "@/components/HelpHint";
import { getDb } from "@/server/db";
import { listContinuityLedger } from "@/server/services/continuityService";
import { findProject } from "@/server/services/projectService";
import { CONTINUITY, SHELL } from "@/ui/labels";
import { ContinuityLedgerClient } from "./ContinuityLedgerClient";

export const dynamic = "force-dynamic";

export default async function ContinuityPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ category?: string; severity?: string; suppressed?: string }>;
}) {
  const { projectId } = await params;
  const query = await searchParams;
  const db = getDb();
  const project = await findProject(db, projectId);
  if (!project) notFound();
  const items = await listContinuityLedger(db, projectId, { includeSuppressed: true });
  const base = `/projects/${encodeURIComponent(projectId)}`;

  return (
    <>
      <ProjectPageHeader
        projectId={projectId}
        title={CONTINUITY.title}
        description={CONTINUITY.lead}
        crumbs={[
          { href: `${base}/world`, label: SHELL.world },
          { label: CONTINUITY.title, current: true },
        ]}
      />
      <HelpHint anchor="world-continuity" topic="Story Health">
        Loading this page does not change the manuscript or bible. Mark intentional or ignored only hides a finding from
        the open list; it is audited and can be restored.
      </HelpHint>
      <ContinuityLedgerClient
        projectId={projectId}
        items={items}
        initialCategory={query.category}
        initialSeverity={query.severity}
        initialShowSuppressed={query.suppressed === "1"}
      />
    </>
  );
}
