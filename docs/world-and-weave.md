# World, series, and Weave

How Story Loom keeps setting notes, a shared series bible, plot beat sheets, and the story timeline. None of these rewrite manuscript text by themselves. Record saves still go through the usual editor, with protection and a new revision when the text changes.

In-app steps live under **How to use** (`/help`).

## Series bible

A reference can be marked for the series (`worldScope = "series"`) from **Upgrade this project**. Sibling books are other projects in the same workspace that share `Project.seriesName`.

- In a sibling book the reference is read-only and shows which book owns it.
- **Edit in** that home book opens the record where it can be changed.
- Search and context export in a sibling book can include those series references. They are not copied into the sibling book.
- Older backups omit `worldScope`. Restoring one leaves the record unassigned, which is how projects opened before series scope existed.

## Custom worldbuilding fields

Worldbuilding records stay the worldbuilding document type. A kind (place, organization, a name you type, and the rest) is optional metadata in structured fields. It filters the World list. It is not inferred from the title.

For a custom kind name, **Remember these fields** stores the field keys and labels for that book (`worldKindTemplates` in a workspace backup). Remembering the list does not rewrite the reference. Older backups omit the templates and restore with none.

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

A map needs an image already on a World record. Pins, routes, areas, and labels sit on layers you define. **Measure** and a route length use the scale bar you set and say the distance is estimated from that bar. Layer presets show all layers, hide all, or one group. Export SVG and Export PNG download the markers that are currently visible. Measuring and exporting do not save the map.
