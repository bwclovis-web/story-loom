import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Breadcrumbs, type BreadcrumbItem } from "@/components/ui/Breadcrumbs";
import { getDb } from "@/server/db";
import { listProjectCoverHashes } from "@/server/services/coverService";
import { findProject } from "@/server/services/projectService";
import { manuscriptEyebrow } from "@/ui/library";
import { WORLD } from "@/ui/labels";
import { LandingHeader } from "./LandingHeader";

/**
 * Server header for any project page. Loads the book cover and series line,
 * then renders `LandingHeader`. Change `title`. Pass `crumbs` on nested pages.
 */
export async function ProjectPageHeader({
  projectId,
  title,
  description,
  gettingStarted,
  actions,
  crumbs,
}: {
  projectId: string;
  title: ReactNode;
  description?: ReactNode;
  gettingStarted?: ReactNode;
  actions?: ReactNode;
  crumbs?: BreadcrumbItem[];
}) {
  const db = getDb();
  const project = await findProject(db, projectId);
  if (!project) notFound();
  const coverHash = (await listProjectCoverHashes(db, [projectId])).get(projectId) ?? null;
  const base = `/projects/${encodeURIComponent(projectId)}`;
  return (
    <LandingHeader
      projectId={projectId}
      title={title}
      coverTitle={project.title}
      eyebrow={manuscriptEyebrow(project.seriesName, project.workspace.name)}
      coverSrc={coverHash ? `${base}/cover?v=${coverHash}` : null}
      description={description}
      gettingStarted={gettingStarted}
      actions={actions}
      breadcrumbs={crumbs?.length ? <Breadcrumbs label={WORLD.breadcrumb} items={crumbs} /> : null}
    />
  );
}
