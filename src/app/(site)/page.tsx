import { cookies } from "next/headers";
import { LibraryHome, type LibraryWorkspace } from "@/components/library/LibraryHome";
import { PROJECT_COOKIE } from "@/components/shell/preferences";
import { resolveWriteDraftId } from "@/server/draftSelection";
import { getDb } from "@/server/db";
import { WRITE_DRAFT_COOKIE } from "@/components/shell/preferences";
import { listProjectCoverHashes } from "@/server/services/coverService";
import { listManuscriptDrafts } from "@/server/services/draftService";
import { listProjectSummaries, listWorkspacesWithProjects } from "@/server/services/projectService";
import { countTrashedWorkspaces } from "@/server/services/trashService";
import { buildWritingProgress } from "@/server/services/writingProgressService";
import { pickFeaturedProject } from "@/ui/library";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const db = getDb();
  const cookieStore = await cookies();
  const selectedId = cookieStore.get(PROJECT_COOKIE)?.value ?? null;
  const [workspaces, summaries, trashedWorkspaces] = await Promise.all([
    listWorkspacesWithProjects(db),
    listProjectSummaries(db),
    countTrashedWorkspaces(db),
  ]);
  const counts = new Map(summaries.map((summary) => [summary.id, summary]));
  const coverHashes = await listProjectCoverHashes(
    db,
    workspaces.flatMap((workspace) => workspace.projects.map((project) => project.id)),
  );
  const library: LibraryWorkspace[] = workspaces.map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
    projects: workspace.projects.map((project) => {
      const summary = counts.get(project.id);
      return {
        id: project.id,
        title: project.title,
        seriesName: project.seriesName,
        chapterCount: summary ? summary.chapterCount : null,
        manuscriptWords: summary ? summary.manuscriptWords : null,
        coverHash: coverHashes.get(project.id) ?? null,
      };
    }),
  }));

  const featured = pickFeaturedProject(
    library.flatMap((workspace) =>
      workspace.projects.map((project) => ({
        ...project,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
      })),
    ),
    selectedId,
  );
  let featuredProgress = null;
  if (featured) {
    const drafts = await listManuscriptDrafts(db, featured.id);
    const draftId = resolveWriteDraftId(drafts, cookieStore.get(WRITE_DRAFT_COOKIE)?.value);
    featuredProgress = await buildWritingProgress(db, {
      projectId: featured.id,
      hasDrafts: drafts.length > 0,
      draftId,
      sessionSince: null,
    });
  }

  return (
    <LibraryHome
      workspaces={library}
      selectedId={selectedId}
      trashedWorkspaces={trashedWorkspaces}
      featuredProgress={featuredProgress}
    />
  );
}
