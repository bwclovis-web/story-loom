import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { getDb } from "@/server/db";
import { listWeaveTemplates } from "@/server/services/weaveService";
import { SHELL, WEAVE, WORLD } from "@/ui/labels";
import { TemplatesClient } from "./TemplatesClient";

export const dynamic = "force-dynamic";

export default async function WeaveTemplatesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const templates = await listWeaveTemplates(getDb(), projectId).catch(() => []);
  const base = `/projects/${encodeURIComponent(projectId)}`;

  return (
    <>
      <Breadcrumbs
        label={WORLD.breadcrumb}
        items={[
          { href: `${base}/plan`, label: SHELL.plan },
          { label: WEAVE.templates, current: true },
        ]}
      />
      <header className="page-header">
        <h1>{WEAVE.templates}</h1>
      </header>
      <p className="page-lead">{WEAVE.templatesLead}</p>
      <TemplatesClient projectId={projectId} initial={templates} />
    </>
  );
}
