# Upgrade baseline (before the Storyloom upgrade)

Baseline pass of Nov 14, 2026. Records what Wordly Editor stores and exposes,
what an upgraded app must keep reading, and how to return to the matching
pre-migration code and database. No schema, route, format or behavior change
was made in this pass.

## Code and database baseline

| Item | Value |
| --- | --- |
| Code | `main` at `28d6fd2` ("Update WordlyEditor features and interface"), plus this pass (scripts, fixture and docs only; no migration) |
| Runtime | Node 24.14.1, pnpm 10.33.0, Next.js 16.4.3 (Turbopack), Prisma 7.10.1 (pinned) with `@prisma/adapter-better-sqlite3` |
| Database file | `prisma/dev.db`, from `DATABASE_URL="file:./prisma/dev.db"` in `.env` (also the default when unset). Relative paths resolve from the project root (`src/server/dbLocation.ts`). `pnpm db:info` prints the resolved path |
| SQLite journal | `delete` (no WAL files) |
| Prisma | Schema `prisma/schema.prisma`, config `prisma.config.ts`, client generated to `src/generated/prisma` (git-ignored; `postinstall` and `pnpm db:generate` rebuild it) |
| Migrations (10) | `20261025150342_init`, `20261025152500_package_scope_and_file_imports`, `20261025170000_assistant_conversations`, `20261025200000_assistant_proposals`, `20261025220000_proofread_runs`, `20261025230000_dictionary_entries`, `20261026090000_scenes_and_links`, `20261026160000_record_images`, `20261026190000_trash`, `20261026210000_book_order` |
| Baseline backup | `backups/2026-11-14T19-37-37-908Z-baseline-pre-storyloom/` (git-ignored): `dev.db` snapshot, one `*.wordly-backup.json` per workspace, `restore-check.db`, `inventory-snapshot.json`, `inventory-restore-check.json` |

## Database commands

| Command | Effect |
| --- | --- |
| `pnpm db:info` | Read-only: path, applied migrations, row counts |
| `pnpm db:backup [--label name]` | Read-only on the database: `backups/<timestamp>[-label]/` with a SQLite online-backup snapshot and one JSON backup per workspace (Trash included) |
| `pnpm db:deploy` | Backs up (`-pre-migrate`), then `prisma migrate deploy`. The only way to apply schema changes to the working database |
| `pnpm db:restore <file> --dry-run` | Validates and summarizes a workspace backup |
| `pnpm db:restore <file> --new-database <path>` | New SQLite file (refuses an existing path), migrations applied, original IDs |
| `pnpm db:restore <file> --into-current [--name ...]` | Backs up, then adds the workspace with new IDs |
| `pnpm db:inventory [--database f] [--out f] [--label x]` | New. Read-only inventory (IDs, structure, counts, sha256 hashes; no titles or text). Default output `backups/<timestamp>-inventory.json` |
| `pnpm db:inventory --compare <before> <after> [--ignore-not-in-backups]` | New. Lists differences; exit code 1 if any |
| `pnpm db:verify-backup backups/<folder>` | New. Restores every workspace file of a backup folder into `<folder>/restore-check.db` with original IDs and compares inventories with the folder's snapshot |
| `pnpm db:migrate:dev` | Developer only; backs up first. Answer no to any reset |
| `pnpm db:setup`, `pnpm db:seed` | Fresh setup; adds the demo project if missing |
| `pnpm db:reset --confirm-delete-all-data` | Destructive. Never on the author's database |

## What is stored

| Table | Contents | In workspace backups |
| --- | --- | --- |
| `Workspace`, `Project` | IDs, names, `trashedAt` | yes |
| `Record` | Current title, exact body, fields JSON, canon status, superseded-by, protection, parent, book position, current revision, Trash batch | yes |
| `Revision` | Immutable snapshots with `contentHash` and `sourceId` | yes |
| `Source` | Provenance (`ui`, `change_package`, `markdown_import`, `api`), actor, conversation label, URL, package ID, original filename | yes |
| `ChangePackage` | Applied-package history keyed by (`projectId`, `packageId`): content hash, exact raw JSON, result JSON | yes |
| `AuditEntry` | Every write, with details JSON | yes |
| `ReviewItem` | Open/resolved review notes | yes |
| `ImportedFile` | Exact imported Markdown/chapter files with hashes and resulting revision | yes |
| `DictionaryEntry` | Author's accepted spellings, project or workspace scope | yes (optional key) |
| `RecordLink` | Chapter/scene to reference links | yes (optional key) |
| `RecordImage` | Image bytes and metadata on reference records | yes (optional key, base64) |
| `AssistantConversation`, `AssistantMessage`, `AssistantContextItem`, `AssistantProposal`, `ProofreadRun` | Assistant history, usage and proposals | **no**: only the SQLite file keeps them |

