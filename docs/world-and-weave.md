# World, series, and Weave

How Story Loom keeps setting notes, a shared series bible, plot beat sheets, and the story timeline. None of these rewrite manuscript text by themselves. Record saves still go through the usual editor, with protection and a new revision when the text changes.

In-app steps live under **How to use** (`/help`).

## Series bible

A reference can be marked for the series (`worldScope = "series"`) from **Upgrade this project**. Sibling books are other projects in the same workspace that share `Project.seriesName`.

- In a sibling book the reference is read-only and shows which book owns it.
- **Edit in** that home book opens the record where it can be changed.
- Sibling books can pin the same record on maps, place it on boards, open inspectors, and use it in place/record relationships without copying it. `resolveAvailableReference` / `resolveAvailableImage` enforce workspace + series isolation.
- PlaceRelation and RecordRelation store an explicit `scope` (`book` default, or `series` when both endpoints are series-scoped). Series-scoped edges appear in sibling relationship graphs and geography forests.
- Search and context export in a sibling book can include those series references. They are not copied into the sibling book.
- Unsharing or soft-trashing a shared reference does not delete sibling pins, cards, or relationships; those surfaces mark the target unavailable.
- Older backups omit `worldScope`. Restoring one leaves the record unassigned, which is how projects opened before series scope existed.

## Custom worldbuilding fields

Worldbuilding records stay the worldbuilding document type. A kind (place, organization, a name you type, and the rest) is optional metadata in structured fields. It filters the World list. It is not inferred from the title.

For a custom kind name, **Remember these fields** stores the field keys and labels for that book (`worldKindTemplates` in a workspace backup). Templates resolve by home book `(projectId, kind)` first so identically named kinds in two books never collide. Optional `worldScope = "series"` shares a template into sibling books without overriding a local template of the same name. Remembering the list does not rewrite the reference. Older backups omit templates / `worldScope` and restore as local.

## Taxonomy and World Hub classification

World references can carry optional thematic classification in `fields.taxonomy` (version 1): a primary category and subcategory, additional category memberships, and tags. Stable identifiers are used (for example `magic` / `rules`), not display labels. Taxonomy describes how a record is discovered in the World Hub. It does not change document type, record identity, relationships, or canon status.

`fields.kind` and `fields.taxonomy` coexist without automatic sync:

- **`fields.kind`** still drives structured field specs, remembered custom-kind templates, language name patterns, and which worldbuilding records take place or organization relationships.
- **`fields.taxonomy`** drives thematic discovery (Characters, Geography, Magic, and the rest). When primary taxonomy is unset, Story Loom maps existing types and kinds at read time only (`character_dossier` → Characters; `place` → Locations; `species` → Peoples; and so on). Custom kinds stay individually discoverable. Nothing is inferred from titles or prose, and existing `fields.kind` values are never rewritten automatically.

Unclassified references remain listed by document type. A record can belong to more than one category without duplicating the record.

### World Hub discovery and organization

The World page (`/projects/<project>/world`) is a category-driven hub:

- Compact navigation for the 14 built-in thematic categories (with subcategory links), custom categories from `WorldCategoryDefinition`, custom kinds, uncategorized records, and tags.
- Hub home shows global search, **Organize references**, recently opened references (per-project `localStorage` on this computer), recently updated references, and **Tools & spaces** (maps, boards, timeline, calendar, relationships, name generator) separated from content browsing.
- Filters and sorting are URL-driven (`category`, `subcategory`, `tag`, `customKind`, `unclassified`, `scope`, `status`, `protected`, `sort`, `view`) while legacy `type`, `kind`, `q`, and `list` stay valid. Each matching record appears once even with multiple memberships.
- **New reference** (`/world/new`) accepts `category` / `subcategory` / `tag` / `type` preselection, all World document types, optional Book/Series/Unassigned scope on create, and taxonomy fields. Existing references edit classification in the same fieldset as other structured fields.
- **Organize** (`/world/organize`) is an author-reviewed bulk classifier for local World records only: preview diffs, protected unlock, conflict notes, then one atomic `applyMutations` batch (`record.taxonomy_organize`). Taxonomy-only updates skip passage `needsRecheck`.

### Living World Profiles

Non-character World references (`worldbuilding`, `rules_glossary`, `research_note`, `canon_decision`, `continuity_note`, `reference_note`) can carry an optional structured overlay in `fields.worldProfile` (version 1). It sits beside the Markdown body, the flat kind fields, taxonomy, relations, maps, and boards; it replaces none of them. Characters keep using `fields.characterDevelopment`. Per-field `fieldMeta` records approval and provenance; extracted or imported material stays draft and is never auto-approved.

