# Market roadmap baseline (Phase 0)

Baseline for the Story Loom market roadmap. Current routes and services are
authoritative. Older “gap” notes in chat transcripts or historical planning
notes are not. This pass does not change schema, routes, or working-database
data.

Recorded: Nov 23, 2026.

## Product position

Story Loom is a private, continuity-aware writing studio for novel and series
authors. Local-first storage, explicit canon approval, protected manuscript
records, revision history, provenance, backups, and reviewable AI proposals
are the durable differentiators. Competing as a generic word processor or a
public world wiki is out of scope for Phases 1–5.

## Authoritative sources

| Source | Role |
| --- | --- |
| Current `src/app/projects/[projectId]/**/page.tsx` routes | What the product exposes |
| `PROJECT_RULES.md` | Data-safety and domain invariants |
| `PROGRESS.md` | What shipped recently and how to roll it back |
| `docs/assistant.md`, `docs/backup-format.md`, `docs/world-and-weave.md` | Behavior contracts |
| `tests/helpers.ts` `createTestDb` / `createTestDbThrough` | Isolated verification DBs |
| This file | Market baseline and measurement plan for Phases 1–6 |

Do not reset, reseed, or overwrite `prisma/dev.db`. Apply schema changes only
with `pnpm db:deploy` after `pnpm db:backup`. Tests and examples use invented
content only.

## Current capability inventory

### Manuscript writing

- Chapters, scenes, scene notes; book order; protection; revisions; provenance
- Write landing with outline, corkboard, outliner, search, progress, goals
- Focus / companion / split drafting modes; local unsaved recovery; Markdown editor
- Zero draft / Author manuscript rewrite with source pins
- Find/replace, pattern replace, style check, spelling, dictionary
- Read / scrivenings; nested scene text in chapter view

Routes: `/projects/[id]/write`, `/write/*`, `/read`, `/records/[recordId]`.

### Planning

- Weave library, plot grids, freeform boards
- Premade beat sheets; threads; setup/payoff; Create scene from beat
- Build grid from draft (reviewable AI); chapter analysis
- Story events, calendar, chronology helpers

Routes: `/projects/[id]/plan`, `/plan/weave/*`, `/world/events`, `/world/calendar`.

### Worldbuilding

- World Hub: taxonomy, custom categories/kinds, tags, collections, recent access
- Living Character Profiles and Living World Profiles (upgrade, provenance, approval)
- Series-shared references with home-book ownership
- Maps (layers, pins, geometry, classification), boards, relationships
- Name generator; established facts; place/record relations

Routes: `/projects/[id]/world`, `/world/*`, dossier and world-upgrade record pages.

### Continuity and review

- Continuity Ledger (read-on-load; suppressions audited)
- Character state / knowledge / limitation / identity findings
- World–manuscript contradiction review
- Review items from imports, AI, mentions, field disagreements

Route: `/projects/[id]/continuity`. Services:
`continuityService`, `reviewService`, character writing-context findings.

### AI

- Multi-provider assistant; selected context only; prompt presets
- Selection assist, beat draft, proofreading (spelling/grammar/punctuation)
- Character analysis; chapter analysis; Weave build-from-draft
- Change proposals: reference scope, explicit Apply, stale-revision checks
- Local read-only MCP (`pnpm mcp:stdio`); not a ChatGPT write connection

Documented limit: style and continuity AI proofreading are not implemented
(`docs/assistant.md`).

### Import / export / backups

- Markdown/text references; chapter Markdown/DOCX; Scrivener ZIP; DOCX review
- Change packages; context bundles
- Manuscript/reference PDF, DOCX, EPUB, Markdown; wiki HTML; compile profiles
- World bible exports with point/full spoiler modes
- Workspace backups, sync bundles, rolling/mirror backups, restore into new DB

### Desktop and distribution

- Electron shell; library folder; Windows/macOS targets
- Local-only (`127.0.0.1`); no auth, hosted sync, or multi-user editing

## Marketplace comparison (Nov 2026)

| Concern | Competitors stronger today | Story Loom today | Roadmap phase |
| --- | --- | --- | --- |
| Continuity as a product surface | Rare as a first-class dashboard | Strong ledger + findings; under-discovered | 1 Story Health |
| Visual multi-plotline planning | Plottr, Campfire | Weave + filters; less visual / less central | 2 Visual Weave |
| Comfortable long-form drafting | Scrivener, Dabble, Campfire | Safe Markdown; fewer affordances | 3 Writing polish |
| First-hour discovery | Most commercial apps | Many nested tools | 4 Onboarding |
| Publish-ready / reader-facing world | Atticus, World Anvil | Strong file export; no portal | 5 Publishing / portal |
| Multi-device collaboration | Dabble, Novlr, Campfire cloud | Local + file sync only | 6 Opt-in sync |

