# Assistant (optional)

The assistant page (`/projects/[projectId]/assistant`) lets the author discuss
selected reference records, a manuscript chapter or passage, and selected
earlier messages with an OpenAI model. Discussion never changes records. On
request it prepares a change proposal for reference records, which the author
reviews and applies explicitly through the existing change-package pipeline
(see [Change proposals](#change-proposals)). Record pages also offer AI
proofreading through the same connection (see [Proofreading](#proofreading)).
Plan → Weave offers **Build grid from draft** through the same connection (see
[Weave build from draft](#weave-build-from-draft)). Discussion may call the
read-only retrieval tools (search, passages, facts, planning, earlier scenes,
and story-event chronology). Change proposals do not. No assistant code calls
`mutationService` directly.

It is off unless `WORDLY_OPENAI_API_KEY` and `OPENAI_MODEL` are set. Without
them the page says what is missing, nothing can be sent, and the rest of the
app is unaffected.

### This app's own key

Story Loom is responsible for its own key, usage and billing. It reads only
`WORDLY_OPENAI_API_KEY`. The general `OPENAI_API_KEY`, which is often set for
the whole computer and shared by other apps, is never used: when it is set and
`WORDLY_OPENAI_API_KEY` is not, the assistant stays off and the page explains
why. The OpenAI client is created with every setting explicit (key, server
address `https://api.openai.com/v1`, no organisation, no project, no admin key,
no webhook secret), so the library's fallbacks to `OPENAI_BASE_URL`,
`OPENAI_ORG_ID`, `OPENAI_PROJECT_ID` and the other shared `OPENAI_*` variables
never apply. The library has no option to ignore `OPENAI_CUSTOM_HEADERS`, so
the assistant stays off while that variable is set.

## Configuration

All settings are server environment variables in `.env` (git-ignored).
`.env.example` lists them with blank placeholders.

| Variable | Default | Range |
| --- | --- | --- |
| `WORDLY_OPENAI_API_KEY` | none | required; `OPENAI_API_KEY` is not used |
| `OPENAI_MODEL` | none | required; a model ID your API project can use with the Responses API |
| `ASSISTANT_MAX_INPUT_CHARS` | 600000 | 1000 to 1000000 |
| `ASSISTANT_MAX_OUTPUT_TOKENS` | 2000 | 100 to 100000 |
| `ASSISTANT_MAX_REQUESTS_PER_HOUR` | 30 | 1 to 1000 |
| `ASSISTANT_MONTHLY_TOKEN_CAP` | 300000 | 1000 to 1000000000 |
| `ASSISTANT_REQUEST_TIMEOUT_SECONDS` | 120 | 10 to 600 |

No model ID is built in. An invalid value in any setting turns the assistant
off and is listed on the page. Settings are read when the server starts, so
restart after editing `.env`.

## Integration

- Official `openai` JavaScript/TypeScript SDK, Responses API
  (`client.responses.create` with `stream: true` for discussion, and
  `stream: false` with Structured Outputs for change proposals). Adapter:
  `src/server/openai/openaiProvider.ts`.
- Behind the `AssistantProvider` interface (`src/assistant/provider.ts`), so
  tests use a scripted fake and never reach the network.
- Streaming: the adapter maps `response.output_text.delta` and
  `response.refusal.delta` to text, `response.completed` and
  `response.incomplete` to the end of the answer (with
  `usage.input_tokens`, `output_tokens`, `total_tokens`), and
  `response.failed` / `error` events to failures.
- The route `POST /api/projects/[projectId]/assistant/turn` streams
  newline-delimited JSON to the browser. `POST .../assistant/cancel` stops a
  running answer. Both refuse cross-site requests and non-JSON bodies, so
  another website cannot start a paid request.

### Request settings

| Setting | Value | Why |
| --- | --- | --- |
| `model` | `OPENAI_MODEL` | Chosen by the author; never hard-coded. |
| `instructions` | fixed text in `src/assistant/prompt.ts` | No-write role, canon rules, source-material framing; proposal requests add `PROPOSAL_INSTRUCTIONS`. |
| `text.format` | proposals only: `json_schema`, `strict: true` | The proposal draft schema; see below. |
| `input` | selected earlier messages, then one user message with the sources and question | Only what the author selected. |
| `store` | `false` | Do not keep the response for later retrieval (the default is `true`, which keeps it for at least 30 days). |
| `truncation` | `"disabled"` | The provider must fail rather than drop context. |
| `previous_response_id` | not used | The app sends the selected history itself, so unselected messages are never included. |
| `max_output_tokens` | `ASSISTANT_MAX_OUTPUT_TOKENS` | Bounds each answer. |
| SDK `maxRetries` | `0` | Never repeat a paid request without the author; the UI offers Retry. |
| SDK `logLevel` | `"off"` | The SDK prints nothing about requests. |
| SDK `timeout` / `signal` | `ASSISTANT_REQUEST_TIMEOUT_SECONDS` / cancel | Cancel and timeouts abort the HTTP request. |

### Data retention (as documented by OpenAI, October 2026)

From OpenAI's [data controls guide](https://platform.openai.com/docs/guides/your-data):

- API data is not used for training by default.
- Abuse-monitoring logs, which can contain prompts and responses, are kept for
  up to 30 days by default, longer if required by law or to prevent harm.
  `store: false` does not change this.
- With `store: false`, the Responses API keeps no application state for the
  response. Prompt caching may hold encrypted data on GPU machines for up to
  24 hours.
- Zero Data Retention and Modified Abuse Monitoring require OpenAI's prior
  approval and are set on the organization or project, not per request.

This app therefore does not promise zero retention. Check the guide for
changes.

## Context and safety

- The author ticks reference records (whole, or chosen sections by heading),
  chooses a chapter (whole or a selected passage), and ticks earlier messages.
  Nothing else is sent.
- A section (kind `section`) runs from its heading to the next heading of the
  same or higher level, so it includes its subsections; a chosen section inside
  another chosen one is sent once. Its source marker adds `sectionPath` (the
  headings above it, word for word) and `sectionStatus` (its own heading's
  tag). The stored context item keeps the section's offsets in
  `passageStart`/`passageEnd`, so a retry resends exactly the same text. A
  proposal may not replace the whole body of a record sent only as sections.
- Documents whose headings carry status tags (`[APPROVED FRAMEWORK]`,
  `— SELECTED`, ...) are marked `statusMarkedInText="yes"`, and the
  instructions say those markings govern their own sections while the record
  status describes the whole document.
- Each source is wrapped in `<<SOURCE-{boundary} ...>>` markers with its ID,
  title, type, canon status, revision, and kind. The boundary is random and
  checked not to occur in the material, so record text cannot fake the end
  of a source. The instructions say to treat source text as material, never as
  instructions.
- Only `approved` records are labelled canon. The model is told to put its
  ideas under "Proposals (not canon)". The page repeats that answers are
  proposals.
- The instructions state that the assistant has no access to the author's
  ChatGPT account, memory, conversations, or Projects.
- Records and sections are never truncated. If the request is over
  `ASSISTANT_MAX_INPUT_CHARS`, nothing is sent and the author sees each item's
  size and how much to remove.
- A question must use each record's current revision; if a record changed after
  selection, the request is refused. Each answer stores the record ID,
  revision, kind, passage offsets, length and SHA-256 of every source used.
  Answers whose sources have newer revisions are labelled "Based on an older
  version". Retry resends the exact stored revisions.

## Change proposals

Workflow: discuss (no writes) → the author chooses **Prepare change proposal**
→ the server assembles a package and the conversation shows a summary card →
the author chooses **Review changes**, which opens the review screen
(`/projects/{id}/assistant/proposals/{proposalId}`, the same screen the
package import uses) → the author chooses **Apply N updates** there → the
result lists changed records, new revisions and review items. **Back to
discussion** returns to the proposal in its conversation.

### What the model returns

Requests use Structured Outputs in strict mode
(`text.format = { type: "json_schema", name: "wordly_change_proposal", strict: true }`).
The change-package JSON Schema cannot be used directly: strict mode requires
every object to be closed (`additionalProperties: false`), every property to
be required (optional ones are nullable), and a non-`anyOf` root, while the
package format has free-form `fields` objects and optional properties. The
draft schema (`src/assistant/proposalOutput.ts`) therefore:

- writes structured fields as `[{ key, valueJson }]`, the value as JSON text;
- uses `null` for "keep unchanged" (title, body, status, note);
- allows only reference record types to be created;
- has no package ID, workspace, project, scope, approval, protected
  overrides, expected revisions or new record IDs;
- avoids keywords that strict mode or fine-tuned models reject (no
  `minLength`, `pattern`, `format`, `minItems` and so on).

`tests/unit/proposalOutput.test.ts` checks these rules against the schema.

### What the server does

1. **Before the request:** a proposal request needs each selected record's
   current revision, the same as a question.
2. **Refused, incomplete or failed responses:** a refusal, an incomplete
   response (for example `max_output_tokens`) or a provider error is stored
   as a failed or incomplete answer. Partial output is never parsed.
3. **Parsing:** the output is parsed with a strict zod schema. Unknown keys,
   such as an `approval` the model invented, make it malformed. Nothing is
   repaired.
4. **Conversion (trusted code):**
   - The server assigns `packageId` (`pkg_` + ULID), `workspaceId`,
     `projectId`, `scope: "reference"`, `protectedOverrides: []`,
     `approval: { status: "proposed" }`, new record IDs, and
     `source.conversationLabel` (proposal ID and conversation).
   - Each record the model changes must have been sent with the request.
     Its `expectedRevision` is the revision that was sent, never a value
     from the model.
5. **Validation:** the package is validated again with the full v1 schema
   (`parseChangePackage`).
6. **Field/text disagreements:**
   - The mutation planner computes before and after states without writing.
   - `src/assistant/fieldText.ts` flags simple field values (numbers and
     short strings, including spelled-out numbers up to 99) that disagree
     with the prose.
   - Disagreements the model reports are added too.
   - Both become `relatedRecords` notes, which turn into review items on
     apply. Records are never rewritten.
7. **Storage:** the package, which is immutable and marked proposed, is
   stored with its content hash in `AssistantProposal`.

### Applying

- Applying uses the server action `applyProposalAction(projectId, proposalId,
  contentHash, confirmCanon)`. Chat messages never trigger it, and it asks
  for no second confirmation.
- The proposal must belong to the project and workspace, and the content hash
  must match the stored proposal (otherwise `PROPOSAL_MISMATCH`).
- The server sets the approval to `approved` with a fixed statement naming the
  proposal and its content hash. The package is therefore deterministic, so a
  second Apply is `already_applied`.
- If any operation would create an approved record, promote a record to
  approved, or change an approved record's content, Apply needs the canon
  tick (`CANON_CONFIRMATION_REQUIRED`). Proposed facts stay proposed
  otherwise.
- `applyChangePackage` then does everything a manual import does:
  - re-plans inside the transaction, so stale revisions are rejected;
  - enforces scope and protection rules;
  - enforces idempotency;
  - writes provenance (`Source`, kind `change_package`) and the audit entry
    `package.apply`;
  - creates review items for package notes and detected mentions;
  - stores the `ChangePackage`.
- The proposal is marked applied in the same transaction, so a failure rolls
  everything back.

### Manual import and export

The proposal's JSON (marked proposed) is shown and can be copied. The manual
import page previews it but will not apply it until `approval.status` is
`approved`, as for any package. Manual import and context export are
unchanged.

## Weave build from draft

Plan → Weave → **Build grid from draft** analyzes a chosen manuscript draft
(chapter range optional) or pinned Zero-draft revisions and proposes Weave
story threads, chapter/scene summaries (optional goal / change / forward),
scene-boundary suggestions for review only, and beats with exact source
passages. It uses `provider.structured` with
`src/weave/buildFromDraftOutput.ts`, the same OpenAI connection and usage
limits as proofreading, and never writes manuscript prose or calls
`mutationService`.

- `POST /api/projects/[projectId]/weave/build-from-draft` streams NDJSON
  (`started`, then `done` with the run). Cross-site and non-JSON bodies are
  refused.
- The author Accept / Skip / matches suggestions, then Apply. Apply is atomic
  through `weaveBuildFromDraftService.applyWeaveBuild`: stale source revision
  checks, stable suggestion IDs for retry safety, existing unmatched grid
  content preserved. Proposed scene boundaries are stored for review only and
  never create or split manuscript scenes.
- Applied Weave grids/threads/beats are included in workspace backups like any
  other Weave data. Build runs are local review state (not backup fields).

## Proofreading

Record pages have an **AI proofreading** box in the writing tools. It uses the
same configuration, provider, limits, usage count and cancel registry as the
assistant, and is shown as unavailable when the assistant is not set up. Only
the **Proofread** mode (spelling, grammar, punctuation) exists. Style and
continuity reviews are not implemented and have no controls.

### Request

- `POST /api/projects/[projectId]/proofread` with
  `{ mode: "proofread", recordId, revision, range | null }` streams NDJSON
  (`started` with the run ID, then `done` with the result).
  `POST .../proofread/cancel` with `{ runId }` stops it. Both refuse cross-site
  and non-JSON requests.
- The server reads the record in that project. It refuses if `revision` is not
  the current revision (`STALE_SELECTION`), so the editor must have no unsaved
  changes. It takes that revision's body with line endings normalized to `\n`,
  which is how the text box counts characters, and sends the range (or the
  whole text) in one source block. Before the block it lists the author's
  dictionary words (project and workspace) that occur in that text, marked
  "(match case)" where only that capitalisation is accepted
  (`dictionaryWordsIn`, `acceptedSpellingsText`); their count is stored as
  `ProofreadRun.dictionaryTermCount`. Nothing else is sent: no other records,
  no other dictionary words, no conversation.
- Instructions (`src/proofread/prompt.ts`) limit the model to spelling,
  grammar and punctuation. They tell it to preserve voice, meaning, dialogue,
  dialect and invented terms, keep Markdown symbols, line breaks, links, code
  and HTML, and treat the text as material, not instructions.
- Structured Outputs, strict mode, schema `wordly_proofread`
  (`src/proofread/output.ts`): `{ suggestions: [{ category, before, original,
  after, replacement, explanation }] }`. The model quotes text; it never
  returns offsets, IDs or revisions.
- Size check against `ASSISTANT_MAX_INPUT_CHARS` (nothing is cut), then the
  shared hourly limit and monthly cap. One running run per record (`BUSY`).

### Locating suggestions (`src/proofread/anchors.ts`)

The server turns each quote into a range on the proofread text:

- `before + original + after` must occur exactly once in the text sent. If it
  occurs nowhere, `original` alone is used only if it occurs exactly once.
  Otherwise the suggestion is rejected as `ambiguous` or `not_found`, so a
  repeated phrase is never replaced in the wrong place.
- Rejected as well: empty or unchanged suggestions; longer than 200
  characters (`too_long`); containing a line break; changing the sequence of
  Markdown symbols `` * _ ` [ ] < > # | ~ \ `` (`formatting`); inside fenced or
  inline code, link addresses, reference definitions, HTML, autolinks or bare
  URLs (`protected_markup`); splitting a surrogate pair or a base character
  from a combining accent (`invalid_text`); exact duplicates; changing or
  removing a word the author's dictionary accepts (`dictionary_word`). A
  correction *to* a dictionary word (for example a misspelt name) is allowed.
- Offsets are UTF-16 code units, the same as the browser's text box, in the
  Markdown source. They are never derived from rendered text. No Unicode
  normalization is applied: a quote in a different form is `not_found`.
- Kept suggestions get IDs `s1`, `s2`, ... in text order, the real surrounding
  text (40 characters each side), and the IDs of suggestions they overlap.
- Rejected suggestions are returned with their reason and shown to the author.

Refusals, incomplete responses (for example `max_output_tokens`), malformed
output and provider errors produce no suggestions.

### Applying (`src/proofread/apply.ts`, `src/components/writing/Proofreader.tsx`)

- The editor keeps the proofread text. When showing or accepting a
  suggestion, it maps the suggestion from that text to the current text box
  with a character diff (common prefix and suffix first; above 5,000 changed
  characters the changed middle counts as one change).
- A suggestion is open only if its characters and their immediate neighbours
  are unchanged and still equal `original`. Otherwise it is stale and cannot
  be accepted. Accepting one of two overlapping suggestions therefore makes
  the other stale.
- Accept replaces exactly that range with `replacement` using the same
  `execCommand("insertText")` path as find and replace, so it joins the
  browser's undo history. **Undo** puts `original` back if the replacement is
  still there unchanged. After Ctrl+Z restores the original, the suggestion is
  open again. Undo keeps the suggestion's "accepted" decision, so a Ctrl+Z
  that brings the replacement back shows it as accepted rather than stale.
- Accept and Undo are disabled on protected records unless the author ticks
  the unlock box. Saving goes through the normal record save with its
  expected-revision check and protection rule. Proofreading never writes
  records, revisions, audit entries or review items.
- There is no accept-all, and suggestions are not stored. They last until the
  page is left or reloaded.

## Storage

Tables `AssistantConversation`, `AssistantMessage`, and
`AssistantContextItem` (migration `20261025170000_assistant_conversations`),
plus `AssistantMessage.mode` (`chat` | `proposal`) and `AssistantProposal`
(migration `20261025200000_assistant_proposals`). Deleting a conversation
deletes its proposals; applied changes, their revisions, audit entries and
change-package records stay.
Conversations carry `workspaceId` and `projectId`; every lookup checks both,
records must belong to the project, and earlier messages must come from the
same conversation.

Message statuses: `streaming`, `complete`, `incomplete` (stopped by the output
limit or another reason), `cancelled` (partial text kept), `failed` (error code
and message kept). A `streaming` message older than the timeout plus 60
seconds is marked failed as interrupted. Proposal answers additionally use the
error codes `refused`, `malformed_output` and `invalid_proposal`; none of them
stores a proposal. Conversation `summary` (author-editable) and project-level
`ProjectAssistantSettings` (`autoIncludeRecent`, `recentContextBudgetChars`)
are migration `20261118200000_assistant_memory`. Preferences are never
inferred: auto-include stays off until the author turns it on. A non-empty
saved summary is sent as a labeled preamble with the next question. When
auto-include is on, recent complete messages fill Include up to the budget;
explicit ticks still win, and oversized requests are refused with no automatic
retry.

Assistant conversations (including summaries), messages, context items,
proposals, and project assistant settings are optional arrays in the workspace
backup format. Older backups that omit them restore with none / defaults.
Proofread runs stay SQLite-only.

`ProofreadRun` (migration `20261025220000_proofread_runs`) stores one row per
proofreading request: workspace, project, record, revision, scope, range,
SHA-256 of the text sent, status (`running`, `complete`, `incomplete`,
`cancelled`, `failed`), error code and message, model, token usage, request
size, and how many suggestions were kept and rejected. It stores no text and
no suggestions. Runs left `running` past the timeout plus 60 seconds are
marked failed as interrupted. Runs are not part of the backup format.

## Limits and usage

- Hourly request limit and monthly token cap are app-wide (all workspaces) and
  counted by this app. Assistant answers and proofreading runs count toward
  the same limits.
- Reported token usage is stored per answer. Cancelled answers, and failed
  answers with partial text, store an estimate (characters / 4) marked as an
  estimate.
- Before sending, the app refuses a request if this month's usage plus the
  estimated input plus `max_output_tokens` would pass the cap.
- The cap is not a hard spending cap: estimates can be wrong and other use of
  the same key is not counted. OpenAI budget alerts are notifications, not hard
  caps. No cost is calculated or shown.

## Logging and secrets

- The key is read only in `server-only` modules and is never included in page
  data, responses, or logs. The assistant refuses to run if any
  `NEXT_PUBLIC_*` variable naming an OpenAI key is set.
- Provider errors are replaced with the app's own messages. For 400 and 422
  errors the provider message is shown after removing anything that looks like
  a key, capped at 400 characters.
- The server logs only error codes, never prompts, questions, or answers.
- The SDK also reads `OPENAI_BASE_URL` and sends requests there instead of
  OpenAI. The app never sets it; leave it unset unless you mean to redirect
  requests. It was used during development to check the page against a
  local mock without contacting OpenAI.

## Manual connection test

This makes one small paid request. Run it yourself; automated tests never do.

1. In `.env`, set `WORDLY_OPENAI_API_KEY` and `OPENAI_MODEL`. Do not paste the key
   anywhere else.
2. Restart `pnpm dev` and open a project's Assistant page. Confirm the model ID
   and limits are shown and there is no setup warning.
3. Choose New conversation. Tick no records and no chapter. Ask: "Reply with
   the single word: connected."
4. Confirm the answer streams, is marked complete, shows "Used: no records."
   and token counts "reported by OpenAI", and that Usage this month went up.
5. Cancel test: ask for a long answer (for example "Count from 1 to 500 in
   words."), choose Cancel while it streams, and confirm the answer is marked
   cancelled with its partial text and estimated tokens. Choose Retry and
   cancel again if you want to check Retry.
6. Error test (no answer is generated): set `OPENAI_MODEL` to a made-up ID, restart, ask again,
   and confirm a clear 404 message. Restore the real model ID and restart.
7. Check the usage page in your OpenAI account matches roughly.
8. Proposal test (one more paid request; use a throwaway project with invented
   records): tick one reference record, type "Add the structured field
   test_flag with value true", and choose Prepare change proposal. Confirm the
   proposal shows one update with the field added, then choose Review
   changes, choose Apply 1 update, and confirm the result lists the new
   revision.
9. Proofreading test (one more paid request; use an invented record): type
   "She recieved teh letter." into a record, save it, and choose Proofread
   document. Confirm two suggestions appear, accept one, dismiss the other,
   and save.
