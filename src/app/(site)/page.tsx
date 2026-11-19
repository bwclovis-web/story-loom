import { cookies } from "next/headers";
import { LibraryHome, type LibraryWorkspace } from "@/components/library/LibraryHome";
import { PROJECT_COOKIE } from "@/components/shell/preferences";
import { getDb } from "@/server/db";
import { listProjectSummaries, listWorkspacesWithProjects } from "@/server/services/projectService";
import { countTrashedWorkspaces } from "@/server/services/trashService";

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
      };
    }),
  }));

  return <LibraryHome workspaces={library} selectedId={selectedId} trashedWorkspaces={trashedWorkspaces} />;
}