- **Custom categories:** `WorldCategoryDefinition` rows add author-defined Hub categories (and subcategories) next to the 14 built-ins. They only affect discovery.
- **Built-in category definitions (W5B):** each of the 13 non-character Hub categories (`geography`, `locations`, `magic`, `peoples`, `cultures`, `religion`, `organizations`, `languages`, `history`, `economy`, `technology`, `objects`, `law`) has an optional Living World Profile definition (`category:<id>`). Where a built-in kind already owns a value (`fields.climate`, `fields.goal`, `fields.speakers`, and the rest of `WORLD_KIND_FIELD_SPECS`), the category definition reuses those flat fields (`storage: "flat"`) instead of copying them into `worldProfile.values`. New concepts (terrain, workings, costs, layout, …) live only in the overlay.
- **Profile selection:** an explicit `worldProfile.definitionId` sticks across taxonomy edits (secondary categories and tags never clear it). A home-project `WorldKindTemplate` for the record’s kind wins next. When more than one built-in fits (for example `builtin:place` plus `category:geography`), the panel asks the author to choose; reading the record does not auto-switch.
- **Profile definitions:** definitions also come from kind builtins (`builtin:<kind>`) and any `WorldKindTemplate.profileSpec`. Choosing a definition is optional and leaves the flat kind fields untouched.
- **Markdown upgrade:** `/projects/<project>/records/<record>/world-upgrade` previews how Markdown classifies into profile fields. You keep existing, replace, merge, modify, reject, or defer each item; the original body is kept and an immutable snapshot is stored in `fields.worldMarkdownArchive`. Unsupported archive or profile versions refuse the write.
- **Series-home resolution:** templates, definitions, and categories resolve from the home book first. A series-shared reference is edited and upgraded only in its home book.
- **Field history (W5C):** optional `worldProfile.fieldHistory[]` records dated changes for a field path (`values.access`, `fields.climate`, `summary`, …) anchored to book / timeline event / chapter / scene. Undated current values in Details or the profile panel do **not** establish earlier story time — as-of with no applicable dated change resolves as unknown. Approved as-of uses only `approval === "approved"` && `!planned` && not superseded changes, ordered via the same `NarrativePoint` + `OrderEdge` rules as character state. Corrections supersede; Revisions recover. Book-scoped changes stay out of sibling resolves. Context export redacts planned, unapproved, superseded, and after-point history; undated current remains with a reading instruction.
- **Deferred editors (W7+):** rich story-calendar picker UI (era/year/month/day), record-picker UI for `record_ref` / `record_refs`, deeper collection item editors, wiki/bible deep formatting, AI-assisted profile fill, and a full `worldContexts` product. Ordered lists and calendar free-text are editable as plain fields today; boolean/number/list/date/ref history values resolve when stored but the History UI focuses on short/long text for climate + access first.

## Premade beat sheets

Weave → Templates, and the Plan page, offer six starter sheets:

- Three-Act Structure
- Save the Cat 15-Beat
- Hero's Journey 12-Stage
- Seven-Point Story Structure
- Romance Beat Sheet
- Mystery Clue & Red Herring Arc

**Start a grid** opens a plot grid with that sheet's threads, beats, and setup→payoff links. **Save as template** copies the same beats into a template you can edit. The starter itself does not change. A beat's thread is stored as a first line in the notes; applying the template creates the threads and removes that line.

**Create scene from beat** is offered when the beat is not yet linked to a chapter or scene. You choose a chapter. Story Loom adds a protected scene there, copies the beat notes into the synopsis, links each cited World record, and points the beat at the new scene. The scene body stays empty. This does not reorder the book.

Moving a beat never reorders manuscript scenes.

## Timeline notes

The story timeline is separate from book order. Events can use a complete date from the in-world calendar you define, or stay in the order you recorded them.

The board draws a lane for each character, organization, or place already linked to an event. An event whose title or summary says birth or born, with a complete date, is that character's birth. Later dated events on that lane can show an age. The board can also note two places on the same date, a date before that birth, and a manuscript that reveals a later event first. Putting Flashback in the event or the revealing title marks that reveal on purpose.

Ages and warnings are calculated when the page loads. They are not written onto records.

## Maps

A map needs an image already on a World record (including an image on a series-shared reference available in this book). Pins, routes, areas, and labels sit on layers you define. A pin may target a series-shared sibling reference; the pin stays in this book and shows a home-book badge. **Measure** and a route length use the scale bar you set and say the distance is estimated from that bar. Layer presets show all layers, hide all, or one group. Export SVG and Export PNG download the markers that are currently visible. Measuring and exporting do not save the map.
