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
| `recordImages` | Images on reference documents: `id`, `projectId`, `recordId`, `name` (unique within the record; the text refers to it as `image:<name>`), `originalFilename`, `mimeType` (PNG, JPEG, GIF or WebP), `byteSize`, `width`, `height`, `contentHash` (sha256 of the file), `dataBase64` (the file itself), `caption`, `altText`, `position`, `createdAt`, `updatedAt`. Optional: backups made before images existed omit it and restore with no images |
| `counts`, `checksum` | Row counts (`dictionaryEntries`, `recordLinks`, `recordImages`, `manuscriptGroups`, `manuscriptDrafts` and `rewriteSourceLinks` optional, as above), and a sha256 over the stable serialization of every other field |
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
