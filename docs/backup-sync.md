# Backup mirror and cloud sync

Story Loom keeps the **live database** on your machine (`prisma/dev.db` by default, or `storyloom.db` in your library folder on desktop). Full backups are folders under `backups/` in the project directory (git-ignored).

## Optional mirror folder

You can copy every **full** backup to another folder after it is written:

1. **In the app:** Settings → **Backup & restore** → **Also copy full backups to a folder**. Enter an absolute path (for example a Dropbox or OneDrive directory).
2. **In `.env`:** Set `WORDLY_BACKUP_MIRROR_DIR` to the same kind of path. This overrides the in-app setting.

Schedule and retention live in the same `local/backup-mirror.json` file (`scheduleEnabled`, `retentionCount`, `lastScheduledBackupAt`). Defaults: schedule off, keep **14** mirrored folders.

The mirror runs for:

- `pnpm db:backup`
- `pnpm db:deploy` (pre-migrate backup)
- Permanent delete from the Trash (pre-delete backup)
- **Rolling backups** from Backup & restore (manual) or the desktop app when the schedule is on (launch, daily timer, on close)

It does **not** run for workspace JSON downloads from the Backup page—save those elsewhere yourself.

Each mirror copy is a complete subfolder (SQLite snapshot plus `*.wordly-backup.json` files) and includes a small `mirror-manifest.json` with the source path and time. Rolling backups prune older timestamped subfolders in the mirror root beyond your retention count.

## Verifying a mirrored backup

From the Story Loom project folder:

```bash
pnpm db:verify-backup "C:/path/to/mirror/2026-11-21T15-30-00-000Z"
```

Use the path to the **timestamped subfolder**, not only the mirror root. Verification never touches your working database.

## Sync bundles (revision compare)

A **sync bundle** (`.wordly-sync-bundle.json`) is a lightweight export of one workspace: every record's `currentRevision`, `contentHash`, title, and body snapshot. Use it to compare two machines without copying the whole database.

1. On **Backup & restore**, download **sync bundle** for a workspace.
2. On the other machine, open the same page, choose your workspace, and **Inspect** the file.
3. Review conflicts (revision or hash differs) and choose **Take bundle copy** per record.
4. **Apply** builds a normal change package; nothing writes until you confirm (protected records need an extra checkbox).

Sync bundles never restore SQLite directly and never replace a full backup for disaster recovery.

## Desktop API keys (Electron)

On the installable desktop app, the OpenAI API key can live in the OS keychain via Electron `safeStorage`. The shell writes `local/desktop-assistant-bridge.json` and injects `WORDLY_OPENAI_API_KEY` into the local server. Precedence:

1. Desktop OS keychain / safeStorage (injected env)
2. `local/assistant-secrets.json` (Settings; web still stores plaintext keys here when not on desktop)
3. `.env` `WORDLY_*` only (shared `OPENAI_API_KEY` is ignored)

## Safe sync workflow

| Do | Don't |
| --- | --- |
| Sync **backup folders** or **downloaded** `.wordly-backup.json` / sync bundle files | Sync or share the live `*.db` file while Story Loom is open on another machine |
| Run **one** dev server against **one** database file | Run two copies of the app against the same database path |
| Restore from a mirror into a **new** workspace or **new** database file | Assume cloud sync replaces proper backups |

Cloud tools (Dropbox, OneDrive, iCloud) can lag or merge badly on SQLite. Treat mirrored backups as **copies for safekeeping**, not as the database the app writes to.

## Phone reading view

A separate phone reading UI is **out of scope** for this milestone. It would conflict with the default local-only `127.0.0.1` rule until you explicitly change hosting.