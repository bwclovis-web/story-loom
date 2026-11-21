# Story Loom

A local, authoritative store for a novel's project state: manuscript chapters
and scenes, outlines, character dossiers, worldbuilding, canon decisions, and continuity
notes. Each record is revisioned, and every revision carries provenance.

Creative work happens in ChatGPT. Approved decisions come back as versioned
**change packages**. These are bounded, validated JSON change sets that apply
atomically and only once, and they never touch protected manuscript prose
unless that is explicitly authorized. Conversation suggestions never become
canon on their own.

## Setup

Requires Node 24+ and pnpm 10+.

```bash
cp .env.example .env  # DATABASE_URL="file:./prisma/dev.db"
pnpm install          # also generates the Prisma client
pnpm db:setup         # back up (if a DB exists), apply migrations, generate client, seed the demo project
pnpm dev              # http://127.0.0.1:2112 (bound to localhost only)
```

`pnpm dev` and `pnpm start` listen on port 2112. If that port is taken, the
process exits and prints the error instead of moving to another port. Browser
cookies (navigation and panel layout) are shared between ports on 127.0.0.1,
so a layout saved on another port still applies. Next.js allows one dev server
per folder: if one is already running, it prints that server's address and PID
and exits. Use the running server, or stop it (Ctrl+C in its terminal) and
start again.

`pnpm db:setup` is safe to re-run. It never deletes data, and the demo seed
skips itself if the demo workspace already exists.

### Optional assistant

The **Assistant** page in each project discusses records or a manuscript
passage you select with an OpenAI model. It is off by default. Discussion never
changes records; on request it prepares a change proposal for reference
records, which you review in the usual diff preview and apply yourself.
The same setup enables **AI proofreading** (spelling, grammar, punctuation)
on record pages: you accept or dismiss each suggestion in the text box and
save as usual. To turn it on, set `WORDLY_OPENAI_API_KEY` and `OPENAI_MODEL` (a text model your API
project can use with the Responses API) in `.env`, then restart `pnpm dev`.
The app uses only its own key: a shared `OPENAI_API_KEY` (for example one set
for the whole computer) is ignored, and the assistant stays off until
`WORDLY_OPENAI_API_KEY` is set. If your `.env` has an `OPENAI_API_KEY=` line from
an earlier version, rename it.
Keep the key only in `.env`; never use a `NEXT_PUBLIC_` variable for it.
Selected content is sent to OpenAI. Request settings, retention, limits, the
usage cap and a manual connection test are in
[docs/assistant.md](docs/assistant.md).

### Spelling and the project dictionary

Record text is spell-checked locally (no network, no AI) with Hunspell
English word lists and the author's dictionary of invented names and terms,
kept per project or per workspace (series). Manage it on each project's
**Dictionary** page. Design, data format and the word-list licences are in
[docs/spelling.md](docs/spelling.md).

### Images and PDF export

Reference documents (not chapters or scenes) can hold images: PNG, JPEG, GIF
or WebP, up to 10 MB each and 100 per document. They are stored in the
database, shown in a gallery on the document page, can be placed in the text
with `![description](image:name)`, and are included in backups. Adding one
creates no revision; every image change is in the audit log. After pulling
this change, run `pnpm db:deploy` (it backs up first) to add the image table.