## Stale-claim reconciliation

Treat the current checkout as truth. Known historical mismatches:

| Stale claim | Current reality |
| --- | --- |
| No chapter import / Scrivener path | `/import-chapters`, `/import-scrivener`, DOCX review |
| No manuscript ordering | Book order via `moveInBook` / Write tools |
| Continuity / world tools “missing” | Continuity Ledger, maps, boards, calendar, relationships shipped |
| World bible / spoiler export missing | W7–W8 world bible + compile/export paths |
| Backup remap / deploy unsafe | W8B hardening + isolated deploy tests |
| Living profiles / series bible unfinished foundations | Living Character + Living World profiles and series sharing are in tree |

When documenting a gap for Phases 1–6, cite a current route or
`docs/*.md` contract. Do not cite chat summaries alone.

## Product metrics

No remote telemetry. Metrics are measured with invented fixtures, isolated
databases, timed manual runs, and (where useful) local acceptance checks.
Do not send manuscript text, titles, or keys to third parties for analytics.

| Metric | Definition | How to measure | Phase target |
| --- | --- | --- | --- |
| Time to first chapter | Minutes from empty project → first saved chapter | Manual stopwatch on invented project; onboarding acceptance | Phase 4 ≤ 5 min |
| Time to first world reference | Minutes from empty project → first saved World reference | Same | Phase 4 ≤ 5 min |
| Continuity issues resolved | Open ledger items → intentional / ignored / fixed over a scripted session | Ledger counts before/after on roadmap fixture | Phase 1: triage path used without writing prose |
| Feature discovery | Count of primary destinations found without Help search (Write, Weave, World, Continuity, Maps, Boards, Export, Assistant) | First-run checklist | Phase 4: ≥ 6 of 8 named without hunting |
| Successful imports | % of scripted Markdown / chapter / Scrivener / package imports that apply or refuse cleanly | Acceptance suites + one manual pass | Keep 100% on fixtures |
| Successful restores | % of scripted backup restore dry-runs / new-DB restores that verify | `db:verify-backup` / acceptance | Keep 100% on fixtures |
| Export success rate | % of scripted PDF/DOCX/EPUB/Markdown/wiki exports that build | Acceptance suites | Keep 100% on fixtures; Phase 5 adds validation warnings |

Baseline measurement protocol (repeat before closing each phase):

1. `pnpm db:info` on the working DB (read-only confirmation; never reset).
2. Run the phase’s targeted tests on `createTestDb()` fixtures only.
3. Optional browser pass on a temporary project or disposable restore DB — never the author’s manuscript as a write target.
4. Record results under the matching `PROGRESS.md` entry.

## Fixture and isolated-database rules

| Rule | Detail |
| --- | --- |
| Isolation | Every automated test uses `createTestDb()` or `createTestDbThrough()` from `tests/helpers.ts`. Never open `prisma/dev.db` from tests. |
| Invented content | Use Saltmarsh / Mara Venn–style invented names. No real manuscript text. |
| Shared roadmap seed | Prefer `tests/helpers/roadmapFixture.ts` for Phases 1–3 so Continuity, Weave, and Write share one series shape. |
| Migrations | Schema work is verified on isolated files; working DB only via `pnpm db:deploy` after backup. |
| Restores | Prefer `--new-database` or remapped workspace restore for real-data checks. |
| Fixtures on disk | Markdown/DOCX samples under `tests/fixtures/`; keep them invented and small. |

Roadmap fixture (`seedRoadmapSeries`) provides:

- One workspace, two books in one series
- One chapter + scene with a draft-character citation path for Continuity
- One approved place, one unresolved canon decision, one continuity note
- Stable IDs under the `rm_` prefix for deep-link and Story Health tests

## Hard-to-discover surfaces (onboarding debt)

Promote or guide in Phase 4 (and surface counts in Phase 1 where relevant):

- Continuity Ledger
- Maps, boards, timeline, calendar, relationships, name generator
- Import chapters / Scrivener / DOCX review
- Compile profiles and world-bible spoiler modes
- Assistant proposal review, selection assist, beat drafting
- Series share / Author rewrite upgrade flows
- Backup sync bundles and rolling backups

## Phase exit criteria for Phase 0

- [x] Working database left untouched (no reset/reseed)
- [x] Capability inventory written from current routes/services
- [x] Marketplace gaps mapped to Phases 1–6
- [x] Stale claims called out as non-authoritative
- [x] Metrics defined without remote telemetry
- [x] Shared invented roadmap fixture + isolated-DB smoke test added
- [x] `PROGRESS.md` records this baseline

Phase 1 (Story Health) shipped on top of this baseline: see `PROGRESS.md`
“Market roadmap Phase 1” and `summarizeStoryHealth` in
`src/server/services/continuityService.ts`.