## Formats the app reads or writes

| Format | Version | Direction | Where | Notes |
| --- | --- | --- | --- | --- |
| `wordly.workspace-backup` | 1 | read and write | `*.wordly-backup.json`; `src/backup/format.v1.ts`; [backup-format.md](backup-format.md) | Strict schema, sha256 checksum over `stableStringify`, `app.name` must be `"wordly-editor"`. Optional keys were added over time (see below). Refuses other versions and any backup listing a migration the app does not know ("newer schema") |
| `wordly.change-package` | 1 | read | Pasted or uploaded JSON, any filename (the app has no `.wordly.json` naming rule); `src/changePackage/schema.v1.ts`; [change-package-format.md](change-package-format.md); `docs/schemas/change-package.v1.schema.json` | Ops `create_record`, `update_record`, `set_authority_status`. Idempotency per (`projectId`, `packageId`) + content hash of the normalized package |
| Assistant proposal | change package v1 | stored | `AssistantProposal.packageJson` | Applied only through `applyChangePackage` |
| `wordly.context-bundle` | 1 | write only | Export context page; [context-bundle-format.md](context-bundle-format.md) | ChatGPT conversations hold copies; packages built from them carry those record IDs and revisions |
| `wordly.dictionary` | 1 | read and write | `*.wordly-dictionary.json`; `src/spelling/dictionaryFile.ts` | Import also accepts plain word lists and Hunspell `.dic` |
| MCP grant | unversioned, strict | read; Connections page writes `capabilities: ["read"]` only | `mcp/grant.json` (or `WORDLY_MCP_GRANT_FILE`) | `id`, `label`, `status`, `projectIds`, `capabilities`, `manuscriptRead` |
| Markdown / text files | n/a | read | Import references, Import chapters, Load text from file | Kept verbatim in `ImportedFile` |
| PDF | n/a | write | `/projects/[id]/pdf` | |
| `wordly.database-inventory` | 1 | tooling | `src/server/inventory.ts` | New in this pass; not read by the app |

Workspace backup v1 shapes in use: first v1 (`906d5f0`; no parents, book
order, Trash, dictionary, links or images, two migrations listed); then
`dictionaryEntries`; `recordLinks` and `parentRecordId`; `recordImages`;
`trashedAt` / `trashBatchId`; `position`. All are the same `formatVersion: 1`.

## Import and export entry points

- Pages: `/backup` (download, check, restore as new workspace),
  `/projects/[id]/import` (change package preview/apply),
  `/projects/[id]/import-markdown` (reference files),
  `/projects/[id]/import-chapters` (chapter files), `/projects/[id]/export`
  (context bundle), `/projects/[id]/export-pdf`, `/projects/[id]/dictionary`
  (import/export), `/projects/[id]/assistant` (proposals → apply),
  `/connections` (MCP grant), `/trash` (permanent delete, backs up first).
- Server actions: `checkBackupAction`, `restoreBackupAction`,
  `previewPackageAction`, `reviewPackageAction`, `applyPackageAction`,
  `exportBundleAction`, `previewMarkdownAction`, `applyMarkdownAction`,
  `previewChaptersAction`, `importChaptersAction`, `applyProposalAction`,
  dictionary add/import actions, `addImagesAction`, `saveGrantSettingsAction`.
- GET downloads: `/backup/[workspaceId]`, `/projects/[id]/pdf?kind=manuscript|references&type=&record=&sceneTitles=1`,
  `/projects/[id]/dictionary/export?scope=project|workspace`,
  `/projects/[id]/images/[imageId]`, `/api/spelling/[language]/[file]`.
- POST APIs (same-origin only): `/api/projects/[id]/assistant/turn`,
  `/assistant/cancel`, `/proofread`, `/proofread/cancel`.
