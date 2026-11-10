import { notFound } from "next/navigation";
import { ProjectNav } from "@/components/shell/ProjectNav";
import { getDb } from "@/server/db";
import { findProject } from "@/server/services/projectService";
import { listRecordNav } from "@/server/services/recordService";
import { countOpenReviewItems } from "@/server/services/reviewService";

export const dynamic = "force-dynamic";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const db = getDb();
  const project = await findProject(db, projectId);
  if (!project) notFound();
  const [records, openReviewItems] = await Promise.all([
    listRecordNav(db, project.id),
    countOpenReviewItems(db, project.id),
  ]);

  return (
    <div className="project-frame">
      <ProjectNav
        project={{ id: project.id, title: project.title, workspaceName: project.workspace.name }}
        records={records}
        openReviewItems={openReviewItems}
      />
      <main id="main" tabIndex={-1} className="workspace">
        {children}
      </main>
    </div>
  );
}
