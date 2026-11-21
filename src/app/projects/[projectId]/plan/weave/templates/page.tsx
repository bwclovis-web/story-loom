import { ProjectPageHeader } from "@/components/library/ProjectPageHeader";
import { getDb } from "@/server/db";
import { listWeaveTemplates } from "@/server/services/weaveService";
import { SHELL, WEAVE } from "@/ui/labels";
import { TemplatesClient } from "./TemplatesClient";

export const dynamic = "force-dynamic";

export default async function WeaveTemplatesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const templates = await listWeaveTemplates(getDb(), projectId).catch(() => []);
  const base = `/projects/${encodeURIComponent(projectId)}`;

  return (
    <>
      <ProjectPageHeader
        projectId={projectId}
        title={WEAVE.templates}
        description={WEAVE.templatesLead}
        crumbs={[
          { href: `${base}/plan`, label: SHELL.plan },
          { label: WEAVE.templates, current: true },
        ]}
      />
      <TemplatesClient projectId={projectId} initial={templates} />
    </>
  );
}
