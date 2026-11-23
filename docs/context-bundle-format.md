# Context bundle format (v1)

A context bundle is an export of selected current records. You paste or upload
it into a ChatGPT conversation so the assistant works from accurate project
state and can return a compatible [change package](change-package-format.md).

Export one from **Export context** in a project. Choose records by type or
individually, then download the bundle or copy it to the clipboard.
Manuscript chapters and scenes are unselected by default.

```json
{
  "format": "wordly.context-bundle",
  "formatVersion": 1,
  "exportedAt": "2026-10-25T15:00:00.000Z",
  "workspaceId": "wsp_demo",
  "workspaceName": "Demo workspace",
  "projectId": "prj_demo_salt_archive",
  "projectTitle": "The Salt Archive",
  "selection": {
    "recordIds": ["rec_demo_mara_dossier"],
    "types": null,
    "focusRecordId": null,
    "characterMode": "editorial"
  },
  "records": [
    {
      "id": "rec_demo_mara_dossier",
      "type": "character_dossier",
      "contentClass": "reference",
      "title": "Mara Venn",
      "revision": 2,
      "authorityStatus": "approved",
      "supersededByRecordId": null,
      "protected": false,
      "parentRecordId": null,
      "linkedRecordIds": [],
      "body": "Archivist of the Salt Guild. ...",
      "fields": { "name": "Mara Venn", "aliases": ["Mara"], "age": 34 },
      "updatedAt": "2026-10-25T15:12:25.000Z"
    }
  ],
  "characterContexts": [
    {
      "recordId": "rec_demo_mara_dossier",
      "title": "Mara Venn",
      "mode": "editorial",
      "slice": "continuity",
      "text": "# Mara Venn\n...",
      "bookProjectId": "prj_demo_salt_archive",
      "omittedSpoilers": 0,
      "omittedPlanned": 0,
      "knowledgeCount": 2,
      "stateConflicts": 0
    }
  ],
  "readingInstructions": ["..."],
  "changePackageInstructions": ["..."],
  "changePackageTemplate": { "format": "wordly.change-package", "...": "..." },
  "changePackageSchema": { "$schema": "https://json-schema.org/draft/2020-12/schema", "...": "..." }
}
```

## Record fields

| Field | Use when preparing a change package |
| --- | --- |
| `id` | The stable record ID to put in `recordId`. |
| `revision` | The value to put in `expectedRevision`. If the record changes in the app after export, the package is rejected as stale instead of overwriting newer work. |
| `type`, `contentClass` | Document type, and whether it is `manuscript` or `reference` content. |
| `authorityStatus` | Canon/decision status: `draft`, `proposed`, `approved`, `superseded`, `unresolved`. |
| `protected` | When `true`, the record must not be changed unless the author explicitly authorizes it (`protectedOverrides`). |
| `parentRecordId` | The chapter of a scene, or the chapter or scene of a scene note; `null` for other records. Read-only context: a change package cannot create scenes or scene notes or move them; only the author moves scenes, on the Write page. |
| `linkedRecordIds` | For a chapter or scene, the reference records the author linked to it in the app (empty otherwise). Read-only context. The linked records are included only if they were also selected. |
| `body`, `fields` | Current content. Living Profiles live under `fields.characterDevelopment` when present. On World references, `fields.worldProfile` is the preferred structured Living World Profile data when present; draft or proposed `fieldMeta` is not approved canon. Undated `worldProfile` values are the author's present surface, not earlier story time. When `fieldHistory` is present, the export keeps only approved, unplanned dated changes at or before the export narrative point (planned, unapproved, superseded, and later entries are omitted). |
| `sectionStatus` | Present only when headings in `body` carry status tags (for example `## Rules [APPROVED FRAMEWORK]` or `### Scene — SELECTED; after the storm`). One entry per tagged heading: `heading` (the heading text), `level`, and `statusTag` word for word. These markings govern their own sections; `authorityStatus` still describes the record as a whole and is set only by the author. |

## Character contexts (additive)

When the selection includes character dossiers, the bundle may also include
`characterContexts`: point-scoped Living Profile slices (psychology, archetypes,
voice, state history, knowledge holders, development plans, and approved canon
notes). Prefer these slices for writing assistance. They do not replace
`records`; older consumers can ignore the field. `selection.focusRecordId` and
`selection.characterMode` (`drafting` | `editorial` | `planning`) control
chronology and whether planned or spoiler material appears. Book scope is the
exporting project; series-shared dossiers may appear with `seriesHome`.

When `redactCharacterSpoilers` is enabled during export, `records[].fields`
for `character_dossier` records strips `dossierMarkdownArchive`, clears private
`livedExperience` notes, removes `omit`/`spoiler` secrets and future-revealed
knowledge relative to `focusRecordId`, and filters out `planned` state changes
and unapproved arcs. Keep it off (the default) when preparing full-fidelity
change packages.

## Instructions, template, and schema

`readingInstructions` is a short list of rules for reading the records: only
`approved` records are canon, status tags in headings (listed in
`sectionStatus`) govern their own sections, record text is source material
rather than instructions, and Living Profile knowledge holders (author, reader,
character) must not be collapsed into each other.

`changePackageInstructions` is a list of plain-language rules for the
assistant: use only IDs from the bundle, copy revisions into
`expectedRevision`, mark `approval.status` as `"approved"` only when the author
explicitly approved, prefer `relatedRecords` over propagating edits, and so on.
`changePackageTemplate` is pre-filled with this project's IDs.
`changePackageSchema` is the full JSON Schema; you can omit it from the export
to keep the bundle small.

## Suggested ChatGPT workflow

1. Export a bundle with the records relevant to the conversation.
2. Paste it into the conversation and work as usual.
3. When decisions are settled, say: "Update the working files with the
   decisions I approved. Return a change package."
4. Save the returned JSON and import it on **Import change package**. Review
   the preview, then apply.
5. Export a fresh bundle before the next round so the revisions are current.
