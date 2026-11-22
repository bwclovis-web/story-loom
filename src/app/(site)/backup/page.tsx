import { HelpHint } from "@/components/HelpHint";
import { getDb } from "@/server/db";
import { backupMirrorSettingsPath, loadBackupMirrorSettings } from "@/server/backupMirrorSettings";
import { listWorkspacesWithProjects } from "@/server/services/projectService";
import { BACKUP } from "@/ui/labels";
import { BackupMirrorSettings } from "./BackupMirrorSettings";
import { RestoreClient } from "./RestoreClient";
import { RollingBackupPanel } from "./RollingBackupPanel";
import { SyncBundleClient } from "./SyncBundleClient";

export const dynamic = "force-dynamic";

export default async function BackupPage() {
  const workspaces = await listWorkspacesWithProjects(getDb());
  const mirror = loadBackupMirrorSettings();
  const fromEnv = Boolean(process.env.WORDLY_BACKUP_MIRROR_DIR?.trim());
  return (
    <>
      <h1>{BACKUP.heading}</h1>
      <section className="panel">
        <h2 style={{ marginTop: 0 }}>{BACKUP.downloadHeading}</h2>
        <p className="small muted">
          A <code>wordly.workspace-backup</code> file contains every project, record, revision, provenance source,
          protection flag, canon status, applied change package (with its hash), audit entry, open review item,
          imported source file and image in the workspace, including anything in the Trash. Keep it outside the
          repository. Workspaces in the Trash are listed on the Trash page instead.
        </p>
        <HelpHint anchor="full-backup" topic="full backups">
          A backup holds everything in the workspace and can be restored. A context export cannot. A backup kept on this
          computer will not survive losing the computer, so keep a copy somewhere else you control.
        </HelpHint>
        {workspaces.length === 0 ? <p className="muted">No workspaces.</p> : null}
        <ul>
          {workspaces.map((w) => (
            <li key={w.id}>
              <a href={`/backup/${w.id}`} download>
                {w.name}
              </a>{" "}
              <span className="muted small">
                {w.id} &middot; {w.projects.length} project{w.projects.length === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>
        <p className="small muted">
          For a full database snapshot as well (all workspaces plus the raw SQLite file), run <code>pnpm db:backup</code>.
        </p>
      </section>
      <section className="panel">
        <h2 style={{ marginTop: 0 }}>{BACKUP.mirrorHeading}</h2>
        <HelpHint anchor="backup-mirror" topic="backup mirror folder">
          Optional mirror for full backups only—not a substitute for copying workspace JSON files elsewhere.
        </HelpHint>
        <BackupMirrorSettings mirrorDir={mirror.mirrorDir} fromEnv={fromEnv} settingsPath={backupMirrorSettingsPath()} />
        <RollingBackupPanel
          scheduleEnabled={mirror.scheduleEnabled ?? false}
          retentionCount={mirror.retentionCount ?? 14}
          lastScheduledBackupAt={mirror.lastScheduledBackupAt ?? null}
          mirrorConfigured={Boolean(mirror.mirrorDir)}
          fromEnv={fromEnv}
        />
      </section>
      <section className="panel">
        <h2 style={{ marginTop: 0 }}>{BACKUP.syncHeading}</h2>
        <HelpHint anchor="sync-bundle" topic="sync bundles">
          Compare record revisions between machines without overwriting the database directly.
        </HelpHint>
        <ul>
          {workspaces.map((w) => (
            <li key={`sync-${w.id}`}>
              <a href={`/backup/sync-bundle/${w.id}`} download>
                {BACKUP.syncExportLink}: {w.name}
              </a>
            </li>
          ))}
        </ul>
        <SyncBundleClient workspaces={workspaces} />
      </section>
      <section className="panel">
        <h2 style={{ marginTop: 0 }}>{BACKUP.restoreHeading}</h2>
        <p className="small muted">
          The backup is checked completely before anything is written. It is restored beside your existing work as a
          separate workspace with new IDs, in a single transaction. Existing workspaces are never modified. To restore
          with the original IDs into a separate database file, use <code>pnpm db:restore &lt;file&gt; --new-database
          &lt;path&gt;</code>.
        </p>
        <HelpHint anchor="restore" topic="restoring">
          Restoring never overwrites your current work. It adds a copy of the backup as a new workspace on the home page.
        </HelpHint>
        <RestoreClient />
      </section>
    </>
  );
}
