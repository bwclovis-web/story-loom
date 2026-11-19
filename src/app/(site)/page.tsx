import { Button } from "@/components/ui/Button";
import Link from "next/link";
import { ConfirmAction } from "@/components/ConfirmAction";
import { helpHref } from "@/help/outline";
import { getDb } from "@/server/db";
import { listWorkspacesWithProjects } from "@/server/services/projectService";
import { countTrashedWorkspaces } from "@/server/services/trashService";
import { HOME, NAV, SHELL, TRASH } from "@/ui/labels";
import { trashProjectAction } from "../projects/[projectId]/actions";
import { createProjectAction, createWorkspaceAction, trashWorkspaceAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const db = getDb();
  const [workspaces, trashedWorkspaces] = await Promise.all([listWorkspacesWithProjects(db), countTrashedWorkspaces(db)]);

  return (
    <>
      <h1>{HOME.heading}</h1>
      {workspaces.length === 0 && trashedWorkspaces > 0 ? (
        <p className="muted">
          No workspaces here. {TRASH.workspacesInTrash(trashedWorkspaces)} <Link href="/trash">{TRASH.goToTrash}</Link> to restore.
        </p>
      ) : workspaces.length === 0 ? (
        <p className="muted">
          No workspaces yet. Create one below, or run <code>pnpm db:seed</code> for a demo project.
        </p>
      ) : null}
      <p className="hint">
        New here? Start with the <Link href={helpHref("quick-start")}>{NAV.help} quick start</Link>.
      </p>

      {workspaces.map((w) => (
        <section key={w.id} className="panel">
          <h2 style={{ marginTop: 0 }}>
            {w.name} <span className="muted small">{w.id}</span>
          </h2>
          {w.projects.length === 0 ? <p className="muted">No projects.</p> : null}
          <ul className="trash-list">
            {w.projects.map((p) => (
              <li key={p.id}>
                <div className="trash-item">
                  <Link href={`/projects/${p.id}`}>{p.title}</Link> <span className="muted small">{p.id}</span>
                </div>
                <ConfirmAction
                  action={trashProjectAction.bind(null, p.id)}
                  label={TRASH.moveProject}
                  confirmLabel={TRASH.confirmMove(p.title)}
                  pendingLabel={TRASH.moving}
                  details={<p className="small">Everything in it moves too. You can restore it from the {TRASH.heading} page.</p>}
                  small
                />
              </li>
            ))}
          </ul>
          <form action={createProjectAction} className="row">
            <input type="hidden" name="workspaceId" value={w.id} />
            <input type="text" name="title" placeholder={HOME.projectTitlePlaceholder} aria-label={HOME.projectTitlePlaceholder} required />
            <Button type="submit" variant="secondary">
              {HOME.addProject}
            </Button>
          </form>
          <div className="workspace-trash">
            <ConfirmAction
              action={trashWorkspaceAction.bind(null, w.id)}
              label={TRASH.moveWorkspace}
              confirmLabel={TRASH.confirmMove(w.name)}
              pendingLabel={TRASH.moving}
              details={
                <p className="small">
                  {w.projects.length === 0
                    ? "It has no projects."
                    : w.projects.length === 1
                      ? "Its project and everything in it move too."
                      : `Its ${SHELL.projects(w.projects.length)} and everything in them move too.`}{" "}
                  You can restore it from the {TRASH.heading} page.
                </p>
              }
              small
            />
          </div>
        </section>
      ))}

      <p className="small muted">
        Moved something by mistake? <Link href="/trash">{TRASH.goToTrash}</Link>.
      </p>

      <section className="panel">
        <h2>{HOME.newWorkspaceHeading}</h2>
        <form action={createWorkspaceAction} className="row">
          <input type="text" name="name" placeholder={HOME.workspaceNamePlaceholder} aria-label={HOME.workspaceNamePlaceholder} required />
          <Button type="submit">{HOME.createWorkspace}</Button>
        </form>
      </section>
    </>
  );
}
