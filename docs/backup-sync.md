# Backup mirror and cloud sync

Story Loom keeps the **live database** on your machine (`prisma/dev.db` by default). Full backups are folders under `backups/` in the project directory (git-ignored).

## Optional mirror folder

You can copy every **full** backup to another folder after it is written:

1. **In the app:** Settings → **Backup & restore** → **Also copy full backups to a folder**. Enter an absolute path (for example a Dropbox or OneDrive directory).
2. **In `.env`:** Set `WORDLY_BACKUP_MIRROR_DIR` to the same kind of path. This overrides the in-app setting.

The mirror runs for:

- `pnpm db:backup`
- `pnpm db:deploy` (pre-migrate backup)
- Permanent delete from the Trash (pre-delete backup)

It does **not** run for workspace JSON downloads from the Backup page—save those elsewhere yourself.

Each mirror copy is a complete subfolder (SQLite snapshot plus `*.wordly-backup.json` files) and includes a small `mirror-manifest.json` with the source path and time.

## Verifying a mirrored backup

From the Story Loom project folder:

```bash
pnpm db:verify-backup "C:/path/to/mirror/2026-11-21T15-30-00-000Z"
```

Use the path to the **timestamped subfolder**, not only the mirror root. Verification never touches your working database.

## Safe sync workflow

| Do | Don't |
| --- | --- |
| Sync **backup folders** or **downloaded** `.wordly-backup.json` files | Sync or share the live `*.db` file while Story Loom is open on another machine |
| Run **one** dev server against **one** database file | Run two copies of the app against the same database path |
| Restore from a mirror into a **new** workspace or **new** database file | Assume cloud sync replaces proper backups |

Cloud tools (Dropbox, OneDrive, iCloud) can lag or merge badly on SQLite. Treat mirrored backups as **copies for safekeeping**, not as the database the app writes to.

## Phone reading view

A separate phone reading UI is **out of scope** for this milestone. It would conflict with the default local-only `127.0.0.1` rule until you explicitly change hosting.