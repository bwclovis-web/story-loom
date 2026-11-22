# Workspace backup format (`wordly.workspace-backup`, v1)

A complete copy of one workspace, produced by **Backup & restore** in the app,
`GET /backup/<workspaceId>`, or `pnpm db:backup`. Schema:
[`src/backup/format.v1.ts`](../src/backup/format.v1.ts).

## Contents

| Field | What it preserves |
| --- | --- |
| `workspace`, `projects` | IDs, names, creation times, and `trashedAt` when it is in the Trash (optional; absent means not in the Trash). Optional Series/Book/Draft fields on a project (`seriesName`, `bookName`, `draftKind`, `assignmentRevision`) are written only when set; older backups omit them and restore as unassigned. Optional `defaultReadingDraftId` / `defaultExportDraftId` point at manuscript drafts; omitted when unset |
| `manuscriptGroups` | Named chapter groups for optional manuscript assignments: `id`, `projectId`, `label`, `position`, `draftKind`, `createdAt`. Optional: backups made before assignments existed omit it and restore with no groups |
| `manuscriptDrafts` | Same-project Zero draft / Author manuscript trees: `id`, `projectId`, `kind`, `label`, `completedAt`, `createdAt`. Optional: older backups omit it and restore with no drafts (legacy single manuscript) |
| `records` | Current content, type, canon status (`authorityStatus`), superseded-by link, protection flag, current revision, and `parentRecordId` (the chapter of a scene, or the chapter or scene of a scene note; optional, and treated as none in backups made before scenes existed), and `position` (book order of a chapter or scene the author has moved; omitted otherwise, and such records follow positioned ones in creation order), and optional `groupId` / `worldScope` (Series/Book/Draft assignments; omitted when unassigned), and optional `draftId` (manuscript draft; omitted when unassigned). A record in the Trash also has `trashedAt` and `trashBatchId` (the records moved together, restored together); both are omitted otherwise |
| `revisions` | Every revision's full snapshot, content hash, and the provenance source that created it |
| `sources` | Provenance: kind (ui / change_package / markdown_import), actor, conversation label, URL, package ID, original filename |
| `changePackages` | Applied package identity: (`projectId`, `packageId`), content hash, the exact raw JSON, and the stored result |
| `auditEntries` | The full audit log with details JSON verbatim |
| `reviewItems` | Open and resolved review items, including what triggered them |
| `importedFiles` | Each imported Markdown file's original name, exact content, hash, and which record revision it produced |
| `dictionaryEntries` | The author's dictionary: word, match-case flag, note, origin, and `projectId` (null for a workspace-wide word). Optional: backups made before the dictionary existed omit it and restore with an empty dictionary |
| `recordLinks` | Reference links from a chapter or scene to a reference record: `id`, `projectId`, `fromRecordId`, `toRecordId`, `createdAt`. Optional: backups made before scenes existed omit it and restore with no links |
| `rewriteSourceLinks` | Author-rewrite pins from a blank rewrite chapter/scene to an exact Zero-draft revision: `id`, `projectId`, `fromRecordId`, `toRecordId`, `toRevisionNumber`, `position`, `createdAt`. Optional: older backups omit it and restore with no pins |
| `readingPins` | Ordered reading pins for references beside prose: `id`, `projectId`, `scopeDraftId` (draft id, or `""` for legacy project-level), `recordId`, `position`, `createdAt`. Optional: older backups omit it and restore with an empty list. Pin/unpin never creates or removes `recordLinks` |
| `worldKindTemplates` | Custom field definitions for a worldbuilding kind name: `id`, `projectId`, `kind`, `fields` (`key`, `label`, optional `multiline`). Optional: older backups omit it and restore with no templates. These are not records |
| `continuitySuppressions` | Continuity Ledger Mark intentional / Ignore rows: `id`, `projectId`, `issueKey`, `reason` (`intentional` \| `ignored`), optional `note` / `actor`, `createdAt`. Optional: older backups omit → none. Does not change manuscript text |
| `compileProfiles` | One manuscript compile profile per project: front matter (`titlePageBody`, `copyrightPageBody`, `dedicationBody`, `acknowledgementsBody`), `sceneBreakGlyph`, `chapterHeadingStyle`, `includeSynopses`, `includeMarginComments`. Optional layout keys: `trimSize` (`5x8`, `5.5x8.5`, `6x9`, `A4`, `Letter`), `marginInches` (0.5–1.25), `runningHeader`, `runningFooter`, `fontPreset` (`serif`, `sans`, `mono`), `spacingPreset` (`novel`, `tight`, `loose`), `firstParagraphNoIndent`, `dropCap`, `includeToc`, `backMatterBody`, `excludedRecordIds`. Older backups omit the layout keys and restore with the defaults (6×9 in, 0.75 in margins, serif, novel spacing, contents on, drop cap off, nothing excluded). A backup that includes those keys will not restore on an older app that rejects unknown keys. Excluding a record leaves it out of PDF, DOCX, and EPUB only |
| `boards` | World boards: `id`, `projectId`, `title`, `templateKey` (`blank` \| `geography`), `createdAt`, `updatedAt`. Optional: older backups omit → no boards |
| `boardCards` | Cards on boards: `id`, `boardId`, `projectId`, `kind` (`record` \| `image` \| `note`), optional `recordId` / `imageId`, `noteTitle`, `noteBody`, `x`, `y`, `width`, `height`, `zIndex`, `createdAt`. Optional: older backups omit → empty. Removing a card only removes this row |
| `weaveGrids` | Plan Weave canvases: `id`, `projectId`, `title`, `viewKind`, optional `layoutMode` (`freeform` \| `plot_grid`; omitted → freeform), `sourceTemplateId`, `createdAt`, `updatedAt`. Optional: older backups omit → no Weave |
| `weaveThreads` | Story-thread columns for plot-grid layout: `id`, `gridId`, `projectId`, `title`, `position`, `createdAt`. Optional: older backups omit → no threads |
| `weaveBeats` | Beats on a grid: title, body, decision, optional `manuscriptRecordId`, optional `threadId` / `cellOrder` (plot-grid cell; omitted → unthreaded / 0), freeform `x`/`y`/`width`/`height`/`zIndex`. Optional. Linking a beat never changes manuscript book order |
| `weaveBeatWorldRefs`, `weaveSetupPayoffs`, `weaveTemplates`, `weaveTemplateBeats` | World citations on beats, setup→payoff links, and editable beat templates. Optional: older backups omit → empty |
| `recordImages` | Images on reference documents: `id`, `projectId`, `recordId`, `name` (unique within the record; the text refers to it as `image:<name>`), `originalFilename`, `mimeType` (PNG, JPEG, GIF or WebP), `byteSize`, `width`, `height`, `contentHash` (sha256 of the file), `dataBase64` (the file itself), `caption`, `altText`, `position`, `createdAt`, `updatedAt`. Optional: backups made before images existed omit it and restore with no images |
| `assistantConversations` | In-app assistant threads: `id`, `workspaceId`, `projectId`, `title`, optional `summary`, `createdAt`, `updatedAt`. Optional: older backups omit → none |
| `assistantMessages` | Messages in those threads (role, mode, content, status, usage, included message ids, timestamps). Optional |
| `assistantContextItems` | Record/passage/section snapshots sent with a message. Optional |
| `assistantProposals` | Prepared change proposals tied to assistant messages. Optional |
| `projectAssistantSettings` | Per-project prefs (`autoIncludeRecent`, `recentContextBudgetChars`). Optional: omit → defaults. Proofread runs are not in the backup file |
| `counts`, `checksum` | Row counts (optional arrays as above), and a sha256 over the stable serialization of every other field |
| `app.migrations` | Schema migrations known to the app that wrote the file |

