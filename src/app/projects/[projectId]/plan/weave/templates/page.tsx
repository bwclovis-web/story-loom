import Link from "next/link";
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
      <nav aria-label="Breadcrumb" className="breadcrumbs">
        <ol>
          <li>
            <Link href={`${base}/plan`}>{SHELL.plan}</Link>
          </li>
          <li>
            <span aria-current="page">{WEAVE.templates}</span>
          </li>
        </ol>
      </nav>
      <header className="page-header">
        <h1>{WEAVE.templates}</h1>
      </header>
      <p className="page-lead">{WEAVE.templatesLead}</p>
      <TemplatesClient projectId={projectId} initial={templates} />
    </>
  );
}
