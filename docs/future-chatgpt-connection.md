# ChatGPT connection (MCP): assessment and implementation plan

> **Status: local read-only adapter implemented. ChatGPT is not connected.**
> The app still listens on `127.0.0.1` only and has no authentication. The
> adapter (`pnpm mcp:stdio`) speaks MCP over standard input and output. It
> does not listen on a port. It reads only the projects named in a local grant,
> manuscript access is off unless that grant allows it, and it cannot save
> changes. No tunnel has been created, the app has not been exposed, and this
> has not been tested against a ChatGPT account.
>
> Official pages were checked again on Oct 26, 2026. They still disagree about
> personal-plan write access. The account checks below are for the author.
> Do not buy a plan, create a tunnel, or change a subscription until those
> checks are done.

## Goal

The author keeps working in ChatGPT. When decisions are settled, ChatGPT should:

1. Search and read the relevant current records.
2. Prepare a bounded change set.
3. Show a preview of exactly what would change.
4. Apply that change set only after the author's explicit approval.
5. Preserve revisions, provenance, protection and audit history.
6. Report what changed, with revision numbers.

Today this runs by hand: export a [context bundle](context-bundle-format.md),
bring back a [change package](change-package-format.md), and import it.
That import page is the trusted approval step: it previews the changes and
applies them together. The local adapter does not replace it.

## What is implemented

Local only. Checked with an isolated database and invented records (237 tests
in the suite, including the adapter tests). The author's database was not
reset or written by this work.

- Read tools: `list_projects`, `search_references`, `get_records`,
  `list_revisions`, `get_revision`, `list_sections`, `get_section`,
  `review_history`. Every call reloads the
  grant and checks read permission and project membership. Manuscript chapters
  are refused unless `manuscriptRead` is true. Search excerpts say when they
  are shorter than the source. Oversized reads are refused with each record's
  size. Pages include `total`, `returned`, `nextCursor`, and `complete`.
- Grant file `mcp/grant.json` (gitignored; `WORDLY_MCP_GRANT_FILE` points
  elsewhere). The Connections page writes it: on/off (`status`), permitted
  projects and `manuscriptRead`, always with capabilities `["read"]`, written
  atomically. It refuses to overwrite a file it cannot parse, and refuses
  projects that are missing or in the Trash. Copying
  `mcp/grant.example.json` by hand still works. A revoked grant fails the
  next call. `WORDLY_MCP_DISABLED=1` refuses to start.
- `pnpm mcp:stdio` writes protocol messages on stdout and logs on stderr.
  A disabled or revoked grant writes nothing on stdout.
- Connections page (`/connections`) reports the in-app assistant and the
  external ChatGPT connection separately. "Local adapter ready" means an
  in-process check listed the tools and `list_projects` succeeded. It does not
  mean ChatGPT is connected. No state is labeled active from a config file or
  a running process.
- SQLite, observed and not changed: `prisma/dev.db` is `journal_mode=delete`.
  The Prisma adapter does not set a journal mode. better-sqlite3's default
  busy timeout is 5000 ms per connection. An isolated test held an exclusive
  lock and a second process read successfully after waiting for the lock.

Write tools, staged change sets, tunnels, and OAuth are not implemented.

## Author workflow

| Step | Where it can happen |
| --- | --- |
| Develop ideas | ChatGPT. The adapter is not required. |
| Ask for current records | ChatGPT, once a connection exists, through the read tools. Until then, a context export. |
| Review a concrete set of updates | ChatGPT can show a proposal. That display is not authorization. |
| Authorize and save that set | WordlyEditor, on one page. Today that page is **Import change package**: validate, preview, and **Apply package** together. A future remote change set uses that same shape: one preview and one apply. It is not built. |
| Summary of saved changes | The apply result on that page, and **History & review**. After a connection exists, ChatGPT may read that history and summarise it. The summary is a report, not another approval. |

ChatGPT's confirmation prompt, **Allow all actions**, and any model-written
"approved" flag are not authorization. Wordly cannot see whether a person
clicked them. After the author applies a specific change set on the Wordly
page, that set is not approved a second time. A different set, or the same
set after it has gone stale, is prepared and reviewed again.

## How this differs from the in-app assistant