Other connections between records are stored inside records
(`supersededByRecordId`) and fields (`aliases`, any JSON). They are part of each
record and revision and are restored with them. `parentRecordId` is set when a
scene or scene note is created, changes only when the author moves a scene to
another chapter, and is not part of revisions; neither is `position`. Moves are
recorded in the audit log. Reference links
have no revisions; adding or removing one is recorded in the audit log. Images
have no revisions either: adding, captioning or removing one is recorded in the
audit log, and older revisions that show a removed image say it is not found.
Image files make a backup larger, roughly four thirds of their stored size.

## Validation before any write

A restore checks the whole file first and writes nothing if any check fails:

- format and version; schema of every row; checksum; declared counts;
- unique IDs; every reference resolves within the backup (project, record, source, superseded-by, parent, link ends, image record);
- every scene has a chapter as parent, every scene note has a chapter or scene in the same project, and every
  reference link goes from a chapter or scene to a reference record, with no pair repeated;
- every record has revisions 1..current with no gaps, each revision matches its
  content hash, and each record's current content equals its latest revision;
- each package's raw JSON still hashes to its stored content hash; each imported file matches its hash;
- each dictionary entry belongs to the backed-up workspace, names a project in the backup (or none), and is a single valid word;
- each image belongs to a reference record (not a chapter or scene) in the same project, has a name unique within
  that record, and its decoded data matches its size, its hash and the format it claims;
- a record with a `trashBatchId` also has `trashedAt`;
- the backup was not written by a newer schema than this app;
- when preserving IDs, none of them already exist in the target database.

## Restore modes

| Mode | Where | IDs | Use |
| --- | --- | --- | --- |
| Separate database | `pnpm db:restore <file> --new-database <path>` | Preserved exactly | Verify a backup, or recover onto a fresh file |
| New workspace | App: **Backup & restore**, or `pnpm db:restore <file> --into-current` | All new | Inspect an old state beside current work |

Both run in a single transaction. If anything fails, nothing is written. In
new-workspace mode, IDs inside stored result and audit JSON are rewritten to
the new IDs. Raw package JSON and its hash are kept verbatim, so applied
packages are still recognized (`already_applied`) in the restored copy. A
`workspace.restore` audit entry records the backup checksum and the ID mapping.

Projects and records in the Trash stay in the Trash after a restore. In
new-workspace mode the restored workspace itself is never in the Trash, even if
the backup was taken while it was. Because the Trash fields are written only
when set, a backup of a workspace with nothing in the Trash is identical to one
made before the Trash existed.