**Export PDF** (in project tools and on the World page) and **Download PDF**
(on a document's page) download a file made on this computer from saved versions.
The manuscript can be PDF, DOCX, or EPUB. A compile profile sets front matter,
trim size, margins, running header and footer, font and spacing, a contents
page, back matter, and which chapters and scenes to leave out. Selected
reference documents can be PDF, DOCX, EPUB, or a Markdown zip. PNG and JPEG
images are embedded in PDFs; other formats are listed by name. The file is
not stored by the app.

### Deleting and the Trash

Documents, chapters, scenes, notes, projects and workspaces are never deleted
in one step. **Move to Trash** (at the end of a document's page, and beside
each project and workspace on the Workspaces page) hides the item everywhere:
lists, search, exports, PDF, the assistant, change packages and the MCP
adapter. Nothing is removed and the move is in the audit log. A chapter or
scene takes everything inside it along, and protected chapters and scenes need
the protection tick box.

The **Trash** page (left navigation) restores items exactly as they were, or
deletes them permanently. **Delete permanently** and **Empty Trash** first
write a full backup to `backups/<timestamp>-before-permanent-delete/` (the
same contents as `pnpm db:backup`) and delete nothing if that fails. A
document another document's "superseded by" points to cannot be deleted until
that link is changed. After pulling this change, run `pnpm db:deploy` (it
backs up first) to add the Trash columns.

### Series bibles, status tags and cross-references

Reference documents written as a series bible work as they are:

- **Status tags in headings** such as `## Rules [APPROVED FRAMEWORK]` or
  `### Scene — SELECTED; after the storm` are shown word for word in the
  document's Contents. The assistant, context exports and the MCP adapter are
  told that these markings govern their own sections. The record's own canon
  status is still set only by the author.
- **Cross-references.** Backticked filenames such as
  `Harbour_Guide_APPROVED_WORKING_v1.4.md` link to the document imported from
  any version of that file. IDs such as `SA-WORLD-001` link to the heading,
  bold list item or register-table row that defines them, or to a record
  given that ID in its structured fields (`{"refIds": ["SA-B1-C01"]}`). A
  **Cross-references** panel lists mentions and "mentioned by", and warns
  when a link leads to a superseded or draft document (naming the
  replacement). All of this is computed when a page opens; nothing is stored.
- **Characters and places in chapters.** Character dossiers and
  worldbuilding records are found by name in chapter and scene text (title
  up to a dash, colon or bracket; without a leading "The"; `aliases` from
  structured fields; a character's unambiguous first and last name). Chapters
  list who and what they name; dossiers list the chapters that name them.
- **Cross-reference check** (Project tools) lists, for the whole project,
  IDs nothing defines, filenames never imported, IDs defined in more than
  one document, mentions of superseded or draft documents, and how often
  each character and place is named.
- **New versions.** Importing `..._v1.5.md` after `..._v1.4.md` flags the
  existing record as "same document, another version"; the author chooses
  replace (a new revision), create, or skip.
- **Long documents.** The assistant can send chosen sections by heading
  instead of a whole document, and the MCP adapter has `list_sections` and
  `get_section`. Sections are never shortened.
- **Chapters from files.** On a chapter or scene, **More actions → Load text
  from file...** fills the editor from a `.md`/`.txt` file. Nothing is saved
  until **Save**.

### Book order and manuscript search

- **Book order** on the Write page moves chapters up and down, scenes within
  a chapter, and a scene (with its notes) into another chapter. The manuscript
  panel, Read the book and PDF export follow it. A move changes no text, makes
  no revision and needs no protection tick; each one is in the audit log, and
  backups keep the order (`Record.position`, migration
  `20261026210000_book_order`).
- **Manuscript search** (top of the Write page, or Enter in the manuscript
  panel's search box) lists every literal match in chapter, scene and scene
  note titles and saved text, in book order, with up to three highlighted
  excerpts each. **Open with Find** opens a chapter or scene with Find filled
  in and the first match selected. It only reads.

### Help

For step-by-step instructions written for authors, choose **How to use** in
the app's left navigation (`/help`). Its text lives in `src/help/`; keep it in step
with the interface (see [PROJECT_RULES.md](PROJECT_RULES.md)).

### Where the database lives

`DATABASE_URL` in `.env` names the SQLite file. Relative paths resolve from
the project root, and the app, the Prisma CLI, and every `db:*` script open the
same file (`src/server/dbLocation.ts`). Run `pnpm db:info` to print the
resolved path, applied migrations, and row counts. It is read-only.

### Database scripts

| Command | Effect on your data |
| --- | --- |
| `pnpm db:info` | Read-only. Shows the database path, migrations, and counts. |
| `pnpm db:backup [--label name]` | Read-only. Writes `backups/<timestamp>/` containing a SQLite snapshot plus one `*.wordly-backup.json` per workspace. |
| `pnpm db:deploy` | Backs up, then applies pending migrations. Use this after pulling schema changes. |
| `pnpm db:restore <file> --dry-run` | Read-only. Validates a backup and summarizes it. |
| `pnpm db:restore <file> --new-database <path>` | Creates a new SQLite file (refuses if it exists) and restores with the original IDs. |
| `pnpm db:restore <file> --into-current` | Backs up, then adds the backup as a new workspace with new IDs. Existing workspaces are untouched. |
| `pnpm db:verify-backup backups/<dir>` | Leaves your database alone. Restores every workspace file in a backup folder into `<dir>/restore-check.db` with the original IDs and checks it against the folder's SQLite snapshot. |
| `pnpm db:inventory [--database <file>] [--out <file>]` | Read-only. Writes an inventory of records, revision hashes, links, images, book order and package history (hashes, no text). `--compare <before> <after>` lists differences, for checking a migration or restore. |
| `pnpm db:seed` | Adds the demo project if missing. |
| `pnpm db:reset --confirm-delete-all-data [--seed]` | **Destructive.** Backs up, deletes the database file, and recreates an empty schema. Without the flag it only explains what it would do. |
| `pnpm db:migrate:dev` | Developer only: creates a migration after editing `prisma/schema.prisma`. Backs up first. If Prisma offers to reset the database, answer **no**. |

Never run `prisma migrate reset` against your working database. `backups/` is
git-ignored. Copy important backups somewhere outside the repository too.

**Optional mirror folder:** On **Backup & restore**, set **Also copy full backups to a
folder**, or set `WORDLY_BACKUP_MIRROR_DIR` in `.env`, so each full backup is
copied into a timestamped subfolder (for example under Dropbox). Sync backup
folders only—not the live `.db` file—and do not run two app instances against the
same database. See [docs/backup-sync.md](docs/backup-sync.md).

### Backup and restore, safely

1. Back up: `pnpm db:backup --label before-trial`, or use **Backup & restore**
   in the app to download a single workspace.
2. Check the backup: `pnpm db:restore backups/<dir>/<workspace>.wordly-backup.json --dry-run`.
3. Prove it restores without touching your data:
   `pnpm db:restore <file> --new-database ../wordly-restore-check.db`, then
   `DATABASE_URL="file:../wordly-restore-check.db" pnpm db:info`.
4. To work from a restored copy, either restore it as a new workspace (app or
   `--into-current`), or point `DATABASE_URL` at the restored file and restart the app.
5. To return to a raw snapshot, stop the app, copy your current `prisma/dev.db`
   aside, copy `backups/<dir>/dev.db` into place, and start the app.

Format and validation details: [docs/backup-format.md](docs/backup-format.md).
Before a schema upgrade, follow [docs/upgrade-baseline.md](docs/upgrade-baseline.md):
what must stay readable, the before/after inventory, and how to roll back.

Other scripts: `pnpm test` (Vitest), `pnpm typecheck`, `pnpm build && pnpm start`,
`pnpm schema:export` (regenerate `docs/schemas/change-package.v1.schema.json`).

### Rules for contributors and agents

`AGENTS.md` starts with a block that `next dev` writes and rewrites, between
`<!-- BEGIN:nextjs-agent-rules -->` and `<!-- END:nextjs-agent-rules -->`
(see `node_modules/next/dist/server/lib/generate-agent-files.js`). Next
replaces only that block. Persistent project rules live in
[PROJECT_RULES.md](PROJECT_RULES.md), which no tool generates. `AGENTS.md` links
to it from below the managed block, where the link survives regeneration.

### Demo data

`pnpm db:seed` creates the project **The Salt Archive** (`prj_demo_salt_archive`)
with fixed record IDs. It includes a protected manuscript chapter, a dossier
for Mara Venn, worldbuilding, an outline, and an unresolved canon decision.
[`examples/sample-change-package.json`](examples/sample-change-package.json)
applies cleanly to a freshly seeded database. Import it on the project's
**Import change package** page to see the preview, the apply step, and the
"already applied" behavior.

## Workflow

0. **Import references (optional).** On **Import Markdown references**,
   select `.md` files. The preview writes nothing. For every file you choose
   the document type (reference types only), canon status, and protection;
   none are preselected or inferred from filenames. For each file that looks
   like an existing record (same content, title, previously imported
   filename, or another version of a previously imported file) you choose
   create new, replace (as a new revision), or skip. The
   batch applies in one transaction. Each file's original name and exact
   content are stored with its revision provenance.
   Chapter files go through **Import chapters** instead: each `.md`,
   `.markdown` or `.txt` file becomes a protected draft chapter, created in
   the order of the number its filename starts with. A file matching an
   existing chapter (same filename, another version, same title or same text)
   needs a choice: new chapter, replace that chapter's text as a new revision
   (with the protection confirmation), or skip. "Tidy the text as it is
   imported" (on by default) cleans paragraph spacing, headings, scene breaks,
   quotes, dashes and ellipses; the original file is kept unchanged. The same
   **Tidy text** is in the writing page's More actions. **Read the book** shows
   every chapter and scene in order on one page, with an Edit link on each.
   The **Aa** button (writing page, Read the book, reference pages) sets the
   font, size, line spacing and line width of text in this browser. The
   theme button at the bottom of the left column switches between Light,
   Dark and Match system.
1. **Export context.** Select records and download a
   [context bundle](docs/context-bundle-format.md) containing IDs, current
   revisions, types, statuses, protection flags, and package instructions.
2. **Work in ChatGPT** with that bundle. When decisions are settled, ask for a change package.
3. **Import change package.** The app validates the whole package and opens
   the review screen: the records in the package, a before/after comparison
   for the selected record, and a summary of manuscript impact, protection,
   revision checks and potentially affected records (listed, not changed).
   Then you apply it; the package is applied as a whole or not at all.
   Assistant proposals use the same screen.
4. **History & review.** View the audit log, applied packages, and open
   review items for records that may need follow-up.

### In the app

Guided tasks (skip anytime; stored only in this browser) follow the same order:

1. Write a chapter in Desk, Focus, or Companion. Split view can show another draft beside it. An unsaved local copy is offered after a reload and is not a revision.
2. Keep a reference handy, or type `[[` or `@` to insert its title.
3. Start a Weave grid from a premade beat sheet. Create a scene from a beat when you want a protected scene and a synopsis; the scene body stays empty.
4. Add World references, including a custom kind whose fields you can remember for that book. Boards and maps place records you already have.
5. Set an in-world calendar and read the story timeline. Ages and warnings are notes, not saved facts.
6. Read a series reference in a sibling book, and edit it in the book that owns it. Continuity lists open questions.
7. Set a writing goal, compile PDF, DOCX, or EPUB, and back up the workspace.

Details: [docs/world-and-weave.md](docs/world-and-weave.md) and **How to use** in the app.

### Screenshots

Pictures of earlier interface passes are in `docs/screenshots/`. They are not regenerated for every feature.

| File | What it shows |
| --- | --- |
| `discover-1-continue-writing.png` | Opening a chapter to keep writing |
| `discover-2-keep-beside.png` | A reference kept beside the draft |
| `discover-3-board-chooser.png` | Choosing a board |
| `discover-4-map-pin.png` | A pin on a map |
| `discover-5-weave-beat.png` | A Weave beat |
| `discover-6-assistant-narrow.png` | The assistant on a narrow window |
| `redesign-1-write-references.png` | Write, with references |
| `redesign-2-write-focus-mode.png` | Focus mode |
| `redesign-3-world-reference.png` | A World reference |
| `pdf-1-export-page.png` | The export page |
| `world-hub-light.png` | The World page |

## Concepts (kept separate)

| Concept | Where |
| --- | --- |
| Document type | `Record.type` (manuscript chapter, outline, dossier, ...) |
| Canon/decision status | `Record.authorityStatus`: draft, proposed, approved, superseded, unresolved |
| Revision history | Immutable `Revision` rows; `Record.currentRevision` |
| Source/provenance | `Source` row per change batch (UI / change package / Markdown import / future API), with conversation label, URL, and original filename; `ImportedFile` keeps each imported file verbatim |
| Manuscript protection | `Record.protected` flag plus the manuscript/reference content class |
| Manuscript structure | `Record.parentRecordId` (scene in a chapter; scene note on a chapter or scene); `RecordLink` (chapter or scene to a reference record) |

## Architecture

```
src/domain/            types, enums, IDs, issue codes (no I/O)
src/changePackage/     v1 Zod schema, JSON Schema, parser, diff helpers
src/backup/            wordly.workspace-backup v1 schema
src/writing/           word counting, literal find/replace, spelling preferences,
                       Markdown formatting commands for the toolbar, and a safe Markdown
                       reader for display (markdownParse; no HTML passes through), sections by
                       heading with status tags (sections), filename/ID cross-references
                       (crossRefs), and the chapter tidy-up (tidy) (pure, shared)
src/spelling/          spell-check tokens, author's dictionary matching, import/export format,
                       browser worker (typo-js); see docs/spelling.md
src/proofread/         proofreading prompt, output schema, suggestion anchoring and
                       editor-side apply/stale/undo logic (pure, shared)
src/assistant/         assistant config, prompt building and size checks, provider interface,
                       proposal output schema, field/text checks, canon rules (pure)
src/images/            image format detection from file bytes, names, limits, and the
                       image:name text reference (pure, shared)
src/server/openai/     OpenAI Responses API adapter (server-only; the only code that uses the key)
src/server/pdf/        PDFKit drawing helpers for the Markdown blocks, tables and images in a PDF
src/server/backupFiles.ts  full backup to backups/ (SQLite snapshot plus a JSON file per
                       workspace), shared by the db:* scripts and permanent deletion
src/server/services/   mutationService (the only writer of records/revisions),
                       protection guards, recordService (UI), changePackageService
                       (validate/preview/apply), markdownImportService (preview/apply),
                       chapterImportService (chapter files to manuscript chapters; preview/apply),
                       grantSettingsService (reads and writes the MCP grant file for Connections),
                       backupService (create/validate/restore), impactService,
                       contextExportService, auditService, reviewService, projectService,
                       wordCountService, assistantService (conversations; never writes records),
                       assistantProposalService (assembles proposals; applies via changePackageService),
                       proofreadService (proofreading runs; never writes records),
                       dictionaryService (author's dictionary; never writes records),
                       linkService (chapter/scene reference links; audited, no revisions),
                       imageService (images on reference documents; audited, no revisions),
                       pdfExportService (manuscript and reference PDFs; read-only),
                       trashService (projects and workspaces to and from the Trash, the Trash
                       listing, and permanent deletion after a full backup; records move
                       through mutationService), trashFilters (the "not in the Trash" filters
                       every read uses),
                       searchService (title, text and field search), crossRefService (builds the
                       cross-reference index from live records; read-only); read-only lookups for
                       the reference page: linking chapters, open review items, unapplied
                       proposals, imported source files
src/help/              in-app "How to use" content and outline
src/ui/                labels, record groups for Write/Plan/World, active-route mapping,
                       text appearance choices and their CSS variables (textAppearance.ts),
                       colour theme preference (theme.ts; colours are light-dark() tokens in
                       globals.css),
                       manuscript tree (chapters with their scenes, title filter),
                       World categories and counts (world.ts), and the review screen's
                       record list, summary, diff segments and apply state (packageReview.ts)
src/components/        shared client components, including the editor's writing tools,
                       formatting toolbar and MarkdownView (renders markdownParse output);
                       shell/ holds the global navigation, project menu, drawers, manuscript
                       tree, World navigation, panel resizers and the unsaved-changes guard;
                       review/ holds the change review screen used by package import and
                       assistant proposals
src/app/               Next.js pages and server actions (thin; call services only);
                       (site)/ holds the pages outside a project (workspaces, backups, help);
                       records/[recordId]/ReferenceView renders every non-manuscript record;
                       assistant/proposals/[proposalId] reviews and applies one proposal
scripts/               db:* scripts (info, backup, restore, deploy, reset) and schema export
tests/acceptance/      end-to-end service tests, including the ChatGPT round trip
tests/fixtures/        invented Markdown reference files
```

Backup restore is the one write path that does not use `mutationService`,
because it copies stored history (revisions, provenance, audit) exactly as it was.
Permanent deletion from the Trash is the only path that removes rows; it
deletes each table's rows explicitly in one transaction after a full backup.

The UI and the change-package importer go through `mutationService.applyMutations`.
The local MCP adapter is read-only and does not write. Any future write path
must use the same function, so revision checks, scope and protection guards,
provenance, and audit stay in one place.

## Scope

Status, check results, the first real-reference trial steps, and known gaps
are in [PROGRESS.md](PROGRESS.md).

- Local only. There is no authentication, no remote access, and no ChatGPT
  connection. A read-only stdio adapter can list and read granted projects on
  this computer; it does not save changes and ChatGPT cannot reach it. See
  [docs/future-chatgpt-connection.md](docs/future-chatgpt-connection.md).
  The optional assistant calls the OpenAI API with selected content only.
  Its change proposals are applied only through the change-package pipeline
  after the author's explicit Apply.
- Prisma is pinned to 7.10.x (the stable driver-adapter setup); `latest` on npm is an 8.0 release candidate.