- Scripts: `db:backup`, `db:restore`, `db:inventory`, `db:verify-backup`, `schema:export`.
- MCP (stdio, read-only, `pnpm mcp:stdio`, server name `wordly-editor`):
  `list_projects`, `search_references`, `get_records`, `list_revisions`,
  `get_revision`, `list_sections`, `get_section`, `review_history`.

## Published routes

From `pnpm build` (all dynamic): `/`, `/backup`, `/backup/[workspaceId]`,
`/connections`, `/help`, `/trash`, `/projects/[projectId]` and its
`assistant`, `assistant/proposals/[proposalId]`, `cross-references`,
`dictionary`, `dictionary/export`, `export`, `export-pdf`, `history`,
`images/[imageId]`, `import`, `import-chapters`, `import-markdown`, `pdf`,
`plan`, `read`, `records/[recordId]`, `world`, `write`, plus the five `/api/...`
routes above. Query parameters in links and bookmarks: `?c=` (assistant
conversation), `records/[id]?from=&to=&edit=&find=&case=`, `write?q=&case=`,
`world?type=&q=`, `export` and `export-pdf?record=&type=&group=`. The app
listens on `127.0.0.1:2112` (`pnpm dev` and `pnpm start`).

## Configuration keys and identifiers

- Environment: `DATABASE_URL`, `WORDLY_OPENAI_API_KEY`, `OPENAI_MODEL`,
  `ASSISTANT_MAX_INPUT_CHARS`, `ASSISTANT_MAX_OUTPUT_TOKENS`,
  `ASSISTANT_MAX_REQUESTS_PER_HOUR`, `ASSISTANT_MONTHLY_TOKEN_CAP`,
  `ASSISTANT_REQUEST_TIMEOUT_SECONDS`, `WORDLY_MCP_DISABLED`,
  `WORDLY_MCP_GRANT_FILE`. `OPENAI_API_KEY` is deliberately ignored;
  `OPENAI_CUSTOM_HEADERS` blocks the assistant.
- Cookies: `wordly-theme`, `wordly-text`, `wordly-nav`, `wordly-project`,
  `wordly-layout`, `wordly-spelling`, `wordly-spellchecker`. Local storage:
  `wordly.assistant.contextPanel`.
- Files: `mcp/grant.json`, `backups/`, `.env`; `next.config.ts` server-action
  body limit `50mb`.
- Stored identifiers: ID prefixes `wsp_ prj_ rec_ rev_ pkg_ src_ aud_ rvw_ imp_
  bat_ asc_ asm_ aci_ apr_ prf_ dic_ lnk_ img_ trb_` (external IDs must match
  `src/domain/ids.ts` patterns); record types, canon statuses, source kinds,
  review origins and audit action names are stored as strings
  (`src/domain/recordTypes.ts`, `src/domain/statuses.ts`).

## What the upgraded app must read

1. The working SQLite database at all 10 migrations, migrated in place by
   `pnpm db:deploy` (backs up first), keeping every record ID, revision
   number, revision snapshot and `contentHash`, source, applied package,
   audit entry, review item, imported file, link, image, dictionary entry,
   Trash state, parent and position, and the assistant tables.
2. Every `wordly.workspace-backup` v1 shape listed above, including
   `app.name: "wordly-editor"` and the existing checksum algorithm. A new
   backup format needs a new `formatVersion`; unsupported versions must be
   refused before writing.
3. `wordly.change-package` v1 by content, not filename, with the same stale
   revision, protection, scope, atomic apply and per-project idempotency
   rules, so packages already in circulation (built from context bundles)
   either apply as before, report `already_applied`, or are refused.
4. `wordly.dictionary` v1 files, `mcp/grant.json`, the environment keys, and
   the routes above (or redirects from them).

The frozen fixture in `tests/fixtures/legacy/` (invented content, written once
by this code with `generate.ts`) is the executable form of this contract.
`tests/acceptance/legacy-baseline.test.ts` restores it with original IDs and
requires an inventory identical to `expected-inventory.json`, exact prose for
current and earlier revisions, provenance, links, image bytes, imported
files and Trash; a remapped copy that keeps package identity; refusal of a
reference-scope edit to protected prose, of an unconfirmed manuscript-scope
override and of a UI edit without unlock; `STALE_REVISION` for a stale
package; `already_applied` for the applied package and a reformatted copy;
`PACKAGE_ID_CONFLICT` for a reused ID; refusal of package v2, backup v2 and
backups from a newer schema; and restore of the earliest v1 shape. Never
regenerate the fixture to make a later version pass. If the schema changes,
update the column mapping in `src/server/inventory.ts`, not the expected files.