| | In-app assistant ([assistant.md](assistant.md)) | ChatGPT connection (this plan) |
| --- | --- | --- |
| Who runs the model | Wordly's server calls the OpenAI Responses API | ChatGPT, under the author's ChatGPT account |
| Who pays for model use | The OpenAI API project behind `WORDLY_OPENAI_API_KEY`, per token | The author's ChatGPT plan (app use may count toward plan limits) |
| Direction | Wordly sends the context the author ticks | ChatGPT calls Wordly's tools and pulls what it asks for |
| Where you chat | The Assistant page in Wordly | ChatGPT (web), with its own memory, projects and data controls |
| Credentials | `WORDLY_OPENAI_API_KEY` (server-only) | ChatGPT connection settings, plus a separate tunnel key if a tunnel is used. `WORDLY_OPENAI_API_KEY` is not used |
| Approval | **Apply** button on a shown proposal | Author approval bound to a previewed change set (see [Approval binding](#approval-binding)) |
| Network | Outbound HTTPS to OpenAI only | ChatGPT must reach the MCP server (see [Reachability](#reachability)) |

The two share the same write path (`applyChangePackage`, then `mutationService`)
and the same rules. Neither one gives the other access: the assistant cannot
see ChatGPT conversations, memory or projects, and the connection would not
use the assistant's key, settings or history.

## Findings

### Supported integration

- ChatGPT connects to a **custom MCP server**, added under **Plugins → + →
  Add custom MCP server**, and creates a plugin from it. Write tools are
  supported "subject to confirmation settings". A separate "developer mode"
  toggle is no longer needed: you acknowledge a risk warning for each server
  instead. Account and workspace policies still apply. [1][2][3]
- The "Apps SDK" documentation has been reorganised as **Plugins**. A plugin
  can bundle an MCP server, skills and optional UI. Wordly needs only an MCP
  server with tools; UI and skills are optional. [4][5]
- Custom MCP servers are available on **ChatGPT web only**, not mobile. [2]
- After connecting, ChatGPT uses a snapshot of the tool list. Changes to tool
  names or schemas need **Refresh** (or an admin review in a workspace). [2][6]

### Account and workspace requirements

The official pages disagree about personal plans:

- The help article (updated Oct 26, 2026) says full MCP, including
  write/modify actions, is available to **Business and Enterprise/Edu**. It
  says Pro users can connect custom MCP servers with **read/fetch
  permissions** only, and does not mention Plus. [2]
- The pricing page lists "Developer mode (beta)" and "Create & share Plugins"
  for Plus and Pro, without saying whether write tools are included. [7]
- On **Business**, only admins/owners can create and publish custom MCP server
  connections. On **Enterprise/Edu**, admins can grant that permission to
  members through RBAC (role-based access control). [2] Business plans start
  at 2 users. [7]
- On Free, Go, Plus and Pro, OpenAI may use information read through apps to
  train models if "Improve the model for everyone" is on. On Business,
  Enterprise and Edu it does not by default. [8]

**Do not assume the author's account qualifies.** The local read-only adapter
does not depend on that account. Before any external connection, the author
checks (see [Account checklist](#account-checklist)):

1. That **Add custom MCP server** appears under Plugins in their account.
2. That the **Tunnel** connection option appears, if the tunnel route is chosen.
3. Whether write tools are actually callable, not just listed. On a read-only
   plan the write half of this plan cannot work, and the options are a
   Business/Enterprise workspace or read-only tools only.

### Authentication and transport

- **Transport:** streamable HTTP, usually at `/mcp`, is the documented
  production transport. The connection form also accepts SSE. Secure MCP
  Tunnel can reach a server over **stdio or HTTP** on the author's machine.
  [1][3][9]
- **Authentication options in ChatGPT:** OAuth, no authentication, or mixed
  (connecting and listing tools without auth; each tool declares
  `securitySchemes`). [3]
- **OAuth requirements:** [10]
  - OAuth 2.1 authorization code flow with PKCE (`S256`).
  - Protected-resource metadata at `/.well-known/oauth-protected-resource`,
    or advertised in a `WWW-Authenticate` header on 401 responses.
  - Authorization-server metadata.
  - ChatGPT sends the `resource` parameter, and issued tokens must carry it.
  - ChatGPT registers as a client through a Client ID Metadata Document (CIMD,
    preferred), dynamic client registration, or a predefined client.
  - The MCP server must verify every token (signature, issuer, audience,
    expiry, scopes) on every call.
  - Refresh tokens need `offline_access` or equivalent, or the author has to
    sign in again. [2]
- **mTLS (optional):** ChatGPT presents an OpenAI-managed client certificate
  (`mtls.prod.connectors.openai.com`) that a server can require. This
  identifies ChatGPT as the client; OAuth still identifies the user. [10]

### Reachability

- ChatGPT cannot connect to a local MCP server directly. It needs a public
  HTTPS endpoint or a **Secure MCP Tunnel**. [2][3]
- **Secure MCP Tunnel** [9][11]:
  - OpenAI's `tunnel-client` runs on the author's machine. It long-polls
    OpenAI over **outbound HTTPS only** (`api.openai.com:443`) and forwards
    each MCP request to a local stdio command or local HTTP URL. Nothing
    listens for inbound connections.
  - Setup needs a `tunnel_id` from Platform tunnel settings, and a Platform
    runtime API key with **Tunnels Read + Use**. Creating a tunnel needs
    **Tunnels Read + Manage**.
  - The tunnel must be associated with the ChatGPT workspace that will use it.
    Personal accounts use their personal Platform organization.
  - Limits: 600 requests per minute, 10 MiB per request or response, and a
    120-second deadline per request.
  - It is intended for private connections. It does not qualify for public
    plugin submission.
  - **OAuth caveat:** the authorization server is not tunnelled. "If it is
    unreachable from the public internet and from the `tunnel-client` host,
    the OAuth flow can still fail."
- **Desktop-only plugins** (a local stdio MCP server run by the ChatGPT
  desktop app) are documented only through a submission route that is
  "limited to approved partners". [12] Local marketplaces can install plugins
  in the desktop app, but the docs do not say that a privately installed
  stdio server works in ChatGPT itself rather than Codex. [13] It is not a
  basis for this plan unless OpenAI documents it.

## Options for keeping the main application local

| Option | What is exposed | Hosting | Fit |
| --- | --- | --- | --- |
| **A. stdio MCP server behind Secure MCP Tunnel** (recommended, if eligible) | Nothing listens. `tunnel-client` would launch `pnpm mcp:stdio` and make outbound calls only. The tunnel is not set up | None. The author's computer must be on with `tunnel-client` running | Database and UI stay local. Separate process from the UI |
| B. Loopback HTTP MCP route behind Secure MCP Tunnel | `http://127.0.0.1:<port>/mcp`, reachable only by `tunnel-client` | None | One process, but the MCP endpoint shares the server with the unauthenticated UI. Needs a local shared secret and Host/Origin checks |
| C. Public HTTPS reverse proxy or third-party tunnel to the local app | A public endpoint | Proxy or tunnel service, domain, TLS | Against the current project rules without explicit approval. Needs OAuth and ideally mTLS |
| D. Hosted MCP server with a synced copy of the store | A public endpoint and a hosted copy of the data | Server, database, sync, backups, monitoring | The author's data leaves the machine, and sync conflicts would undermine revision checks. Not recommended |
| E. Desktop-only local plugin | Nothing | None | Not available unless OpenAI approves or documents it |

## Proposed tools

Every tool is scoped to the projects the connection's grant allows (see
[Credentials and permissions](#credentials-and-permissions)). Every tool
checks that each record ID belongs to the requested project before reading
it, because `listRevisions` and `getRevision` take a record ID only. All tools
set `openWorldHint: false`. Results are structured (`structuredContent`) with
stable IDs, and contain no secrets or internal diagnostics.

### Read tools (`readOnlyHint: true`)

All tools except `preview_change_set` are implemented.

| Tool | Input | Returns | Backed by |
| --- | --- | --- | --- |
| `list_projects` | none | Projects and workspaces the grant allows | `listWorkspacesWithProjects`, filtered by the grant |
| `search_references` | `projectId`, `query`, optional `types[]`, `limit`, `cursor` | Matching reference records: ID, title, type, status, revision, protection, a short match excerpt. Manuscript chapters only with `manuscript:read` | **New** read-only `searchService` (case-insensitive substring over title, body and `fields` text, normalised to NFC). Pages results and never drops matches silently |
| `get_records` | `projectId`, `recordIds[]` (up to a fixed count) | Full title, body, fields, type, canon status, protection and current revision. Records the revisions read for the change-set step (below) | `recordService.getRecord` |
| `list_revisions` | `projectId`, `recordId` | Revision numbers, dates, sources (UI, package, import, API), canon status per revision | `recordService.listRevisions` |
| `get_revision` | `projectId`, `recordId`, `revision` | That revision in full | `recordService.getRevision` |
| `list_sections` | `projectId`, `recordId`, optional `limit`, `cursor` | The current version's headings in order: `sectionId`, `parentId`, `level`, `title`, `statusTag` (word for word from the heading, or null) and `chars`; plus `statusMarkedInText` | `src/writing/sections.ts` on the stored body |
| `get_section` | `projectId`, `recordId`, `sectionId` | One section of the current version in full (to the next heading of the same or higher level), with the headings above it and their tags. Oversized sections are refused with their subsections' sizes | `src/writing/sections.ts` on the stored body |
| `review_history` | `projectId`, optional `limit` | Applied change packages with their results, recent audit entries, open review items | `listChangePackages`, `listAudit`, `listReviewItems` |
| `preview_change_set` | `projectId`, `changeSetId` | Status, content hash, and per-operation before/after with field diffs. Also: issues (for example `STALE_REVISION`), canon changes, protected records involved, related records and potential effects, approval status | `previewChangePackage` on the stored package (never writes) |

When a response would exceed the size limit, `get_records` and `get_revision`
refuse and report each record's size, the same rule as the assistant. They
never truncate. For a long document, read it section by section with
`list_sections` and `get_section`.

`get_records`, `get_revision`, `list_sections` and `get_section` report
`statusMarkedInText`: true when the document's headings carry status tags such
as `[APPROVED FRAMEWORK]`. The server instructions say those markings govern
their own sections, while `authorityStatus` describes the whole record.

### Write tools (`readOnlyHint: false`)

Not implemented. Listed here so the later design stays consistent with the
approval decision.

| Tool | Input | Effect | Backed by |
| --- | --- | --- | --- |
| `prepare_change_set` | `projectId`, `summary`, `operations[]` (the existing proposal draft shape: create, update, set status), optional related-record notes, optional conversation label | Stores a **staged change set**. Records nothing in the project | `parseProposalDraft`, `draftToPackage`, `parseChangePackage`, the field/text disagreement check, `planMutations` (dry run) |
| `apply_change_set` | `projectId`, `changeSetId`, `contentHash` | Applies the stored package, only if the author approved that exact content | `applyChangePackage`, then `mutationService.applyMutationsInTx` |

What `prepare_change_set` enforces, all set by trusted server code and never
by the model (the same rules as assistant proposals):

- **Package fields.** The server sets the package ID (`newId("pkg")`),
  workspace and project from the grant, `scope: "reference"`,
  `protectedOverrides: []` and `approval.status: "proposed"`. Manuscript
  chapters and protected records cannot be changed through this connection.
- **Expected revisions** come from what this connection actually read through
  `get_records` (a short-lived read receipt per grant, like the assistant's
  `sentRevisions`). Updating a record it has not read is rejected with "read
  the record first".
- **Bounds:** a maximum number of operations and total size per change set. A
  change set over the bound is refused, never trimmed. Staged change sets
  expire after a set time if not applied.
- **Return value:** `changeSetId`, `contentHash` and the preview, so the model
  can show the author what would change.

`apply_change_set` (annotation `destructiveHint: false`, because history is
kept; see the open decisions):

1. Loads the stored package. The model never resubmits package content.
2. Rejects if `contentHash` does not match (`PROPOSAL_MISMATCH`), or the
   change set has not been approved (`APPROVAL_REQUIRED`).
3. Sets the approval statement in server code, naming the change set, its
   content hash, who approved it and when.
4. Calls `applyChangePackage` with source kind `api` and an actor such as
   `chatgpt:<grant label>`.
5. Returns the result: changed records with previous and new revisions,
   created IDs, review items and the audit entry ID.

Not offered: deleting records or revisions, changing protection, manuscript
scope, restoring backups, editing the dictionary, or arbitrary SQL, file or
code execution.

### Approval binding

**Decided.** ChatGPT may ask before write actions, and the author can set
**Allow all actions**, which may skip that prompt. [2][8] The MCP server
cannot verify that a person clicked anything in ChatGPT. A model-supplied
approved flag is not approval.

The trusted step is one page in WordlyEditor. Today that page is **Import
change package**: the preview and **Apply package** are the same action.
A future remote change set, when writes are built, must work the same way:
the author previews that set and applies it there, including the canon tick
when canon changes. ChatGPT does not get a second apply step. Applying stores
the approval against that change set's id and content hash, then calls
`applyChangePackage`. A retry of that same applied set returns the stored
result. A stale set is rejected and prepared again. There is no extra local
confirmation after that apply.

This is not built yet. The read-only adapter cannot stage or save changes.

This tightens the earlier idea that "the explicit request is the
authorization". The current project rules require an explicit approval of a
shown proposal, and canon changes need the author's confirmation.

## Preserved guarantees

| Guarantee | How |
| --- | --- |
| Single write path | Only `applyChangePackage` writes. The adapter has no database writes of its own except its staging, receipt and access-log tables |
| Revision checks | `expectedRevision` from read receipts. `STALE_REVISION` comes back as a structured issue, so ChatGPT re-reads and re-prepares |
| Protection | `scope: "reference"`, no overrides. `checkWriteAllowed` rejects protected records as today |
| Workspace isolation | Grant → workspace and project list. Every ID is checked against the project, and the project against the grant |
| Idempotency | Package ID fixed when prepared. `(projectId, packageId)` + content hash; a different body with a reused ID gives `PACKAGE_ID_CONFLICT` |
| Audit and provenance | Existing `package.apply` audit, a `Source` row with kind `api`, review items. Plus a new access log (time, grant, tool, project, outcome, issue codes, request ID; no record text) |
| Approval binding | Approval stored against change set ID + content hash, made in the local UI |
| Canon | Never inferred. Canon changes need the canon tick when approving locally |

## Credentials and permissions

- **Grants (new, managed in Wordly's local UI):** label, workspace, allowed
  project IDs, capabilities (`read`, `prepare`, `apply`; `manuscript:read`
  optional), created, last used, revoked. Revoking takes effect on the next
  call.
- **With Option A and no OAuth:** `tunnel-client` launches the stdio server
  with a grant ID from local configuration. The protection then comes from
  three layers: the ChatGPT account (a personal plugin is visible only to its
  creator), the tunnel's workspace association, and the tunnel runtime key.
  This is the simplest setup, but Wordly cannot tell users apart. It suits a
  single author only.
- **With OAuth:** use an identity provider reachable from the author's browser
  and from ChatGPT, typically hosted, with CIMD and PKCE. The local server
  validates tokens offline against the provider's published keys and maps the
  token's subject to a grant. Scopes: `wordly.read`, `wordly.prepare`,
  `wordly.apply`. Whether a local-only authorization server works through
  the tunnel is unverified (see the OAuth caveat above).
- **Secrets:** the tunnel runtime key lives only in the `tunnel-client`
  configuration or the OS secret store. It is a restricted key with Tunnels
  Read + Use, separate from `WORDLY_OPENAI_API_KEY`, and never stored in Wordly's
  database, the repository, logs, tool results or chat. Rotate it on
  suspicion; stopping `tunnel-client` cuts off access immediately.
- **Kill switches:** an environment flag that disables the MCP server, grant
  revocation, and stopping `tunnel-client`.

## Hosting, operations and costs

| Item | Option A (recommended) | Notes |
| --- | --- | --- |
| ChatGPT plan | Write tools are documented only for Business/Enterprise/Edu. Business needs at least 2 users | Check current prices on the pricing page [7]. A personal plan may be read-only [2] |
| OpenAI Platform | A Platform organization with tunnel permissions and a runtime API key | The tunnel docs do not state a price. Confirm before relying on it |
| Hosting | None | The author's computer must be on with `tunnel-client` running during use |
| Identity provider | None (no-auth grant) or a hosted provider (OAuth) | Provider plans vary; a free tier may be enough for one user. Not verified |
| Model usage | Covered by the ChatGPT plan | `WORDLY_OPENAI_API_KEY` is not used |

Operational work:

- Install and update `tunnel-client`, run it as a user service, and check
  `/healthz` and its admin UI (loopback only).
- Rotate the tunnel key.
- After any tool schema change, **Refresh** the connection in ChatGPT (or have
  an admin review it in a workspace).
- Review the access log. Take a database backup before enabling `apply`.

## Implementation plan

**Phase 0: eligibility (author, no code).** Still open. Confirm the plan,
Plugins access, the Tunnel option, and Platform tunnel permissions using the
[Account checklist](#account-checklist). The process model is decided: option A.
OAuth versus a no-auth grant is still open. Write tools stay out until
eligibility is confirmed.

**Phase 1: local server, read tools. Done.**
1. `@modelcontextprotocol/sdk` 1.32.2 is pinned. Its licence is MIT. Its peer
   dependency accepts zod 4, which this app uses.
2. `src/mcp/` defines the six read tools, checks the grant on every call, and
   calls the existing record, revision, and review services.
   `src/server/services/searchService.ts` searches reference records.
3. `pnpm mcp:stdio` opens the database through the existing Prisma setup.
   SQLite stays in delete journal mode. An isolated test confirmed a second
   process waits on a writer lock and then reads. The author's database was
   opened read-only for the pragma check and was not modified.
4. Tests use an in-process MCP client and a spawned stdio process, with
   invented fixtures. They cover tool calls, project isolation, permissions,
   pagination, missing records, oversized results, and revoked grants.

**Phase 2: grants, access log, change sets.**
1. Additive migration through `pnpm db:deploy` (backs up first):
   `RemoteGrant`, `RemoteAccessLog`, `RemoteReadReceipt`, `RemoteChangeSet`
   (ID, project, grant, package JSON, content hash, status, approval fields,
   expiry, applied package ID).
2. Add `prepare_change_set` and `preview_change_set`.
3. Add a source-kind option to `applyChangePackage` / `packageContext` so
   remote applies record kind `api`. No other change to the write path.
4. The **Connections** page already reports assistant and ChatGPT status.
   A grant editor, an access log, and a **Remote change sets** page are not
   built. When they are, preview and apply stay on that one change-set page.

**Phase 3: apply.** Add `apply_change_set`. Run the existing acceptance
scenarios through the tools:
- revision preservation, stale detection, idempotent retry, package-ID
  conflict, atomic rollback;
- protected record rejected, canon without the tick rejected, unapproved
  change set rejected, hash mismatch, expired change set;
- grant revoked mid-session, other project or workspace denied.

**Phase 4: connection (only with the author's explicit go-ahead).**
1. The author creates the tunnel and key in Platform settings, enters the key
   locally, and runs `tunnel-client doctor`.
2. The author adds the custom MCP server in ChatGPT with **Tunnel**, reviews
   the discovered tools, and sets app permissions.
3. Run an evaluation set against a **scratch database with invented
   content**: direct, indirect, follow-up, stale, protected, out-of-scope
   and injection-style requests. Record the tool chosen and the confirmation
   behaviour.
4. Only then point it at the real database, read-only grant first.

**Phase 5: hardening.** Rate limits per grant, size limits, request IDs in
the access log, a documented incident procedure (revoke, stop the tunnel,
restore from backup).

## Decisions

Decided for this stage:

4. **Approval location.** Preview and apply happen together on one Wordly
   page. ChatGPT does not apply afterward. See [Author workflow](#author-workflow).
5. **Process model.** Separate stdio process (option A). SQLite stays in
   `delete` journal mode. A second process can read while the UI is open;
   a writer holding an exclusive lock makes the reader wait, up to the
   5000 ms busy timeout, and then the read succeeds. Journal mode was not changed.
7. **Manuscript access.** Off unless the grant sets `manuscriptRead` to true.
   Manuscript writes stay out of scope.
8. **Read limits in use.** Search pages default to 20 and refuse above 50.
   Revision and history pages default to 20 and refuse above 100. `get_records`
   refuses more than 10 ids. A result over 600,000 JSON characters is refused
   with a size breakdown. Nothing is shortened to fit.

Still needed before any external access:

1. **Plan eligibility.** Whether this account can add a custom MCP server, and
   whether write tools are callable. The official pages disagree for personal
   plans. See the checklist below. Do not buy a plan to resolve this.
2. **Tunnel cost and access.** The tunnel guide states limits and permissions.
   It does not state a price. The author's Platform organization has not been
   checked.
3. **OAuth or no-auth grant.** A hosted identity provider versus a single-author
   grant launched by `tunnel-client`. Whether a local authorization server works
   through the tunnel is still unverified.
6. **Write tool annotation.** `destructiveHint` false versus true. Unneeded
   until write tools exist.
9. **Data exposure.** Which records the grant should name, and the account's
   "Improve the model for everyone" and Memory settings. On Free, Go, Plus, and
   Pro, OpenAI may use information read through apps for training when that
   setting is on. [8]

## Account checklist

These labels are from the OpenAI pages checked on Oct 26, 2026. Look only.
Cancel without saving. Do not create a tunnel, paste a key, or finish
**Create as a plugin**.

In ChatGPT on the web (not the mobile apps):

1. Open **Plugins**.
2. Select the **plus** button.
3. Look for **Add custom MCP server**. If it is absent, this account cannot
   add the connection. Stop.
4. If it is present, look under **Connection** for **Tunnel** and for a server
   URL field. The documented protocols for a URL are **SSE** and **streaming
   HTTP**. Then cancel.
5. Note which authentication choices are shown. The developer guide lists
   **OAuth**, **No authentication**, and **OAuth or no authentication**.
6. Note the plan name on the account. Do not change it.

On the [pricing page](https://chatgpt.com/pricing), these feature rows were
visible: **Developer mode (beta)** (Plus and Pro: yes; Free and Go: no),
**Create & share Plugins** (Go, Plus, and Pro: yes; Free: no), **Plugins**
(Free, Go, Plus, and Pro: yes). The help article, which said it was updated
the same day, says full MCP including write actions is for **Business** and
**Enterprise/Edu**, and that **Pro** can connect custom MCP servers with
**read/fetch** permissions. It does not say that about Plus. Business plans
start at 2 users. Neither page stated a price for Secure MCP Tunnel or for
custom MCP calls. App use may count toward plan limits. [2][7][8]

In the OpenAI Platform, only if the ChatGPT form showed **Tunnel**:

1. Open **Platform tunnel settings** for the personal organization.
2. See whether tunnel permissions are available: **Tunnels Read + Manage** to
   create one, **Tunnels Read + Use** to run `tunnel-client`.
3. Do not create a tunnel or a key yet.

Workspace labels, if the account is Business or Enterprise/Edu: **Workspace
settings > Members**, and the permission **Create plugins with MCPs**. On
Business, the help article says only admins and owners can create and publish.
[2]

## Already in place

- A single mutation path (`src/server/services/mutationService.ts`) shared by
  the UI, the package importer and assistant proposals.
- Change packages with schema validation, `expectedRevision`, scope and
  protection checks, idempotency and atomic apply
  (`src/server/services/changePackageService.ts`).
- Server-set proposal values and content-hash binding
  (`src/server/services/assistantProposalService.ts`, `approvedPackage`,
  `applyProposal`).
- Draft parsing and conversion (`src/assistant/proposalOutput.ts`) and canon
  detection (`src/assistant/canon.ts`).
- `Source.kind` already allows `api` (`src/domain/statuses.ts`).
- Acceptance tests (`tests/acceptance/`) for the scenarios a remote adapter
  must repeat.

## Sources

Accessed Oct 26, 2026.

1. OpenAI, "Connect and test your plugin": https://developers.openai.com/plugins/deploy/connect-chatgpt
2. OpenAI Help Center, "Connecting custom MCP servers in ChatGPT" (updated Oct 26, 2026): https://help.openai.com/en/articles/12584461
3. OpenAI, "Add custom MCP server": https://developers.openai.com/api/docs/guides/custom-mcp-server
4. OpenAI, Plugins documentation index: https://developers.openai.com/apps-sdk/llms.txt
5. OpenAI, "Build an MCP server": https://developers.openai.com/plugins/build/mcp-server
6. OpenAI, "Define tools": https://developers.openai.com/plugins/plan/tools
7. ChatGPT pricing: https://chatgpt.com/pricing
8. OpenAI Help Center, "Connected apps in ChatGPT": https://help.openai.com/en/articles/11487775
9. OpenAI, "Secure MCP Tunnel": https://developers.openai.com/api/docs/guides/secure-mcp-tunnels
10. OpenAI, "Authentication" (plugins): https://developers.openai.com/plugins/build/auth
11. OpenAI, `tunnel-client` repository: https://github.com/openai/tunnel-client
12. OpenAI, "Submit desktop-only plugins": https://developers.openai.com/plugins/deploy/desktop-only
13. OpenAI, "Package your plugin": https://developers.openai.com/plugins/build/plugins
