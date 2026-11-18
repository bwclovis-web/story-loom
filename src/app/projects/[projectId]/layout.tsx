import { notFound } from "next/navigation";
import { ProjectNav } from "@/components/shell/ProjectNav";
import { getDb } from "@/server/db";
import { readWriteDraftCookie, resolveWriteDraftId } from "@/server/draftSelection";
import { getDraftDefaults, listManuscriptDrafts } from "@/server/services/draftService";
import { findProject } from "@/server/services/projectService";
import { listBoards } from "@/server/services/boardService";
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
  const drafts = await listManuscriptDrafts(db, project.id);
  const writeDraftCookie = await readWriteDraftCookie();
  const activeDraftId = resolveWriteDraftId(drafts, writeDraftCookie);
  const hasDrafts = drafts.length > 0;
  const [records, openReviewItems, boards] = await Promise.all([
    listRecordNav(db, project.id, { hasDrafts, draftId: activeDraftId }),
    countOpenReviewItems(db, project.id),
    listBoards(db, project.id).catch(() => []),
    getDraftDefaults(db, project.id),
  ]);

  return (
    <div className="project-frame">
      <ProjectNav
        project={{ id: project.id, title: project.title, workspaceName: project.workspace.name }}
        records={records}
        openReviewItems={openReviewItems}
        drafts={drafts.map((d) => ({
          id: d.id,
          kind: d.kind,
          label: d.label,
          completedAt: d.completedAt?.toISOString() ?? null,
        }))}
        activeDraftId={activeDraftId}
        boards={boards.map((b) => ({ id: b.id, title: b.title }))}
      />
      <main id="main" tabIndex={-1} className="workspace">
        {children}
      </main>
    </div>
  );
}
