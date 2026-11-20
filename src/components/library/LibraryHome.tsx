import Link from "next/link";
import { BookCover } from "@/components/library/BookCover";
import { NewManuscriptButton, NewWorkspaceButton } from "@/components/library/LibraryDialogs";
import { ManuscriptActions, WorkspaceActions } from "@/components/library/LibraryMenus";
import { helpHref } from "@/help/outline";
import { clearCoverAction, setCoverAction, trashWorkspaceAction } from "@/app/(site)/actions";
import { trashProjectAction } from "@/app/projects/[projectId]/actions";
import { HOME, SHELL, TRASH } from "@/ui/labels";
import { isExampleWorkspace, manuscriptEyebrow, pickFeaturedProject } from "@/ui/library";
import { formatWordCount } from "@/writing/wordCount";

export interface LibraryProject {
  id: string;
  title: string;
  seriesName: string | null;
  /** Null when the count could not be read. Zero is a real count. */
  chapterCount: number | null;
  manuscriptWords: number | null;
  /** sha256 of a stored cover. Null uses the drawn cover. */
  coverHash: string | null;
}

export interface LibraryWorkspace {
  id: string;
  name: string;
  projects: LibraryProject[];
}

export function LibraryHome({
  workspaces,
  selectedId,
  trashedWorkspaces,
}: {
  workspaces: LibraryWorkspace[];
  selectedId: string | null;
  trashedWorkspaces: number;
}) {
  const ordered = workspaces.flatMap((workspace) =>
    workspace.projects.map((project) => ({
      ...project,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
    })),
  );
  const featured = pickFeaturedProject(ordered, selectedId);
  const own = workspaces.filter((workspace) => !isExampleWorkspace(workspace.id));
  const examples = workspaces.filter((workspace) => isExampleWorkspace(workspace.id));

  return (
    <div className="library">
      <header className="library-header">
        <h1>{HOME.heading}</h1>
        <NewWorkspaceButton />
      </header>

      {workspaces.length === 0 ? (
        <EmptyLibrary trashedWorkspaces={trashedWorkspaces} />
      ) : (
        <>
          {featured ? (
            <FeaturedManuscript
              project={featured}
              eyebrow={manuscriptEyebrow(featured.seriesName, featured.workspaceName)}
            />
          ) : null}

          <hr className="library-rule" />

          <section className="library-section" aria-labelledby="your-workspaces">
            <h2 id="your-workspaces">{HOME.yourWorkspaces}</h2>
            {own.length === 0 ? <p className="library-empty">{HOME.noWorkspaces}</p> : null}
            {own.map((workspace) => (
              <WorkspaceBlock key={workspace.id} workspace={workspace} />
            ))}
          </section>
        </>
      )}

      {examples.length > 0 ? (
        <>
          <hr className="library-rule" />
          <details className="library-examples" open>
            <summary>
              <span className="library-examples-title">{HOME.examples}</span>
            </summary>
            {examples.map((workspace) => (
              <WorkspaceBlock key={workspace.id} workspace={workspace} example />
            ))}
          </details>
        </>
      ) : null}

      <p className="library-quick">
        <Link href={helpHref("quick-start")}>{HOME.quickStart}</Link>
      </p>
    </div>
  );
}

function EmptyLibrary({ trashedWorkspaces }: { trashedWorkspaces: number }) {
  if (trashedWorkspaces > 0) {
    return (
      <p className="library-empty library-empty-lead">
        {HOME.noWorkspaces} {TRASH.workspacesInTrash(trashedWorkspaces)} <Link href="/trash">{TRASH.goToTrash}</Link> to
        restore.
      </p>
    );
  }
  return (
    <p className="library-empty library-empty-lead">
      {HOME.noWorkspaces} Create one with {HOME.newWorkspaceHeading}, or run <code>pnpm db:seed</code> for a demo project.
    </p>
  );
}

function FeaturedManuscript({
  project,
  eyebrow,
}: {
  project: LibraryProject & { workspaceName: string };
  eyebrow: string;
}) {
  return (
    <section className="library-feature" aria-labelledby="featured-manuscript">
      <BookCover projectId={project.id} title={project.title} eyebrow={eyebrow} size="featured" coverSrc={coverSrc(project)} />
      <div className="library-feature-copy">
        {eyebrow ? <p className="library-kicker">{eyebrow}</p> : null}
        <h2 id="featured-manuscript">{project.title}</h2>
        <ManuscriptMeta chapterCount={project.chapterCount} manuscriptWords={project.manuscriptWords} />
        <Link className="library-open-manuscript" href={manuscriptHref(project.id)}>
          {HOME.openManuscript}
          <span className="sr-only">: {project.title}</span>
        </Link>
      </div>
    </section>
  );
}

function WorkspaceBlock({ workspace, example = false }: { workspace: LibraryWorkspace; example?: boolean }) {
  return (
    <section className="library-workspace" aria-labelledby={`workspace-${workspace.id}`}>
      <div className="library-workspace-head">
        <h3 id={`workspace-${workspace.id}`}>{workspace.name}</h3>
        <WorkspaceActions
          name={workspace.name}
          projectCount={workspace.projects.length}
          action={trashWorkspaceAction.bind(null, workspace.id)}
        />
      </div>
      {workspace.projects.length === 0 ? <p className="library-empty">{HOME.noManuscripts}</p> : null}
      <ul className="manuscript-list">
        {workspace.projects.map((project) => (
          <li key={project.id}>
            <ManuscriptEntry project={project} workspaceName={workspace.name} example={example} />
          </li>
        ))}
      </ul>
      <NewManuscriptButton workspaceId={workspace.id} />
    </section>
  );
}

function ManuscriptEntry({
  project,
  workspaceName,
  example = false,
}: {
  project: LibraryProject;
  workspaceName: string;
  example?: boolean;
}) {
  const eyebrow = manuscriptEyebrow(project.seriesName, workspaceName);
  return (
    <div className="manuscript-row">
      <BookCover projectId={project.id} title={project.title} eyebrow={eyebrow} size="mini" coverSrc={coverSrc(project)} />
      <div className="manuscript-copy">
        <p className="manuscript-title">{project.title}</p>
        {example ? (
          <p className="manuscript-meta">{HOME.exampleManuscript}</p>
        ) : (
          <ManuscriptMeta chapterCount={project.chapterCount} manuscriptWords={project.manuscriptWords} />
        )}
      </div>
      <Link className="library-open" href={manuscriptHref(project.id)}>
        {HOME.open}
        <span className="sr-only"> {project.title}</span>
      </Link>
      <ManuscriptActions
        title={project.title}
        action={trashProjectAction.bind(null, project.id)}
        hasCover={project.coverHash !== null}
        setCover={setCoverAction.bind(null, project.id)}
        clearCover={clearCoverAction.bind(null, project.id)}
      />
    </div>
  );
}

function ManuscriptMeta({
  chapterCount,
  manuscriptWords,
}: {
  chapterCount: number | null;
  manuscriptWords: number | null;
}) {
  const parts: string[] = [];
  if (chapterCount !== null) parts.push(SHELL.chapters(chapterCount));
  if (manuscriptWords !== null) parts.push(formatWordCount(manuscriptWords));
  if (parts.length === 0) return null;
  return <p className="manuscript-meta">{parts.join(" · ")}</p>;
}

function manuscriptHref(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/write`;
}

function coverSrc(project: LibraryProject): string | null {
  if (!project.coverHash) return null;
  return `/projects/${encodeURIComponent(project.id)}/cover?v=${project.coverHash}`;
}
