import type { Metadata } from "next";
import { ActionButton, ConfirmAction } from "@/components/ConfirmAction";
import { HelpHint } from "@/components/HelpHint";
import { Banner } from "@/components/ui/Banner";
import { RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import { getDb } from "@/server/db";
import { listTrash, describeDeleteCounts } from "@/server/services/trashService";
import { NAV, SHELL, TRASH } from "@/ui/labels";
import {
  deleteProjectAction,
  deleteRecordsAction,
  deleteWorkspaceAction,
  emptyTrashAction,
  restoreProjectAction,
  restoreRecordsAction,
  restoreWorkspaceAction,
} from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `${TRASH.heading} · ${NAV.brand}` };

const count = (value: string | undefined) => (value && /^\d+$/.test(value) ? Number(value) : 0);

function DeletedBanner({ query }: { query: Record<string, string | undefined> }) {
  const backup = query.backup && /^[\w.-]+$/.test(query.backup) ? query.backup : null;
  if (!backup) return null;
  const counts = { workspaces: count(query.workspaces), projects: count(query.projects), records: count(query.records) };
  return (
    <Banner tone="ok">
      Deleted permanently: {describeDeleteCounts(counts)}. A full backup was written first, to{" "}
      <code>backups/{backup}</code> in the project folder.
    </Banner>
  );
}

function BackupNote() {
  return (
    <p className="small">
      This cannot be undone in the app. A full backup of the database is written to the <code>backups</code> folder first,
      and nothing is deleted if that fails.
    </p>
  );
}

export default async function TrashPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const query = await searchParams;
  const trash = await listTrash(getDb());
  const isEmpty = !trash.workspaces.length && !trash.projects.length && !trash.records.length;

  return (
    <>
      <h1>{TRASH.heading}</h1>
      <DeletedBanner query={query} />
      <p>
        Anything in the Trash is hidden from every list, page, search, export and connection, but nothing is removed. Restore
        puts it back as it was, with its saved versions and history.
      </p>
      <HelpHint anchor="trash" topic="the Trash">
        Deleting permanently removes the item and its history from the database, after a full backup.
      </HelpHint>

      {isEmpty ? <p className="muted">{TRASH.empty}</p> : null}

      {trash.workspaces.length ? (
        <section className="panel" aria-labelledby="trash-workspaces">
          <h2 id="trash-workspaces" style={{ marginTop: 0 }}>
            {TRASH.workspacesHeading}
          </h2>
          <ul className="trash-list">
            {trash.workspaces.map((w) => (
              <li key={w.id}>
                <div className="trash-item">
                  <strong>{w.name}</strong>
                  <p className="small muted">
                    {SHELL.projects(w.projectCount)}, with everything in {w.projectCount === 1 ? "it" : "them"}. Moved {w.trashedAt.toLocaleString()}.{" "}
                    <a href={`/backup/${w.id}`} download>
                      {TRASH.downloadBackup}
                    </a>
                  </p>
                </div>
                <div className="trash-actions">
                  <ActionButton action={restoreWorkspaceAction.bind(null, w.id)} label={TRASH.restore} pendingLabel={TRASH.restoring} small />
                  <ConfirmAction
                    action={deleteWorkspaceAction.bind(null, w.id)}
                    label={TRASH.deletePermanently}
                    confirmLabel={TRASH.confirmDelete(w.name)}
                    pendingLabel={TRASH.deleting}
                    details={<BackupNote />}
                    small
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {trash.projects.length ? (
        <section className="panel" aria-labelledby="trash-projects">
          <h2 id="trash-projects" style={{ marginTop: 0 }}>
            {TRASH.projectsHeading}
          </h2>
          <ul className="trash-list">
            {trash.projects.map((p) => (
              <li key={p.id}>
                <div className="trash-item">
                  <strong>{p.title}</strong>
                  <p className="small muted">
                    In {p.workspaceName}. {SHELL.records(p.recordCount)}. Moved {p.trashedAt.toLocaleString()}.
                  </p>
                </div>
                <div className="trash-actions">
                  <ActionButton action={restoreProjectAction.bind(null, p.id)} label={TRASH.restore} pendingLabel={TRASH.restoring} small />
                  <ConfirmAction
                    action={deleteProjectAction.bind(null, p.id)}
                    label={TRASH.deletePermanently}
                    confirmLabel={TRASH.confirmDelete(p.title)}
                    pendingLabel={TRASH.deleting}
                    details={<BackupNote />}
                    small
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {trash.records.length ? (
        <section className="panel" aria-labelledby="trash-records">
          <h2 id="trash-records" style={{ marginTop: 0 }}>
            {TRASH.recordsHeading}
          </h2>
          <ul className="trash-list">
            {trash.records.map((g) => (
              <li key={`${g.projectId}/${g.batchId}`}>
                <div className="trash-item">
                  <strong>{g.lead.title}</strong> <span className="muted small">{RECORD_TYPE_LABELS[g.lead.type]}</span>
                  <p className="small muted">
                    In {g.projectTitle} ({g.workspaceName}). Moved {g.trashedAt.toLocaleString()}.
                  </p>
                  {g.inside.length ? (
                    <p className="small">
                      With what was inside it: {g.inside.map((r) => `${r.title} (${RECORD_TYPE_LABELS[r.type].toLowerCase()})`).join(", ")}.
                    </p>
                  ) : null}
                  {g.waitsFor ? (
                    <p className="small">
                      It belongs to &ldquo;{g.waitsFor}&rdquo;, which is also in the Trash. Restore that first.
                    </p>
                  ) : null}
                </div>
                <div className="trash-actions">
                  <ActionButton
                    action={restoreRecordsAction.bind(null, g.projectId, g.batchId)}
                    label={TRASH.restore}
                    pendingLabel={TRASH.restoring}
                    small
                  />
                  <ConfirmAction
                    action={deleteRecordsAction.bind(null, g.projectId, g.batchId)}
                    label={TRASH.deletePermanently}
                    confirmLabel={TRASH.confirmDelete(g.lead.title)}
                    pendingLabel={TRASH.deleting}
                    details={<BackupNote />}
                    small
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {isEmpty ? null : (
        <section className="panel" aria-labelledby="trash-empty">
          <h2 id="trash-empty" style={{ marginTop: 0 }}>
            {TRASH.emptyTrash}
          </h2>
          <p className="small muted">Deletes everything listed above permanently.</p>
          <ConfirmAction
            action={emptyTrashAction}
            label={TRASH.emptyTrash}
            confirmLabel={TRASH.confirmEmpty}
            pendingLabel={TRASH.deleting}
            details={<BackupNote />}
          />
        </section>
      )}
    </>
  );
}
