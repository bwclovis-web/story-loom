# Spell checking and the author's dictionary

Author-facing instructions are in the app (**How to use**, "Spelling" and
"Project dictionary"). This file covers design, data and licensing.

## Why not the browser's checker

`<textarea spellcheck>` hands checking to the browser. No browser API lets a
page add words to that dictionary, read its results, or draw its underlines
differently, so it cannot know invented names. The editor therefore has two
modes, chosen per browser with the `wordly-spellchecker` cookie
(`src/writing/spelling.ts`):

- `app` (default): Story Loom checks the record text box itself with
  [typo-js](https://github.com/cfinke/Typo.js) 1.4 and the Hunspell English
  word lists below, plus the author's dictionary. The textarea's `spellcheck`
  attribute is turned off so the browser draws no second set of underlines.
- `browser`: the earlier behaviour (`spellcheck` on, the browser's own
  dictionaries; the author's dictionary is not used).

If the app checker fails to start (worker error, missing word list files) the
editor falls back to the browser's checker and says so. Titles, the new-record
form and other inputs always use the browser's checker.

## How checking runs

- **Words** (`src/spelling/words.ts`): Unicode letters and marks, with
  apostrophes only between letters. Markdown code, link addresses, URLs and
  HTML (`markdownProtectedSpans`) are skipped, as are single letters, words
  joined to digits or `_`, and `&entity;` names. Hyphenated words are checked
  part by part. Offsets are UTF-16 positions in the text box's value.
- **Standard dictionary**: typo-js `check()` on the word normalised to NFC
  with `’` as `'`; if unknown, the accent-free form is tried (the bundled
  lists are accent-stripped). Results are cached.
- **Author's dictionary** (`src/spelling/dictionary.ts`, `DictionaryMatcher`):
  exact match for "match case" entries, case-insensitive otherwise, and a
  possessive `'s` is stripped before a second try. Entries only stop spelling
  flags: they never accept a *similar* word. `similarDictionaryWords` (edit
  distance ≤ 1 for words of up to 4 letters, ≤ 2 otherwise, plus
  capitalisation-only differences) is used to *point out* a near match, for
  example a misspelt character name, which stays flagged.
- **Worker** (`src/spelling/spell.worker.ts`, protocol in `protocol.ts`): the
  editor starts a module worker (`new Worker(new URL(...))`, bundled by
  Turbopack). It downloads the `.aff`/`.dic` files from
  `/api/spelling/<en-US|en-GB>/<aff|dic>` (served from `node_modules`, cached
  privately for a day), builds the checker (about 0.3 s) and answers `check`
  requests. Suggestions (`typo.suggest`, which can take a second or more)
  run in a second worker created on first use, so they never delay checking.
- **Editor** (`src/components/writing/useSpellcheck.ts`): checks are
  debounced 300 ms after typing stops; only the latest response is used.
  Between checks, flags are moved through edits with the same text map as
  proofreading (`src/spelling/ranges.ts`); a flag whose word, or a character
  next to it, changed is dropped until the next check. "Ignore once" ranges
  are kept and moved the same way, in memory only.
- **Underlines** (`SpellOverlay.tsx`): a transparent copy of the text with the
  textarea's font, padding, width and scroll position sits on top of it,
  ignoring the mouse; only flagged words get a wavy underline. The overlay
  renders from a deferred copy of the text so typing never waits for it.

Measured with invented fixtures (`tests/unit/spelling.test.ts`): a 33,000-word
chapter checks in well under the 1.5 s test limit, and moving flags after a
keystroke takes well under the 20 ms limit per edit.

In the browser (production build, invented text typed into the middle of the
chapter), main-thread time per keystroke was the same as with the browser's
checker at about 5,000 words (510 flags). At about 30,000 words with 3,000
flags it was roughly 20 ms against 7 ms, with no task over 50 ms. Most of the
extra time is the browser laying out the overlay copy of the text, which grows
with the length of the record. The overlay is memoised, keyed by order rather
than by offset, and syncs its scroll position in an animation frame so it does
not force an extra layout.

## Dictionary data

Table `DictionaryEntry` (migration `20261025230000_dictionary_entries`):
`workspaceId`, `projectId` (null for a workspace-wide entry), `word` (as
entered, NFC, straight apostrophes), `wordKey` (lower-case form for lookups),
`caseSensitive`, `note` (≤ 200 characters), `origin`
(`manual | editor | import | reference`), timestamps. Both foreign keys are
`ON DELETE RESTRICT`.

- A project sees its own entries and its workspace's; never another
  project's or another workspace's (`src/server/services/dictionaryService.ts`,
  every call is scoped through the project).
- An entry is one word as the checker sees it (`validateDictionaryWord`, ≤ 64
  characters). A word cannot be added when an active entry already covers it:
  the same word, or the same letters where either entry ignores case. Two
  "match case" entries may differ only in capitals.
- Add, update and remove write `dictionary.add|update|remove` audit entries;
  bulk adds write one `dictionary.import` or `dictionary.add` entry. Entries
  are not records: no revision, provenance or canon status changes.
- Reference suggestions (`suggestReferenceTerms`) read the titles and
  `fields.name` / `fields.aliases` of the project's reference records, keep
  words the standard dictionary and the author's dictionary do not know, and
  only list them. Nothing is preselected or added automatically.

### Export and import format

`GET /projects/[projectId]/dictionary/export?scope=project|workspace` returns:

```json
{
  "format": "wordly.dictionary",
  "formatVersion": 1,
  "exportedAt": "2026-01-02T03:04:05.000Z",
  "scope": "workspace",
  "label": "Invented series",
  "entries": [{ "word": "Vexmoor", "caseSensitive": true, "note": "marsh city" }]
}
```

Import (`src/spelling/dictionaryFile.ts`, parsed in the browser) accepts this
JSON (validated strictly with zod) or a plain list: one word per line, `#`
comment lines, an optional leading count line and `/FLAGS` suffixes as in a
Hunspell `.dic`. At most 5,000 words and 2 MB. Each word is classified as
new, duplicate (already accepted, or repeated in the file) or invalid. No word
is selected until the author ticks it or chooses "Select all new words"; the
server validates every picked word again and reports each one it skips.

### Backup and restore

Workspace backups (`docs/backup-format.md`) carry an optional
`dictionaryEntries` array and `counts.dictionaryEntries`. Backups made before
the dictionary existed have neither and restore with an empty dictionary.
Restore validates each entry (unique ID, same workspace, existing project,
valid word), preserves or remaps IDs like other rows, and recomputes
`wordKey`.

### AI proofreading

`prepareProofread` sends only the dictionary entries that occur in the text
being proofread, listed as accepted spellings (with "(match case)" where it
applies), and stores their number as `ProofreadRun.dictionaryTermCount`.
Suggestions that would change or remove an accepted word are rejected as
`dictionary_word`; a correction of a near-miss name *to* a dictionary word is
still allowed. See [assistant.md](assistant.md).

## Licences

Dependencies added for spell checking (no existing versions changed):

| Package | Version | Licence | Used for |
| --- | --- | --- | --- |
| `typo-js` | 1.4.0 | BSD-3-Clause (Chris Finke) | Hunspell-format checking and suggestions in the browser worker and on the server |
| `dictionary-en` | 4.0.0 | (MIT AND BSD) | en-US `index.aff` / `index.dic` |
| `dictionary-en-gb` | 3.0.0 | (MIT AND BSD) | en-GB `index.aff` / `index.dic` |

The `dictionary-*` packaging is MIT (Titus Wormer). The word lists come from
SCOWL (Kevin Atkinson; size 60, accents stripped) and the affix files from
Geoff Kuenning's Ispell; the full notice is the `license` file next to each
dictionary in [wooorm/dictionaries](https://github.com/wooorm/dictionaries)
(for example `dictionaries/en/license`). Those terms are permissive: use,
copying and redistribution are allowed provided the copyright and permission
notices accompany copies, and the Ispell portion keeps its BSD conditions
(retain the notice, mark modifications, no endorsement).

Story Loom does not copy or modify the word lists. They are installed by
`pnpm install` into `node_modules` (not committed) and served only to the
local browser. Anyone who redistributes the app bundled with these files must
include those licence notices. The typo-js package's own bundled dictionaries
are not used.