## Before-upgrade inventory (author's database)

Taken from the baseline snapshot (the author was working during this pass, so
the live file may already differ). Hashes only; the files stay in the
git-ignored backup folder.

| Item | Count |
| --- | --- |
| Workspaces / projects | 2 / 2 (author project plus the demo project) |
| Records (in Trash) | 110 (24) |
| Protected records | 62 |
| Revisions (invalid hashes) | 282 (0) |
| Records whose current state differs from the latest revision | 0 |
| Chapters in book order / scenes | 27 / 0 |
| Reference links / images | 4 / 0 |
| Applied change packages (all v1, `applied`) | 55 |
| Imported files | 70 |
| Dictionary entries | 25 |
| Review items open / resolved | 4 / 76 |
| Sources / audit entries | 224 / 434 |
| Assistant conversations / messages / context items / proposals / proofread runs (SQLite only) | 42 / 184 / 164 / 8 / 0 |

`pnpm db:verify-backup` restored both workspace files into
`restore-check.db`: no differences from the snapshot in records, text hashes,
revisions, links, images, book order, packages or imports. `PRAGMA
integrity_check` is `ok` and there are no foreign-key violations in either file.

After migrating, compare against an inventory taken immediately before the
migration (not only this baseline):

```bash
pnpm db:backup --label pre-storyloom
pnpm db:verify-backup backups/<that folder>
# migrate with pnpm db:deploy, then:
pnpm db:inventory --database prisma/dev.db --out backups/<that folder>/inventory-after.json
pnpm db:inventory --compare backups/<that folder>/inventory-snapshot.json backups/<that folder>/inventory-after.json
```

Expected after a correct migration: new migrations listed as added, no other
differences (or only differences the migration documents).

## Rolling back

Code: return to the commit that matches the database's migrations. The
commit containing this pass is tagged `wordly-pre-storyloom` (same migrations
as `28d6fd2`). To roll back: `git switch --detach wordly-pre-storyloom` and
`pnpm install --frozen-lockfile` (regenerates the Prisma client).

Database:

1. Stop `pnpm dev` / `pnpm start` and any `pnpm mcp:stdio` process.
2. Move the migrated `prisma/dev.db` (and any `-journal` file) aside into a
   new folder under `backups/`; do not delete it.
3. Copy the snapshot taken immediately before the migration
   (`backups/<timestamp>-pre-migrate/dev.db` written by `pnpm db:deploy`, or
   the `pre-storyloom` backup above) to `prisma/dev.db`.
4. `pnpm db:info` must list exactly the 10 migrations above.
5. `pnpm db:inventory --database prisma/dev.db --out <file>` and
   `pnpm db:inventory --compare <folder>/inventory-snapshot.json <file>` must
   report no differences.
6. Start the app.

Limits: work done after the snapshot is not in it. Backups written by the
upgraded app list newer migrations, so this code refuses to restore them; a
downgrade path for post-upgrade edits would have to be built explicitly.
Workspace JSON backups do not carry assistant history, so roll back from the
SQLite snapshot, not from JSON files, when that history matters.

## Findings in this pass

- `prisma/dev.db.example` was tracked in git (added in `28d6fd2`, present on
  `origin/main`). It is an older copy of the author's database, not demo data:
  the author's workspace and project IDs, 57 records, 43 imported files and
  28 assistant conversations. At the author's request it is no longer tracked
  (the local file is kept) and `.gitignore` now also covers `*.db.*`. It
  remains in history and on the remote; removing it from there would need a
  history rewrite, which was not requested.
- On this Windows checkout several tracked text files are CRLF in the working
  tree although the index and `.gitattributes` say LF. One of them,
  `tests/fixtures/markdown/Saltmarsh_Annals_Series_Guide_CURRENT.md`, made 3
  assistant section tests fail. It was rewritten byte-identical to the
  committed blob, after which all tests pass. Section parsing on CRLF text
  was not investigated further.
