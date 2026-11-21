import Link from "next/link";
import { CopyButton } from "@/components/CopyButton";
import { contentClassOf, RECORD_TYPE_LABELS, RECORD_TYPES } from "@/domain/recordTypes";
import { AUTHORITY_STATUSES } from "@/domain/statuses";
import { formatBytes, MAX_IMAGE_BYTES, MAX_IMAGES_PER_RECORD } from "@/images/imageFormat";
import {
  ANALYZE,
  ASSISTANT,
  BACKUP,
  BOOK_ORDER,
  CHAPTER_IMPORT,
  COMPILE_PROFILE,
  CONNECTIONS,
  DICTIONARY,
  DRAFT,
  EXPORT,
  INFOBOX,
  KIND_TEMPLATE,
  REFERENCE_META,
  SERIES,
  CONTINUITY,
  FILE,
  HISTORY,
  HOME,
  IMAGES,
  MANUSCRIPT_REPLACE,
  MANUSCRIPT_SEARCH,
  MARKDOWN_IMPORT,
  MENTIONED_BY,
  NAV,
  ONBOARDING,
  PACKAGE_IMPORT,
  PDF,
  PROJECT_SEARCH,
  PROOFREAD,
  READ_BOOK,
  RECORD,
  RECORD_RENAME,
  REVIEW,
  SHELL,
  SELECTION_ASSIST,
  SPELLING,
  STYLE_CHECK,
  TEXT_APPEARANCE,
  THEME,
  TRASH,
  UPGRADE,
  WEAVE,
  WORLD,
  WORLD_KIND,
  WRITE,
  WRITING,
  WRITING_GOALS,
  MANUSCRIPT_ANNOTATIONS,
  MANUSCRIPT_STRUCTURE,
  SCENE_META,
  XREF,
  XREF_CHECK,
} from "@/ui/labels";
import { WORLD_CATEGORY_LABELS, WORLD_TYPES } from "@/ui/world";
import { SPELL_CHECKERS, SPELLING_LANGUAGES } from "@/writing/spelling";
import { APP_URL, HELP_SECTIONS, helpHref, STATUS_DESCRIPTIONS, type HelpAnchor, type HelpScript } from "./outline";

/*
 * Text of the "How to use" page. Describe only what the app does today and
 * quote interface labels through src/ui/labels.ts. PROJECT_RULES.md requires
 * updating this file whenever a documented workflow or label changes.
 */

export const CHATGPT_INSTRUCTION =
  "Use this Story Loom context export as the current source. Keep proposed ideas separate from approved decisions. " +
  "When I ask you to prepare updates, follow the included package format and use the supplied record IDs and " +
  "saved-version numbers. Do not change manuscript prose unless I explicitly request it.";

const REFERENCE_TYPES = RECORD_TYPES.filter((t) => contentClassOf(t) === "reference");

function titleOf(id: HelpAnchor): string {
  for (const s of HELP_SECTIONS) {
    if (s.id === id) return s.title;
    const child = "children" in s ? s.children.find((c) => c.id === id) : undefined;
    if (child) return child.title;
  }
  return id;
}

/** An interface label, shown the way the author sees it on screen. */
function L({ children }: { children: React.ReactNode }) {
  return <strong>{children}</strong>;
}

function Cmd({ script, args }: { script: HelpScript; args?: string }) {
  return <code>{`pnpm ${script}${args ? ` ${args}` : ""}`}</code>;
}

function See({ anchor }: { anchor: HelpAnchor }) {
  return <Link href={helpHref(anchor)}>{titleOf(anchor)}</Link>;
}

function Section({ id, children }: { id: HelpAnchor; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="panel">
      <h2 id={`${id}-heading`}>{titleOf(id)}</h2>
      {children}
      <p className="help-back">
        <a href="#contents">Back to contents</a>
      </p>
    </section>
  );
}

function Sub({ id, children }: { id: HelpAnchor; children: React.ReactNode }) {
  return (
    <>
      <h3 id={id}>{titleOf(id)}</h3>
      {children}
    </>
  );
}

export function HelpContent() {
  return (
    <div className="help-body">
      <Section id="quick-start">
        <ol>
          <li>Open a terminal in the Story Loom folder.</li>
          <li>
            Run <Cmd script="dev" />. Leave this terminal open while you work.
          </li>
          <li>
            Open <a href={APP_URL}>{APP_URL}</a> in your browser.
          </li>
          <li>
            Choose <L>{HOME.newWorkspaceHeading}</L>, type a name, and choose <L>{HOME.createWorkspace}</L>.
          </li>
          <li>
            In that workspace, choose <L>{HOME.newManuscript}</L>, type a title in <L>{HOME.projectTitlePlaceholder}</L>,
            and choose <L>{HOME.addProject}</L>. The project opens.
          </li>
          <li>
            Choose <L>{NAV.importMarkdown}</L> to bring in your notes, or use <L>{RECORD.newRecordHeading}</L> to write
            one yourself.
          </li>
          <li>
            Before big changes, open <L>{SHELL.settings}</L> at the bottom of the left navigation, choose{" "}
            <L>{SHELL.backups}</L>, and download a backup.
          </li>
        </ol>
        <p>
          To stop the app, press <kbd>Ctrl</kbd>+<kbd>C</kbd> in the terminal. Your work is already saved.
        </p>
        <p>
          After a project opens, an on-demand guided checklist offers one real task at a time (continue writing, keep a
          reference handy, board, map, plot beat, assistant). See <See anchor="optional-features" />. You can skip it;
          nothing is required.
        </p>

        <Sub id="whats-new">
          <p>
            Recent Story Loom additions are optional: nothing turns on until you use it, and older backups still restore.
            Jump to the topic you care about:
          </p>
          <h4>Manuscript and tools</h4>
          <ul>
            <li>
              <See anchor="saved-versions" />: save an earlier version again as a new revision (restore).
            </li>
            <li>
              <See anchor="manuscript-replace" /> and <See anchor="record-rename" />: reviewed replace and character
              rename across the manuscript.
            </li>
            <li>
              <See anchor="panels-focus" />, <See anchor="draft-comparison" />, and <See anchor="local-recovery" />: layout,
              side-by-side drafts, and an unsaved copy kept in this browser.
            </li>
            <li>
              <See anchor="manuscript-style-check" />, <See anchor="writing-goals" />, and{" "}
              <See anchor="manuscript-annotations" />: local style checks, goals, synopsis cards, and margin comments.
            </li>
            <li>
              <See anchor="pdf-export" />: shared compile settings; export PDF, DOCX, or EPUB.
            </li>
            <li>
              <See anchor="selection-assist" />: optional AI assist on a selection (suggestion only).
            </li>
            <li>
              <See anchor="dictionary" />: multi-word phrase entries; <See anchor="project-search" />: search the whole
              project; <See anchor="mentioned-by" />: backlinks on reference pages.
            </li>
          </ul>
          <h4>World and codex</h4>
          <ul>
            <li>
              <See anchor="world-kinds" /> and <See anchor="world-series" />: optional kinds, custom field lists, and series
              references you can read in a sibling book.
            </li>
            <li>
              <See anchor="world-continuity" />: open questions and items that need a recheck, in one list.
            </li>
            <li>
              <See anchor="weave-templates" />: premade beat sheets, and a scene created from a beat.
            </li>
            <li>
              <See anchor="record-relations" /> and <See anchor="relationship-views" />: explicit relationships and graph
              or tree views.
            </li>
            <li>
              <See anchor="world-calendar" /> and <See anchor="story-events" />: in-world calendar and optional structured
              event dates.
            </li>
            <li>
              Reference <See anchor="reference-page" />: <L>{INFOBOX.heading}</L> summary at the top when reading.
            </li>
            <li>
              <See anchor="world-maps" />: author map layers, labelled scale bar, geography from <em>part_of</em>.
            </li>
            <li>
              <See anchor="world-names" />: suggest names from language patterns (dictionary or dossier only when you ask).
            </li>
          </ul>
          <h4>Backups</h4>
          <ul>
            <li>
              <See anchor="backup-mirror" />: optionally copy each full backup to a folder (for example Dropbox).
            </li>
          </ul>
        </Sub>
      </Section>

      <Section id="getting-started">
        <p>
          Story Loom keeps your novel&apos;s working material in one place: manuscript chapters, outlines, character
          dossiers, worldbuilding, canon decisions, continuity notes, and reference notes. Each item is called a{" "}
          <em>record</em>. Every time you save a record, the earlier saved versions are kept.
        </p>
        <h3>Where your work is stored</h3>
        <p>
          Everything is stored in one database file on this computer. By default it is <code>prisma/dev.db</code>{" "}
          inside the Story Loom folder. The <code>.env</code> file says which file is used. To see the exact path,
          run <Cmd script="db:info" />. It only reads; it changes nothing.
        </p>
        <p>
          There is no cloud sync and no account. The app only answers on this computer (<code>127.0.0.1</code>), so
          other devices cannot open it. ChatGPT cannot see or change anything in the app.
        </p>
        <h3>Opening the app</h3>
        <p>The app must be running before the page will load.</p>
        <ol>
          <li>Open a terminal in the Story Loom folder.</li>
          <li>
            Run <Cmd script="dev" /> (<code>npm run dev</code> also works).
          </li>
          <li>Wait until the terminal says it is ready.</li>
          <li>
            Open <a href={APP_URL}>{APP_URL}</a>.
          </li>
        </ol>
        <p>
          If port 2112 is already taken, the terminal says so and the app does not start on another port. Stop whatever
          is using 2112, then run the command again.
        </p>
        <p>
          If the terminal says another dev server is already running, the app is already open from an earlier start.
          Open the address it shows, or press Ctrl+C in that server&apos;s terminal and start again.
        </p>
        <p>Use the same steps every time you come back.</p>
        <details>
          <summary>First-time setup on a new computer</summary>
          <p>You need Node 24 or later and pnpm 10 or later.</p>
          <ol>
            <li>
              Copy <code>.env.example</code> to a new file named <code>.env</code>.
            </li>
            <li>
              Run <code>pnpm install</code>.
            </li>
            <li>
              Run <Cmd script="db:setup" />. It backs up any existing database first, prepares the database, and adds a
              demo project called &ldquo;The Salt Archive&rdquo; if it is missing. It never deletes your work, so it is
              safe to run again.
            </li>
            <li>
              Run <Cmd script="dev" />.
            </li>
          </ol>
        </details>
      </Section>

      <Section id="optional-features">
        <p>
          When a project is open, Story Loom can show an on-demand checklist titled <L>{ONBOARDING.heading}</L>. It walks
          one task at a time: <L>{ONBOARDING.taskWrite}</L>, <L>{ONBOARDING.taskCodex}</L>, <L>{ONBOARDING.taskBeats}</L>,{" "}
          <L>{ONBOARDING.taskWorld}</L>, <L>{ONBOARDING.taskTimeline}</L>, <L>{ONBOARDING.taskSeries}</L>, and{" "}
          <L>{ONBOARDING.taskPublish}</L>.{" "}
          <L>{ONBOARDING.skip}</L> pauses and keeps your place so <L>{ONBOARDING.resume}</L> can restore it.{" "}
          <L>{ONBOARDING.dismiss}</L> hides the guide permanently until you choose <L>{ONBOARDING.showAgain}</L>. Nothing
          is written to your records; progress is stored in this browser only.
        </p>
        <p>
          Older projects open and edit as before until you use these features. Change packages, backups and history keep
          working the same way.
        </p>

        <Sub id="optional-upgrade">
          <p>
            <L>{NAV.upgradeProject}</L> under <L>{SHELL.projectTools}</L> is optional Series, Book and Draft metadata.
            Preview first, then apply; text, revisions, images and links stay unchanged. Full steps:{" "}
            <See anchor="upgrade-project" />.
          </p>
        </Sub>

        <Sub id="optional-pins">
          <p>
            On <L>{SHELL.write}</L>, the <L>{WRITE.references}</L> tab&apos;s <L>{WRITE.pinnedReferences}</L> list keeps
            dossiers and world notes handy beside the draft. Pins are not scene links and do not by themselves authorize
            sending text to the assistant. Details: <See anchor="scene-context" />.
          </p>
        </Sub>

        <Sub id="optional-boards">
          <p>
            <L>{WORLD.boards}</L> under <L>{SHELL.world}</L> place references, images and freeform notes on a board.
            Selecting a card opens its source in the rail. Ask about a board previews linked records before the
            assistant. Details: <See anchor="world-boards" />.
          </p>
        </Sub>

        <Sub id="optional-maps">
          <p>
            <L>{WORLD.maps}</L> use an uploaded image or an existing reference image as a backdrop. Markers can be points,
            routes, areas, or labels; they can link a reference, another map, or both. Author-defined{" "}
            <L>{WORLD.mapLayers}</L>, an optional <L>{WORLD.mapScale}</L> bar, and a{" "}
            <L>{WORLD.mapGeography}</L> list from place relationships are optional.{" "}
            <L>{WORLD.mapModeBrowse}</L> pans; <L>{WORLD.mapModeEdit}</L> places and edits markers. Details:{" "}
            <See anchor="world-maps" />.
          </p>
        </Sub>

        <Sub id="optional-calendar">
          <p>
            <L>{WORLD.worldCalendar}</L> on <L>{SHELL.world}</L> defines months, day counts, and eras once per project.
            On <L>{WORLD.storyTimeline}</L> you can still use free-text times; structured dates are optional and never
            override explicit earlier/later links by themselves. Details: <See anchor="world-calendar" /> and{" "}
            <See anchor="story-events" />.
          </p>
        </Sub>

        <Sub id="optional-relationships">
          <p>
            Place and record relationships are explicit rows you add on reference pages—not inferred from mentions or pin
            positions. <L>{WORLD.relationships}</L> on <L>{SHELL.world}</L> graphs them and offers family, organization,
            and geography trees plus a list view. Details: <See anchor="record-relations" />,{" "}
            <See anchor="place-relations" />, and <See anchor="relationship-views" />.
          </p>
        </Sub>

        <Sub id="optional-names">
          <p>
            On a worldbuilding record with kind <em>language</em>, optional syllable and pattern fields feed{" "}
            <L>{WORLD.nameGenerator}</L> on <L>{SHELL.world}</L>. The tool only suggests names; you choose{" "}
            <L>{WORLD.nameGeneratorAddDictionary}</L> or <L>{WORLD.nameGeneratorCreateDossier}</L> for each one. Details:{" "}
            <See anchor="world-names" /> and <See anchor="world-kinds" />.
          </p>
        </Sub>

        <Sub id="optional-rewrites">
          <p>
            <L>{DRAFT.startRewrite}</L> keeps a Zero draft and adds an Author manuscript beside it. Set{" "}
            <L>{DRAFT.setDefaultReading}</L> and <L>{DRAFT.setDefaultExport}</L> explicitly so Read and PDF export use the
            draft you intend. Details: <See anchor="author-rewrite" /> and <See anchor="pdf-export" />.
          </p>
        </Sub>
      </Section>

      <Section id="navigation">
        <p>
          The dark column on the left is the main navigation. <L>{SHELL.write}</L>, <L>{SHELL.plan}</L>,{" "}
          <L>{SHELL.world}</L> and <L>{SHELL.assistant}</L> stay in the rail.           <L>{SHELL.help}</L>, the theme button, <L>{SHELL.settings}</L>, and <L>{SHELL.collapse}</L> are at the bottom.{" "}
          <L>{SHELL.settings}</L> holds the project switcher, <L>{SHELL.backups}</L>, <L>{SHELL.connections}</L> and{" "}
          <L>{SHELL.trash}</L>.
          URLs are unchanged.
        </p>
        <ul>
          <li>
            <L>{SHELL.write}</L>: the project&apos;s manuscript chapters, scenes and scene notes. See{" "}
            <See anchor="write" />.
          </li>
          <li>
            <L>{SHELL.plan}</L>: story grids. Chapter outlines and story architecture are under{" "}
            <L>{WEAVE.planningReferences}</L> on that page. The address is still <code>/plan</code>.
          </li>
          <li>
            <L>{SHELL.world}</L>: character dossiers, worldbuilding, canon decisions, continuity notes and reference
            notes.
          </li>
          <li>
            <L>{SHELL.assistant}</L>: the optional assistant. See <See anchor="assistant" />.
          </li>
          <li>
            <L>{SHELL.settings}</L> → <L>{SHELL.backups}</L>: the <L>{BACKUP.heading}</L> page.
          </li>
          <li>
            <L>{SHELL.settings}</L> → <L>{SHELL.connections}</L>: the <L>{CONNECTIONS.heading}</L> page. See{" "}
            <See anchor="chatgpt-direct" />.
          </li>
          <li>
            <L>{SHELL.settings}</L> → <L>{SHELL.trash}</L>: what you have moved to the Trash. See <See anchor="trash" />.
          </li>
          <li>
            <L>{NAV.projectSearch}</L> in project tools (or settings): search saved text across World, the manuscript,
            maps, events, and more. See <See anchor="project-search" />.
          </li>
          <li>
            <L>{SHELL.help}</L> at the bottom of the left column: this page.
          </li>
        </ul>
        <p>
          <L>{SHELL.write}</L>, <L>{SHELL.plan}</L>, <L>{SHELL.world}</L> and <L>{SHELL.assistant}</L> open pages of one
          project: the project you are in, or the last one you opened. Before you have opened a project they are greyed
          out. <L>{NAV.brand}</L> at the top goes to the home page with all workspaces.
        </p>
        <h3>Switch project</h3>
        <ol>
          <li>
            Open <L>{SHELL.settings}</L> at the bottom of the left column and choose a project. The list shows each
            project&apos;s title, its workspace, its number of manuscript chapters, and the saved word count of its
            manuscript chapters and scenes.
          </li>
          <li>
            Choose a project from the list. Each entry also shows how many records the project has.{" "}
            <L>{SHELL.allWorkspaces}</L> opens the home page.
          </li>
        </ol>
        <p>The counts use saved text. Changes you have not saved yet are not included.</p>
        <h3>Project pages</h3>
        <p>Inside a project, a second column lists:</p>
        <ul>
          <li>
            <L>{NAV.records}</L>, with the number of records.
          </li>
          <li>
            On a chapter outline or story architecture record, the records of that part by type. Choose a type heading,
            such as <L>{RECORD_TYPE_LABELS.chapter_outline}</L>, to show or hide its list, then choose a title to open
            it. The <L>{SHELL.plan}</L> landing does not show that second column.{" "}
            <L>{WEAVE.planningReferences}</L> on the page lists the same records, and <L>{SHELL.projectTools}</L> stays
            on the page. Grid editors, templates, and analysis keep the project column. On{" "}
            <L>{SHELL.world}</L> and its records, <L>{WORLD.worldSections}</L> (see <See anchor="world-nav" />
            ). On <L>{SHELL.write}</L> and its records, the chapters and scenes (see <See anchor="manuscript-panel" />
            ).
          </li>
          <li>
            <L>{SHELL.projectTools}</L>, grouped as <L>{SHELL.toolsBringIn}</L> (
            <L>{NAV.importPackage}</L>, <L>{NAV.importMarkdown}</L>, <L>{NAV.importChapters}</L>),{" "}
            <L>{SHELL.toolsReadExport}</L> (<L>{NAV.readBook}</L>, <L>{NAV.exportContext}</L>, <L>{NAV.exportPdf}</L>), and{" "}
            <L>{SHELL.toolsMaintain}</L> (<L>{NAV.history}</L>, <L>{NAV.dictionary}</L>, <L>{NAV.crossRefCheck}</L>,{" "}
            <L>{NAV.upgradeProject}</L>; see <See anchor="cross-reference-check" />
            ). A number beside <L>{NAV.history}</L> is how many open review items the project has.
          </li>
        </ul>
        <h3>Smaller windows</h3>
        <p>
          Choose <L>{SHELL.collapse}</L> at the bottom of the left column to show icons only. Point at an icon, or move
          to it with <kbd>Tab</kbd>, to see its name. Choose <L>{SHELL.expand}</L> to bring the names back. On
          medium-width windows the column shows icons only until you expand it.
        </p>
        <h3>Light and dark theme</h3>
        <p>
          The theme button at the bottom of the left column, above <L>{SHELL.settings}</L>, shows the current theme. Each
          time you choose it, it moves to the next one: <L>{THEME.names.light}</L>, <L>{THEME.names.dark}</L>, then{" "}
          <L>{THEME.names.system}</L>, which follows your computer&apos;s light or dark setting. The theme changes the
          colours of every page. It does not change your text, the saved records, printed pages or PDF exports, which
          always use light colours.
        </p>
        <p>
          On a narrow window, such as a phone-sized one, both columns are hidden. Choose the menu button (three lines,
          top left) for the main navigation, and <L>{SHELL.openProjectMenu}</L> above the page for the project&apos;s
          pages. On World, that button is labeled <L>{WORLD.worldSections}</L> and names the surface you are on.
          Choose a page, press <kbd>Esc</kbd>, or choose the close button to close them again. Focus returns to the
          button that opened the menu.
        </p>
        <p>
          This browser remembers whether the navigation is collapsed, the theme, and which project you opened last. It
          keeps them as small cookies. No record text is stored in them.
        </p>
      </Section>

      <Section id="workspaces">
        <p>
          A <em>workspace</em> holds one or more projects. A <em>project</em> is one book (the home page calls it a manuscript).
          Every record belongs to one project. The home page is <L>{HOME.heading}</L>. The featured manuscript is the
          project you opened last in this browser, or otherwise the first of your own projects. It shows the series name
          when you have set one, otherwise the workspace name, then the chapter count and the saved word count of the
          manuscript chapters and scenes. <L>{HOME.openManuscript}</L> opens <L>{SHELL.write}</L>. It does not resume a
          saved place in the book.
        </p>
        <h3>Cover image</h3>
        <p>
          Each manuscript starts with a drawn cover. The drawing is chosen from the manuscript itself, so renaming it
          does not change the picture. The words on a drawn cover follow the series name, or the workspace name when no
          series is set, and the manuscript title.
        </p>
        <ol>
          <li>
            On the home page, choose the actions button (three dots) on that manuscript, then <L>{HOME.changeCover}</L>.
          </li>
          <li>
            Use <L>{FILE.chooseFile}</L> to pick a PNG, JPEG, GIF or WebP file, up to 10 MB. The best size is 440 ×
            620 pixels (220:310). A different shape is cropped from the center. Then <L>{HOME.saveCover}</L>. The same
            picture is used for the large cover and the small one. The title stays beside the picture.
          </li>
          <li>
            Choose <L>{HOME.useDrawnCover}</L> in that same dialog to remove the picture and return to the drawing.
          </li>
        </ol>
        <p>
          Moving the manuscript to the Trash hides its cover with it. Restoring the manuscript brings the picture back.
          Deleting the manuscript permanently removes the picture. A cover is not part of the manuscript text, and
          changing it does not create a revision.
        </p>
        <h3>Create a workspace</h3>
        <ol>
          <li>
            Choose <L>{NAV.brand}</L> at the top of the left navigation to go to the home page.
          </li>
          <li>
            Choose <L>{HOME.newWorkspaceHeading}</L> and type a name.
          </li>
          <li>
            Choose <L>{HOME.createWorkspace}</L>. The workspace appears under <L>{HOME.yourWorkspaces}</L>.
          </li>
        </ol>
        <h3>Create a project</h3>
        <ol>
          <li>
            In the workspace, choose <L>{HOME.newManuscript}</L>.
          </li>
          <li>
            Type a title in <L>{HOME.projectTitlePlaceholder}</L> and choose <L>{HOME.addProject}</L>. The project opens.
          </li>
        </ol>
        <h3>Open a project</h3>
        <p>
          On the home page, choose <L>{HOME.open}</L> beside the manuscript, or <L>{HOME.openManuscript}</L> on the
          featured one. You can also choose it from <L>{SHELL.settings}</L> at the bottom of the left navigation. The
          project&apos;s pages are listed in the second column. See <See anchor="navigation" />.
        </p>
        <p>
          The invented demo workspace, when it is present, is grouped under <L>{HOME.examples}</L>. Each of those
          manuscripts shows <L>{HOME.exampleManuscript}</L> under the title. Your own workspaces stay under{" "}
          <L>{HOME.yourWorkspaces}</L> and show their chapter and word counts. A title that contains words such as
          &ldquo;Demo&rdquo; or &ldquo;Archive&rdquo; does not move a workspace into <L>{HOME.examples}</L>. On this
          page, <L>{SHELL.write}</L> is marked in the left column.
        </p>
        <h3>Try things in a separate trial workspace</h3>
        <p>
          Create a workspace called, for example, &ldquo;Trial&rdquo;, and add a test project to it. Imports and updates in
          one project never change another project. This is a safe place to try an import or a change package first.
        </p>
        <p className="warning">
          Rename a workspace or manuscript from its menu on the home page. The new name is written to History for each
          live manuscript in that workspace, or for that manuscript. Record text is not changed. (A record&apos;s title can
          still be changed when you edit it and
          save.) When you no longer need a trial workspace, open its actions menu (the … button) and choose{" "}
          <L>{TRASH.moveWorkspace}</L>. See <See anchor="trash" />.
        </p>

        <Sub id="upgrade-project">
          <p>
            Under <L>{SHELL.projectTools}</L>, <L>{NAV.upgradeProject}</L> lets you optionally name the series and book,
            choose Zero draft or Author manuscript, put chapters into named groups, and say whether each World record
            applies to this book or the whole series. Projects with none of these assignments open and edit exactly as
            before.
          </p>
          <ol>
            <li>
              Open the project and choose <L>{NAV.upgradeProject}</L>.
            </li>
            <li>
              Fill in what you want. Leave fields blank to keep them unassigned. Chapters left out of every group stay
              ungrouped; their scenes stay with them.
            </li>
            <li>
              Choose <L>{UPGRADE.preview}</L> for a read-only summary. Nothing is written yet.
            </li>
            <li>
              If the summary is right, choose <L>{UPGRADE.apply}</L>. The change is applied all at once. Chapter text,
              revisions, images and links are not changed.
            </li>
          </ol>
          <p>
            If the project changes between preview and apply (for example another edit updates assignments, or a chapter
            is removed), apply is refused and you preview again. Applying the same assignments a second time writes
            nothing.
          </p>
          <p>
            Upgrading does not change how change packages apply: stale revisions, protection and idempotency still
            refuse or accept packages the same way. See <See anchor="change-package-import" />.
          </p>
        </Sub>
      </Section>

      <Section id="importing">
        <p>
          You can bring in notes written elsewhere as Markdown files (<code>.md</code> or <code>.markdown</code>). Each
          file becomes one reference record. You can import up to 200 files at once, up to 5 MB each. Chapter files are
          imported separately, with <L>{NAV.importChapters}</L>; see <See anchor="import-chapters" />.
        </p>
        <ol>
          <li>
            Open the project and choose <L>{NAV.importMarkdown}</L>.
          </li>
          <li>
            Use the file picker to choose the files you want to import. You can check them before anything is saved.
          </li>
          <li>
            Read each file&apos;s preview. Open <L>{MARKDOWN_IMPORT.previewContent}</L> to see the start of the text.
          </li>
          <li>
            Check each title. The app suggests the file&apos;s first <code># heading</code>, or the filename. You can
            change it.
          </li>
          <li>
            For each file, choose a type, a canon status, and protection. Nothing is chosen for you, and nothing is
            guessed from the filename.
          </li>
          <li>
            To give many files the same choices, use <L>{MARKDOWN_IMPORT.setForAll}</L>, then choose{" "}
            <L>{MARKDOWN_IMPORT.applyToAll}</L>. You can still change single files afterwards.
          </li>
          <li>
            If a file is marked as a possible duplicate, choose what to do in its action menu. See{" "}
            <See anchor="duplicates" />.
          </li>
          <li>
            Optionally, type where the files came from in <L>{MARKDOWN_IMPORT.provenanceLabel}</L>. It is kept in each
            record&apos;s history.
          </li>
          <li>
            Choose <L>{MARKDOWN_IMPORT.importFiles("N")}</L>.
          </li>
        </ol>
        <p>
          The button stays unavailable until every file has all its choices. Until then you see:{" "}
          <em>{MARKDOWN_IMPORT.incomplete}</em>
        </p>
        <p>
          After importing, you see <em>{MARKDOWN_IMPORT.done}</em> and a table linking to each record. If anything is
          wrong, you see <em>{MARKDOWN_IMPORT.rejected}</em> with the problems listed beside each file. The files are
          saved together or not at all, so fix the problems and import again.
        </p>
        <details>
          <summary>Which types can be imported</summary>
          <ul>
            {REFERENCE_TYPES.map((t) => (
              <li key={t}>{RECORD_TYPE_LABELS[t]}</li>
            ))}
          </ul>
          <p>
            {RECORD_TYPE_LABELS.manuscript_chapter} cannot be imported. To add a chapter, use{" "}
            <L>{RECORD.newRecordHeading}</L> on the project page and paste the text.
          </p>
        </details>

        <Sub id="canon-status">
          <p>
            <em>Canon</em> is an established fact about the story. A record&apos;s canon status says how settled it is:
          </p>
          <dl>
            {AUTHORITY_STATUSES.map((s) => (
              <div key={s}>
                <dt>{s}</dt>
                <dd>{STATUS_DESCRIPTIONS[s]}</dd>
              </div>
            ))}
          </dl>
          <p>
            Only <L>approved</L> means canon. You always choose the status; the app never decides it.
          </p>
          <p>
            The status covers the whole record. If a file mixes approved facts with ideas you have not settled, mark its
            sections in the headings, such as <code>[APPROVED FRAMEWORK]</code> or <code>[WORKING PROPOSAL]</code>: the app
            shows those tags and tells the assistant and ChatGPT that they govern their sections (see{" "}
            <See anchor="section-status" />). Otherwise choose <L>proposed</L> for the whole file, or split it into two
            files before importing so each part gets its own status.
          </p>
        </Sub>

        <Sub id="duplicates">
          <p>
            A file is marked as a possible duplicate when it has the same text or title as an existing record, the same
            filename as an earlier import, a filename that differs only by version, date, status words or a number prefix
            (<em>same document, another version</em>; see <See anchor="new-versions" />), or matches another file in the
            same batch. Use the link to open the existing record in a new tab and compare.
          </p>
          <p>For each such file, choose one action:</p>
          <ul>
            <li>
              <L>{MARKDOWN_IMPORT.createNew}</L> keeps both. The file becomes a separate record.
            </li>
            <li>
              <L>{MARKDOWN_IMPORT.replacePrefix} &ldquo;title&rdquo; (rev N)</L> saves the file as a new saved version
              of that record. The earlier versions are kept.
            </li>
            <li>
              <L>{MARKDOWN_IMPORT.skip}</L> leaves this file out.
            </li>
          </ul>
          <p>Nothing is saved until you choose the import button.</p>
          <details>
            <summary>What a replacement changes, and what it keeps</summary>
            <p>A replacement changes the record&apos;s title, its text, and its canon status.</p>
            <p>It keeps:</p>
            <ul>
              <li>The record ID, so links and earlier ChatGPT references still point to it.</li>
              <li>
                The type. Choose the record&apos;s current type, or the import will be refused.
              </li>
              <li>
                The structured fields. A Markdown file only brings text, so fields such as aliases are left as they
                were. Edit them on the record page if needed.
              </li>
              <li>
                Protection. A protected record stays protected, and you must tick the box that starts{" "}
                <em>I confirm replacing</em> before importing. Choosing <L>Protected</L> protects a record that was
                not protected. Choosing <L>Not protected</L> never removes protection.
              </li>
            </ul>
            <p>If the file is identical to the record, the import is refused and suggests skipping it.</p>
          </details>
        </Sub>
      </Section>

      <Section id="editing">
        <h3>Find a record</h3>
        <p>
          The project&apos;s <L>{NAV.records}</L> page lists records grouped by type, in title order. Choose a type
          heading to show or hide that group. Each row shows the
          record ID, its canon status, <L>rev N</L> (the number of its current saved version), and{" "}
          <L>manuscript</L> or <L>protected</L> labels where they apply. Choose a title to open it.
        </p>
        <p>
          <L>{SHELL.write}</L> and <L>{SHELL.world}</L> in the left navigation show lists for their record types.{" "}
          <L>{SHELL.plan}</L> opens the grid library. Chapter outlines and story architecture are under{" "}
          <L>{WEAVE.planningReferences}</L> there, and in the second column when one of those records is open.
        </p>
        <h3>Create a record</h3>
        <ol>
          <li>
            On the <L>{NAV.records}</L> page, or on <L>{SHELL.write}</L> or <L>{SHELL.world}</L>, go to{" "}
            <L>{RECORD.newRecordHeading}</L>. On <L>{SHELL.plan}</L>, <L>{RECORD.newRecordHeading}</L> is inside{" "}
            <L>{WEAVE.planningReferences}</L>. The type starts as the first type of that part, for example{" "}
            <L>{RECORD_TYPE_LABELS.manuscript_chapter}</L> on <L>{SHELL.write}</L> and{" "}
            <L>{RECORD_TYPE_LABELS.chapter_outline}</L> on <L>{SHELL.plan}</L>. In a World category, it starts as that
            category&apos;s type.
          </li>
          <li>
            Choose a <L>Type</L> and a <L>Status</L>. The status starts as <L>draft</L>.
          </li>
          <li>
            Type a <L>Title</L> and the text in <L>{RECORD.bodyLabel}</L>.
          </li>
          <li>
            Choose <L>{RECORD.createRecord}</L>. The new record opens.
          </li>
        </ol>
        <p>
          The text is stored exactly as you type it. Markdown formatting such as <code>**bold**</code> is kept. In the
          editor you see the Markdown itself; outside the editor, a reference document&apos;s page shows it formatted
          (see <See anchor="reference-page" />
          ).
        </p>
        <details>
          <summary>What are structured fields?</summary>
          <p>
            Structured fields are optional extra details written in a strict format called JSON, for example{" "}
            <code>{`{"name": "Mara Venn", "aliases": ["Mara"]}`}</code>. The app uses <code>name</code> and{" "}
            <code>aliases</code> to find other records that mention this one when a change package is applied. Leave the
            box empty if you do not need it. If the format is wrong, the save is refused with a message.
          </p>
        </details>
        <h3>Edit a record</h3>
        <ol>
          <li>
            Open the record. On a reference document&apos;s page, choose <L>{WORLD.edit}</L>.
          </li>
          <li>
            In <L>{RECORD.editHeading}</L>, change the <L>Title</L>, the text, or the structured fields.
          </li>
          <li>
            Choose <L>{RECORD.saveAsRevision("N")}</L>.
          </li>
        </ol>
        <p>
          Nothing is stored as a revision until you choose that button. This browser may keep a local copy of unsaved
          text until you save or discard it. After saving you see{" "}
          <em>Saved as revision N.</em> If the save is refused, your typing stays on screen and the reason is shown.
        </p>
        <p>
          Spelling, word counts, and find and replace are in the <L>{WRITING.toolsHeading}</L> box above the text. See{" "}
          <See anchor="writing-tools" />.
        </p>
        <h3>Change the canon status</h3>
        <ol>
          <li>
            In <L>{RECORD.statusHeading}</L>, choose a new <L>Status</L>.
          </li>
          <li>
            For <L>superseded</L>, you can type the ID of the record that replaces it in{" "}
            <L>{RECORD.supersededByLabel}</L>.
          </li>
          <li>
            Choose <L>{RECORD.updateStatus}</L>. This saves a new version.
          </li>
        </ol>

        <Sub id="saved-versions">
          <p>
            Every save creates a new saved version. The app calls these <em>revisions</em> and numbers them 1, 2, 3, and
            so on. Earlier versions are never changed or removed.
          </p>
          <ul>
            <li>
              <L>{RECORD.historyHeading}</L> lists every version with its status, where it came from (typed in the app, a
              Markdown import, or a change package), and when.
            </li>
            <li>Choose a version number there to see what changed since the version before it.</li>
            <li>
              In <L>{RECORD.compareHeading}</L>, pick any two versions and choose <L>{RECORD.compare}</L>. Pick the same
              number twice to read one version in full.
            </li>
            <li>
              To bring back an earlier version, choose <L>{RECORD.restoreVersion("N")}</L> on that row in{" "}
              <L>{RECORD.historyHeading}</L>, or in <L>{RECORD.compareHeading}</L> after you show that version (same number
              in both boxes, or as the &ldquo;to&rdquo; version when comparing). {RECORD.restoreHelp} Optionally tick{" "}
              <L>{RECORD.restoreIncludeFields}</L>. Protected records need <L>{RECORD.unlockProtected}</L> on the confirm
              step. The new version appears in the list as restored; nothing is deleted.
            </li>
          </ul>
        </Sub>

        <Sub id="protection">
          <p>
            Protection guards a record against accidental changes. Manuscript chapters and scenes are protected
            automatically when created. Any record can be protected.
          </p>
          <p>To change a protected record on its page:</p>
          <ol>
            <li>Make your changes.</li>
            <li>
              Tick <L>{RECORD.unlockProtected}</L>
            </li>
            <li>Save.</li>
          </ol>
          <p>Without the tick, the save is refused and your typing stays on screen.</p>
          <p>
            In <L>{RECORD.protectionHeading}</L>, <L>{RECORD.protect}</L> and <L>{RECORD.unprotect}</L> switch
            protection on or off. Neither creates a new saved version.
          </p>
          <p className="warning">
            <L>{RECORD.unprotect}</L> takes effect at once. There is no confirmation step.
          </p>
          <p>
            Imports and change packages can only change a protected record after you tick a confirmation box. See{" "}
            <See anchor="duplicates" /> and <See anchor="change-package-import" />.
          </p>
        </Sub>

        <h3>Manuscript chapters and scenes</h3>
        <p>
          Chapters and scenes open on their own writing page, with a <L>{WRITE.save}</L> button instead of{" "}
          <L>{RECORD.saveAsRevision("N")}</L>. Saving works the same way. See <See anchor="write" />.
        </p>
      </Section>

      <Section id="write">
        <p>
          <L>{SHELL.write}</L> holds the manuscript: {RECORD_TYPE_LABELS.manuscript_chapter.toLowerCase()}s,{" "}
          {RECORD_TYPE_LABELS.manuscript_scene.toLowerCase()}s inside them, and{" "}
          {RECORD_TYPE_LABELS.scene_note.toLowerCase()}s. A scene always belongs to one chapter. A scene note belongs to
          a chapter or a scene.
        </p>

        <Sub id="manuscript-panel">
          <p>
            On <L>{SHELL.write}</L> and on any chapter, scene or scene note, the second column shows{" "}
            <L>{WRITE.manuscript}</L>: the book&apos;s chapters with their scenes underneath. The open chapter or scene
            is highlighted. Long titles are shortened on screen; point at one to read it in full.
          </p>
          <ul>
            <li>
              Choose the arrow beside a chapter to show or hide its scenes. The number beside a chapter is how many
              scenes it has.
            </li>
            <li>
              Type in <L>{WRITE.searchManuscript}</L> to show only chapters and scenes whose titles contain that text.
              Clear the box to see everything again. Press Enter to search the text as well (see{" "}
              <See anchor="manuscript-search" />
              ).
            </li>
            <li>
              Chapters and scenes are in book order. To change it, see <See anchor="book-order" />.
            </li>
            <li>
              Under the heading, <L>{NAV.readBook}</L> opens the whole book on one page (see <See anchor="read-book" />) and{" "}
              <L>{NAV.importChapters}</L> turns files into chapters (see <See anchor="import-chapters" />). The same two
              links are at the top of <L>{SHELL.write}</L> and under <L>{SHELL.projectTools}</L>.
            </li>
          </ul>
          <h4>Add a chapter or scene</h4>
          <ol>
            <li>
              Choose <L>{WRITE.newChapter}</L> or <L>{WRITE.newScene}</L>.
            </li>
            <li>
              Type a <L>{WRITE.titleLabel}</L>. For a scene, choose its <L>{WRITE.chapterLabel}</L>; it starts as the
              chapter you are in.
            </li>
            <li>
              Choose <L>{WRITE.create}</L>. The new chapter or scene opens with empty text, status <L>draft</L>, and
              protection on.
            </li>
          </ol>
          <p>
            A scene needs a chapter, so create a chapter first. Scenes and scene notes cannot be added with{" "}
            <L>{RECORD.newRecordHeading}</L>, imports or change packages. A new chapter goes at the end of the book, and a
            new scene at the end of its chapter. When the project has manuscript drafts, new chapters and scenes join the
            draft selected under <L>{DRAFT.writeDraft}</L>.
          </p>
        </Sub>

        <Sub id="author-rewrite">
          <p>
            <L>{DRAFT.startRewrite}</L> creates an Author manuscript beside the Zero draft in the same project. Projects
            without drafts yet promote the current chapters and scenes into a Zero draft first, then create blank Author
            manuscript pages with the same titles, hierarchy and book order. Each new page is pinned to the exact source
            revision at that moment. The author writes the rewrite prose and marks completion; nothing is filled in
            automatically.
          </p>
          <ul>
            <li>
              Choosing <L>{DRAFT.startRewrite}</L> again opens the existing Author manuscript and does not create a second
              copy.
            </li>
            <li>
              Starting a rewrite opens <L>{SHELL.write}</L> on the Author manuscript. It does not change the default
              reading or export draft.
            </li>
            <li>
              After creation, add, omit (Trash), reorder, or attach more Zero draft sources to one rewrite scene under the{" "}
              <L>{DRAFT.sourceTab}</L> tab. A combined scene can pin several source revisions.
            </li>
            <li>
              <L>{DRAFT.markComplete}</L> / <L>{DRAFT.markIncomplete}</L> set a draft-level completion mark only; they do
              not change record text or status.
            </li>
            <li>
              <L>{NAV.readBook}</L>, word counts, open review items for manuscript records, and manuscript PDF export use
              the selected draft. Set defaults explicitly with <L>{DRAFT.setDefaultReading}</L> and{" "}
              <L>{DRAFT.setDefaultExport}</L>. On <L>{NAV.exportPdf}</L>, the manuscript draft picker (or the project
              default export draft) chooses which chapters and scenes go into the PDF.
            </li>
            <li>
              Both drafts travel in workspace backups. Restoring a backup that includes them brings Zero draft and Author
              manuscript back with their source pins.
            </li>
            <li>
              Projects that never start a rewrite keep a single manuscript and open and export as before.
            </li>
          </ul>
        </Sub>

        <Sub id="book-order">
          <p>
            <L>{BOOK_ORDER.heading}</L> is under <L>{WRITE.more}</L> on <L>{SHELL.write}</L>. It lists every chapter with
            its scenes underneath, with each one&apos;s status, protection and saved word count, and the whole book&apos;s
            word count at the top. The same order is used by the manuscript outline, the manuscript panel on a chapter or
            scene, <L>{NAV.readBook}</L> and the PDF export.
          </p>
          <ul>
            <li>
              Choose <L>{BOOK_ORDER.moveUp}</L> or <L>{BOOK_ORDER.moveDown}</L> beside a chapter to move it one place
              among the chapters, with all its scenes. Beside a scene, they move it one place within its chapter.
            </li>
            <li>
              To move a scene into a different chapter, pick the chapter in the list beside the scene (it starts as{" "}
              <L>{BOOK_ORDER.chooseChapter}</L>), then choose <L>{BOOK_ORDER.moveTo}</L>. The scene goes to the end of that
              chapter, and its scene notes go with it.
            </li>
            <li>
              Tick <L>{MANUSCRIPT_STRUCTURE.unlock}</L> before merging or converting. <L>{MANUSCRIPT_STRUCTURE.mergePrevious}</L>{" "}
              joins a scene onto the scene above it in the same chapter: the earlier scene keeps its title, the later text
              follows after a blank line, and notes, links, locations, and story-event reveals move with the text. The later
              scene goes to the Trash.
            </li>
            <li>
              <L>{MANUSCRIPT_STRUCTURE.makeChapter}</L> turns a scene into a chapter placed just after its old chapter.{" "}
              <L>{MANUSCRIPT_STRUCTURE.makeSceneDo}</L> turns a chapter that has no scenes into a scene at the end of the
              chapter you pick. Neither changes the text or its saved version.
            </li>
          </ul>
          <p>
            Moving changes no text and makes no new saved version, so it does not need the protection tick. Merging and
            converting do, because they change protected records. Every move, split, merge, and conversion is listed in the{" "}
            <L>{HISTORY.auditLog}</L> on <L>{NAV.history}</L>. A chapter you create or import later goes at the end of the book. Backups keep
            the order.
          </p>
        </Sub>

        <Sub id="manuscript-search">
          <p>
            The search box on <L>{SHELL.write}</L> filters the outline by title as you type. Press Enter to search the
            saved titles and text of every chapter, scene and scene note in the selected draft (<L>{MANUSCRIPT_SEARCH.label}</L>).
            That search ignores capitals. The <L>{WRITE.chaptersTab}</L> and <L>{WRITE.scenesTab}</L> tabs change which
            records the title filter shows; a text search lists matches for the whole draft. <L>{WRITE.newChapter}</L>,{" "}
            <L>{WRITE.newScene}</L>, <L>{NAV.importChapters}</L>, and <L>{NAV.readBook}</L> sit on the row under the draft
            and search, and again beside the selected chapter. Choosing a chapter marks that row and shows it under{" "}
            <L>{WRITE.selectedChapter}</L>, with <L>{WRITE.openChapter}</L>.
          </p>
          <ol>
            <li>
              Type a word or phrase and choose <L>{MANUSCRIPT_SEARCH.submit}</L>. Capitals are ignored. The text is
              matched exactly as typed, the same way as <L>{WRITING.find}</L> in the editor.
            </li>
            <li>
              Results are in book order, each scene note after the chapter or scene it is on. Each shows how many matches
              its text has and up to three of them with the matching words highlighted, then how many more there are.{" "}
              <L>{MANUSCRIPT_SEARCH.titleOnly}</L> means only the title matched.
            </li>
            <li>
              Choose <L>{MANUSCRIPT_SEARCH.openWithFind}</L> beside a chapter or scene to open it with{" "}
              <L>{WRITING.find}</L> already filled in and the first match selected. Choose the title to open it normally.
            </li>
          </ol>
          <p>
            Searching never changes anything. It reads saved text only, so unsaved changes in an open editor are not
            searched. From the results you can open <L>{MANUSCRIPT_SEARCH.replaceAcross}</L>, or open{" "}
            <L>{MANUSCRIPT_REPLACE.heading}</L> from project tools on <L>{SHELL.write}</L>.
          </p>
        </Sub>

        <Sub id="manuscript-style-check">
          <p>
            <L>{STYLE_CHECK.heading}</L> runs deterministic checks on Markdown source text: echoed words in a short
            window, common filter words, many <code>-ly</code> adverbs, long sentences, and character or place names
            repeated close together, possible passive voice, and a short list of weak verbs. The manuscript pass also
            shows <L>{STYLE_CHECK.pacing}</L>, <L>{STYLE_CHECK.dialogue}</L>, and <L>{STYLE_CHECK.pov}</L>. Nothing is
            stored and nothing changes in the manuscript.
          </p>
          <p>
            On a chapter or scene, open <L>{STYLE_CHECK.toolbar}</L> beside <L>{WRITE.spellcheck}</L>. The panel reads the
            text in the editor (including unsaved changes). Choose a row to select that passage. For the whole draft, open{" "}
            <L>{STYLE_CHECK.heading}</L> from <L>{SHELL.moreActions}</L> on Write or from the link in the panel; that pass
            uses saved text only. Each hit opens that chapter or scene, selects the passage, and scrolls the editor
            (offsets match the saved revision; unsaved edits can shift them).
          </p>
          <p className="small muted">
            This complements <L>{WRITE.proofread}</L> and Analyze chapter, which stay spelling, grammar, punctuation and
            story interpretation.
          </p>
        </Sub>

        <Sub id="writing-goals">
          <p>
            <L>{WRITING_GOALS.heading}</L> stores optional word targets for the book and for individual chapters. Open it from{" "}
            <L>{SHELL.write}</L> project tools or the <L>{WRITING_GOALS.editGoals}</L> link on the progress strip.
          </p>
          <p>
            {WRITING_GOALS.lead} On <L>{SHELL.write}</L> and the library home feature, the progress strip shows{" "}
            <L>{WRITING_GOALS.today}</L>, <L>{WRITING_GOALS.session}</L> (from your first visit to Write in this browser
            session, up to 24 hours), and <L>{WRITING_GOALS.book}</L> against the book target when one is set. Opening a
            chapter can show its chapter target on the same strip.             Targets and deadlines are listed in the audit log when you
            save or clear them. When both a book target and a deadline are set, the page shows{" "}
            <L>{WRITING_GOALS.dailyPace}</L> and <L>{WRITING_GOALS.streak}</L> from saved revisions, plus{" "}
            <L>{WRITING_GOALS.chartHeading}</L>. <L>{WRITING_GOALS.sprint}</L> on a chapter or scene is a local timer
            (15, 25, or 45 minutes). It does not save words.
          </p>
          <p className="small muted">
            Session counts need the Write page once per session so the app can start the timer. Unsaved typing is never
            counted until you save a new revision.
          </p>
        </Sub>

        <Sub id="manuscript-annotations">
          <p>
            Each chapter and scene can have a <L>{MANUSCRIPT_ANNOTATIONS.synopsis}</L> and open{" "}
            <L>{MANUSCRIPT_ANNOTATIONS.marginComments}</L>. Neither is manuscript body text; saving them does not create a new
            revision or need the protection tick.
          </p>
          <p>
            Edit the synopsis under the text on a chapter or scene, or on the{" "}
            <L>{MANUSCRIPT_ANNOTATIONS.corkboardTab}</L> tab on <L>{SHELL.write}</L>. That tab lists every chapter and scene
            in book order, with <L>{SCENE_META.pov}</L> and <L>{SCENE_META.status}</L> when they are set. Save a synopsis on
            the card. Move a card with <L>{BOOK_ORDER.moveUp}</L>, <L>{BOOK_ORDER.moveDown}</L>, or{" "}
            <L>{MANUSCRIPT_STRUCTURE.drag}</L>. Reordering uses the same book order as <L>{BOOK_ORDER.heading}</L> and does
            not need the protection tick. Pin a margin
            comment to a saved passage by selecting text, saving if needed, then choosing <L>{MANUSCRIPT_ANNOTATIONS.pinSelection}</L>.
            When you save a new revision, older pins show <L>{MANUSCRIPT_ANNOTATIONS.needsRecheck}</L> until you resolve or remove them.
            Exports include synopses or margin comments only when the compile profile on{" "}
            <L>{NAV.exportPdf}</L> asks for them.
          </p>
        </Sub>

        <Sub id="project-search">
          <p>
            <L>{PROJECT_SEARCH.heading}</L> ({<L>{NAV.projectSearch}</L>} in project tools or settings) searches saved text
            across the project: World and plan records, the manuscript for the same draft as Write, Weave beats, map titles
            and pins, story events, and established-fact statements. Each hit names where it matched and shows a short
            excerpt when the match is in body text.
          </p>
          <p>
            Matching is literal and case-insensitive, like <L>{MANUSCRIPT_SEARCH.submit}</L> on Write. Manuscript results
            open the chapter or scene with <L>{WRITING.find}</L> filled in. Nothing is changed; unsaved text in an open
            editor is not searched.
          </p>
        </Sub>

        <Sub id="manuscript-replace">
          <p>
            <L>{MANUSCRIPT_REPLACE.heading}</L> searches every saved chapter, scene and scene note in the draft you have
            selected, lists each match, and lets you replace the ones you tick in one step. Tick{" "}
            <L>{MANUSCRIPT_REPLACE.useRegex}</L> to search with a pattern. {MANUSCRIPT_REPLACE.regexNote} Canon status is not
            changed. Titles can be included when they match.
          </p>
          <ol>
            <li>
              Enter <L>{MANUSCRIPT_REPLACE.find}</L> and <L>{MANUSCRIPT_REPLACE.replaceWith}</L>. Optionally tick{" "}
              <L>{MANUSCRIPT_SEARCH.matchCase}</L> or <L>{MANUSCRIPT_REPLACE.wholeWord}</L>, then choose{" "}
              <L>{MANUSCRIPT_REPLACE.preview}</L>.
            </li>
            <li>
              Uncheck any match to keep it. <L>{MANUSCRIPT_REPLACE.selectAll}</L> and <L>{MANUSCRIPT_REPLACE.selectNone}</L>{" "}
              help with long lists. Each line shows the text before and after for that match only.
            </li>
            <li>
              Choose <L>{MANUSCRIPT_REPLACE.apply("N")}</L>. Protected records need <L>{RECORD.unlockProtected}</L>. Every
              affected record is saved in one transaction; if any record is out of date, nothing is saved.
            </li>
          </ol>
          <p className="small muted">{MANUSCRIPT_SEARCH.note}</p>
        </Sub>

        <Sub id="import-chapters">
          <p>
            If you write chapters in other programs as <code>.md</code>, <code>.markdown</code> or <code>.txt</code> files,{" "}
            <L>{NAV.importChapters}</L> turns each file into a chapter. Only files you pick on that page become chapters;{" "}
            <L>{NAV.importMarkdown}</L> never creates chapters.
          </p>
          <ol>
            <li>
              Open <L>{NAV.importChapters}</L> and pick one or more files. Nothing is written yet.
            </li>
            <li>
              The list shows the files in the order they will be created: files whose names start with a number (
              <code>18-Chapter_One.md</code>) by that number, then the rest in the order you picked them. Each shows its
              word count and a suggested <L>{CHAPTER_IMPORT.titleLabel}</L> (the first <code># heading</code>, or the
              filename without number, version and status words). Change the title if you like.
            </li>
            <li>
              A file that matches a chapter already in the project (same filename, another version of the same file,
              same title or same text) shows <L>{CHAPTER_IMPORT.matches}</L> and needs your choice:{" "}
              <L>{CHAPTER_IMPORT.createNew}</L>, <L>{CHAPTER_IMPORT.replacePrefix} &ldquo;...&rdquo;</L> or{" "}
              <L>{CHAPTER_IMPORT.skip}</L>. Replacing keeps the chapter&apos;s title, scenes and notes and saves the
              file&apos;s text as a new version; earlier versions stay in its history. Chapters are protected, so
              replacing asks you to tick a confirmation box.
            </li>
            <li>
              <L>{CHAPTER_IMPORT.tidy}</L> is ticked to start with: each file&apos;s text is tidied before it becomes
              chapter text (see <See anchor="tidy-text" />
              ), and <L>{CHAPTER_IMPORT.previewTidied}</L> shows the result. Untick it to import the text as it is.
              Changing the tick works the list out again, so choose the actions after it.
            </li>
            <li>
              Choose <L>{CHAPTER_IMPORT.importFiles("N")}</L>. Everything is written together, or nothing is if any file
              has a problem.
            </li>
          </ol>
          <p>
            New chapters start as protected drafts. Each file&apos;s original name and exact content are kept with the
            chapter. Chapters already in the project keep their place: a new chapter is added after them, whatever its
            number. Move it afterwards under <L>{BOOK_ORDER.heading}</L> (see <See anchor="book-order" />). A replaced
            chapter keeps its place.
          </p>
        </Sub>

        <Sub id="read-book">
          <p>
            <L>{NAV.readBook}</L> shows every chapter and its scenes on one page, in the same order as the manuscript
            panel, in a book typeface. It shows the saved text; unsaved changes in an open editor are not included. When a
            text begins with a heading that repeats its title, that heading is shown only once. The
            list of chapters at the top jumps to each one, and <L>{READ_BOOK.edit}</L> beside a heading opens that chapter
            or scene for editing. Printing the page leaves out the list and the Edit links.
          </p>
          <p>
            When the project has Zero draft and Author manuscript trees, choose the <L>{DRAFT.readingDraft}</L> for this
            visit, or choose <L>{READ_BOOK.besideDrafts}</L> to show the zero draft and the author manuscript in two
            columns. <L>{DRAFT.setDefaultReading}</L> remembers the default for next time; starting a rewrite does not change
            it.
          </p>
        </Sub>

        <Sub id="tidy-text">
          <p>
            On the writing page, <L>{WRITE.more}</L> then <L>{WRITE.tidy}</L> cleans up the whole chapter or scene in the
            editor:
          </p>
          <ul>
            <li>one blank line between paragraphs, and none at the start or end;</li>
            <li>no spaces at the ends of lines;</li>
            <li>
              headings written the same way (<code>#Title</code> becomes <code># Title</code>), with a blank line before
              and after;
            </li>
            <li>
              scene breaks such as <code>***</code>, <code>---</code>, <code>#</code> or <code>⁂</code> on a line of
              their own all become <code>* * *</code>, with a blank line before and after;
            </li>
            <li>
              straight quotes become curly quotes and apostrophes, <code>--</code> becomes an em dash (—) and three dots
              become an ellipsis (…).
            </li>
          </ul>
          <p>
            Single line breaks inside a paragraph are kept, because the app shows them as line breaks. Code, link
            addresses, web addresses, HTML comments, table rules and front matter between <code>---</code> lines at the
            very top are left alone.
          </p>
          <p>
            The change appears in the editor with a summary of what was tidied. Nothing is saved until you choose{" "}
            <L>{WRITE.save}</L>, and <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes it. On protected text, tick{" "}
            <L>{RECORD.unlockProtected}</L> first. If nothing needs tidying, the text is not changed. The same tidy-up is
            offered when importing chapters; see <See anchor="import-chapters" />.
          </p>
        </Sub>

        <Sub id="text-appearance">
          <p>
            <L>{TEXT_APPEARANCE.toolbar}</L> on the writing toolbar, and the <strong>Aa</strong> button on{" "}
            <L>{NAV.readBook}</L> and on reference documents, opens <L>{TEXT_APPEARANCE.button}</L>. It changes how text
            is shown: <L>{TEXT_APPEARANCE.font}</L>{" "}
            (fonts that come with Windows; Garamond only if installed), <L>{TEXT_APPEARANCE.size}</L>,{" "}
            <L>{TEXT_APPEARANCE.spacing}</L> and <L>{TEXT_APPEARANCE.width}</L>. Changes apply at once to chapter, scene
            and reference text on every page. Menus, buttons and headings are not changed.
          </p>
          <p>
            The choice is kept in this browser only. It does not change your text, the saved records or PDF exports.{" "}
            <L>{TEXT_APPEARANCE.reset}</L> returns to the app&apos;s own settings. For dark colours, see{" "}
            <See anchor="navigation" />.
          </p>
        </Sub>

        <Sub id="write-page">
          <p>At the top of a chapter or scene you see, from left to right:</p>
          <ul>
            <li>For a scene, its chapter (a link), and the title, which you can edit in place.</li>
            <li>
              The save status. <L>{WRITE.saving}</L> while the app is saving, <L>{WRITE.savedRevision("N")}</L> once the
              database has stored it, <L>{WRITE.unsaved}</L> when the text, title or fields differ from the saved
              version, and <L>{WRITE.notSaved}</L> when a save was refused (the reason is shown below).
            </li>
            <li>
              <L>{WRITE.save}</L>. Nothing is stored as a revision until you choose it or press <kbd>Ctrl</kbd>+
              <kbd>S</kbd>. This browser keeps a local copy while the record is unsaved.
            </li>
            <li>
              <L>{WRITE.versionHistory}</L>, which jumps to <L>{RECORD.historyHeading}</L> lower on the page.
            </li>
            <li>
              <L>{WRITE.layoutGroup}</L>: <L>{WRITE.modeDesk}</L>, <L>{WRITE.modeFocus}</L>, and{" "}
              <L>{WRITE.modeCompanion}</L>. See <See anchor="panels-focus" />.
            </li>
            <li>
              <L>{WRITE.more}</L>: jumps to <L>{RECORD.statusHeading}</L>, <L>{RECORD.protectionHeading}</L>,{" "}
              <L>{RECORD.historyHeading}</L>, <L>{RECORD.compareHeading}</L> and <L>{WRITE.structuredFields}</L>, and
              offers <L>{MANUSCRIPT_STRUCTURE.split}</L>, <L>{WRITE.loadFromFile}</L> (see <See anchor="load-from-file" />) and <L>{WRITE.tidy}</L> (see{" "}
              <See anchor="tidy-text" />
              ).
            </li>
          </ul>
          <p>
            Chapters and scenes are protected. The row under the title shows the draft and{" "}
            <L>{WRITE.protectedReadOnly}</L>. Choose <L>{WRITE.enableEditing}</L> before saving or formatting. That is
            the confirmation that you are intentionally changing protected text, and it clears after each save. Until
            you choose it, the formatting buttons are unavailable and a save is refused with your typing kept on
            screen. See <See anchor="protection" />.
          </p>
          <p>
            <L>{MANUSCRIPT_STRUCTURE.split}</L> is in that same menu. Put the cursor in saved text, with words on both
            sides, then name the new part. The text before the cursor stays; the rest becomes a new chapter or scene just
            after this one, with the same links and story-event reveals. Save unsaved typing first, and choose{" "}
            <L>{WRITE.enableEditing}</L> when the record is protected. Under <L>{WRITE.structuredFields}</L>,{" "}
            <L>{SCENE_META.pov}</L>, <L>{SCENE_META.status}</L> (<L>{SCENE_META.outline}</L>, <L>{SCENE_META.rough}</L>,{" "}
            <L>{SCENE_META.revised}</L>, <L>{SCENE_META.final}</L>), and <L>{SCENE_META.storyDate}</L> are optional. They
            are stored in the same JSON as any other fields, and a blank value removes only that field.
          </p>
          <h4>Formatting toolbar</h4>
          <p>
            The buttons write Markdown symbols into the text, the same symbols you could type yourself (see{" "}
            <See anchor="formatting" />
            ). The text is not shown formatted. Each button acts on the selected text or the line with the cursor, and
            keeps your selection.
          </p>
          <ul>
            <li>
              <L>{WRITE.paragraphStyle}</L>: <L>{WRITE.paragraph}</L>, <L>{WRITE.heading(1)}</L> to{" "}
              <L>{WRITE.heading(3)}</L>, or <L>{WRITE.quote}</L> for the lines with the selection.
            </li>
            <li>
              <L>{WRITE.bold}</L> (<kbd>Ctrl</kbd>+<kbd>B</kbd>) and <L>{WRITE.italic}</L> (<kbd>Ctrl</kbd>+
              <kbd>I</kbd>). Choose again to remove them. A highlighted button means the cursor is already inside that
              formatting.
            </li>
            <li>
              <L>{WRITE.bulletList}</L> and <L>{WRITE.numberedList}</L> turn the selected lines into a list, or back.
            </li>
            <li>
              <L>{WRITE.link}</L> (<kbd>Ctrl</kbd>+<kbd>K</kbd>): type a <L>{WRITE.linkUrl}</L>, check the{" "}
              <L>{WRITE.linkText}</L> (it starts as the selected words), and choose <L>{WRITE.insertLink}</L>. With the
              cursor inside an existing link, the boxes show that link so you can change it.
            </li>
            <li>
              <L>{WRITE.undo}</L> and <L>{WRITE.redo}</L>: the same history as <kbd>Ctrl</kbd>+<kbd>Z</kbd> and{" "}
              <kbd>Ctrl</kbd>+<kbd>Y</kbd>. Each button press is one step.
            </li>
            <li>
              <L>{WRITE.find}</L> (<kbd>Ctrl</kbd>+<kbd>F</kbd>), <L>{WRITE.spellcheck}</L>, and{" "}
              <L>{TEXT_APPEARANCE.toolbar}</L> stay labeled on the toolbar in every desktop layout. They are not folded
              into <L>{WRITE.moreFormatting}</L>. On a narrow window the toolbar wraps onto a second row instead of
              cutting a control off. See <See anchor="find-replace" />, <See anchor="spelling" />, and{" "}
              <See anchor="text-appearance" />.
            </li>
            <li>
              <L>{WRITE.focus}</L> is the <L>{WRITE.modeFocus}</L> layout (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+
              <kbd>F</kbd>). See <See anchor="panels-focus" />.
            </li>
            <li>
              <L>{WRITE.moreFormatting}</L>: <L>{WRITE.quote}</L> and <L>{WRITE.sceneBreak}</L> (a line with{" "}
              <code>* * *</code>).
            </li>
          </ul>
          <p>
            On a Mac, use <kbd>Cmd</kbd> instead of <kbd>Ctrl</kbd>. Point at a button, or move to it with{" "}
            <kbd>Tab</kbd>, to see its name and shortcut. In the toolbar, the arrow keys move between buttons. There is
            no underline, because Markdown has none.
          </p>
          <p>
            Below the text, the footer shows the word counts (<L>{WRITING.chapterCount}</L> or{" "}
            <L>{WRITING.sceneCount}</L>, <L>{WRITING.selectionCount}</L> and <L>{WRITING.bookCount}</L>), the{" "}
            <L>{WRITING.spellingLanguage}</L>, and the spelling result. <L>{SPELLING.footerClear}</L> appears only after
            the Story Loom checker has finished a check with nothing to report. While it is working the footer says{" "}
            <L>{SPELLING.footerChecking}</L>. <L>{SPELLING.footerDisabled}</L>, <L>{SPELLING.footerUnavailable}</L>, and{" "}
            <L>{SPELLING.footerFailed}</L> are separate. <L>{WRITE.spellcheck}</L> is this checker.{" "}
            <L>{WRITE.proofread}</L> in the side panel is the separate assistant proofreading tool. See{" "}
            <See anchor="word-counts" /> and <See anchor="spelling" />.
          </p>
          <h4>Leaving with unsaved changes</h4>
          <p>
            If you choose a link in the app while a chapter, scene or note has unsaved changes, the browser asks &ldquo;
            {WRITE.leaveUnsaved}&rdquo; Choose Cancel to stay; your typing is still there. Closing or reloading the tab
            shows the browser&apos;s own warning. The browser&apos;s Back button does not ask. If you leave without
            saving, the next open of that record in this browser can offer the local copy.
          </p>
        </Sub>

        <Sub id="scene-context">
          <p>
            <L>{WRITE.modeCompanion}</L> opens the panel to the right of the text, titled{" "}
            <L>{WRITE.besideManuscript}</L>. Its tabs include <L>{WRITE.references}</L>, <L>{DRAFT.sourceTab}</L>,{" "}
            <L>{WRITE.notes}</L>, <L>{WRITE.plot}</L>, <L>{ASSISTANT.tabAssistant}</L>, and <L>{WRITE.proofread}</L>.
            Choose a tab, or move between them with the arrow keys. Opening a source or reference in the panel does not
            leave the writing page, so unsaved text, the cursor and undo stay as they are. <L>{WRITE.proofread}</L> is
            not <L>{WRITE.spellcheck}</L>.
          </p>
          <h4>{DRAFT.sourceTab}</h4>
          <ul>
            <li>
              <L>{DRAFT.sourceHeading}</L> lists Zero draft chapters and scenes pinned to this rewrite page, each at the
              exact revision from when it was linked.
            </li>
            <li>
              <L>{DRAFT.openSourcePreview}</L> shows that pinned text in the panel. <L>{DRAFT.attachSource}</L> and{" "}
              <L>{DRAFT.detachSource}</L> add or remove pins so one rewrite scene can draw on several sources.
            </li>
          </ul>
          <h4>{WRITE.references}</h4>
          <ul>
            <li>
              <L>{WRITE.pinnedReferences}</L> keeps references handy beside this draft. <L>{WRITE.pinReference}</L> and{" "}
              <L>{WRITE.unpinReference}</L> never create or remove a scene link, and a pin alone never authorizes sending
              that text to the assistant.
            </li>
            <li>
              <L>{WRITE.linkedReferences}</L> lists the reference records linked to this chapter or scene.{" "}
              <L>{WRITE.linkToScene}</L> / <L>{WRITE.unlinkFromScene}</L> are separate from pin/unpin.{" "}
              <L>{WRITE.sceneLocations}</L> is also separate: it is a place for the chapter or scene, not a mention and
              not a link. See <See anchor="scene-locations" />.
            </li>
            <li>
              Under <L>{WRITE.findReference}</L>, search by title, name, alias, or section heading, then select a result
              to preview. In the preview, choose <L>{WRITE.pinReference}</L> or <L>{WRITE.linkToScene}</L>.{" "}
              <L>{WRITE.openFull}</L> opens its own page.
            </li>
            <li>
              <L>{WRITE.findRelevantContext}</L> opens the assistant with this scene as the seed so you can preview
              suggested passages before adding them to Include.
            </li>
          </ul>
          <p>
            Character dossiers, worldbuilding, outlines, canon decisions and the other reference types can be linked or
            pinned. Links and pins are saved at once, do not create a new saved version of your text, and do not need the
            protection tick. Links are included in backups and in context exports; pins are included in backups as an
            ordered list per draft (or project-wide when there are no drafts). Adding or removing a link or pin is
            recorded in <L>{NAV.history}</L>.
          </p>
          <p>
            After you start an author rewrite, each draft has its own pin list. Switching the Write draft shows that
            draft&apos;s pins. Soft-trashing a pinned reference hides it from the list until restore; permanently
            deleting it removes the pin.
          </p>
          <h4>{WRITE.notes}</h4>
          <ul>
            <li>
              The tab lists the {RECORD_TYPE_LABELS.scene_note.toLowerCase()}s of this chapter or scene. Choose{" "}
              <L>{WRITE.editNote}</L> to change one, then <L>{WRITE.saveNote}</L>.
            </li>
            <li>
              Under <L>{WRITE.newNote}</L>, type a <L>{WRITE.noteTitle}</L> and the <L>{WRITE.noteText}</L>, then choose{" "}
              <L>{WRITE.addNote}</L>.
            </li>
          </ul>
          <p>
            Notes are records like any other: every save keeps the earlier versions, and a note can be protected. Each
            note also has its own page, reached from the record lists.
          </p>
          <h4>{WRITE.plot}</h4>
          <p>
            Lists Weave beats linked to this chapter or scene — the same stable beat IDs as Plan → Weave (freeform or
            plot grid), including story thread when set. Open a grid from a beat without leaving the manuscript
            identity. Linking or unlinking a beat on Weave updates this list after refresh; it never reorders the book.
          </p>
          <h4>{WRITE.proofread}</h4>
          <p>
            The optional AI proofreading, described in <See anchor="proofreading" />. Until the assistant is set up, the
            tab says so and checks nothing.
          </p>
        </Sub>

        <Sub id="panels-focus">
          <p>
            <L>{WRITE.layoutGroup}</L> is <L>{WRITE.modeDesk}</L>, <L>{WRITE.modeFocus}</L>, and{" "}
            <L>{WRITE.modeCompanion}</L>. The header, protection row, toolbar, and footer stay the same control, in the
            same order, when you switch. What changes is whether the chapter list is open, whether{" "}
            <L>{WRITE.besideManuscript}</L> is open, and how wide the text column is.
          </p>
          <ul>
            <li>
              <L>{WRITE.modeDesk}</L> shows the chapter list and hides the side panel. <L>{WRITE.hideNavigation}</L> and{" "}
              <L>{WRITE.showNavigation}</L> still fold that list, and the main menu still collapses and opens, on this
              page and the others.
            </li>
            <li>
              <L>{WRITE.modeCompanion}</L> hides the chapter list and shows <L>{WRITE.besideManuscript}</L>.{" "}
              <L>{WRITE.close}</L> returns to <L>{WRITE.modeDesk}</L>.
            </li>
            <li>
              <L>{WRITE.modeFocus}</L> hides the chapter list, the icon rail, and the side panel, and keeps the text in
              a centered column. Press <kbd>Esc</kbd>, choose <L>{WRITE.exitFocus}</L>, or press <kbd>Ctrl</kbd>+
              <kbd>Shift</kbd>+<kbd>F</kbd>. Your text, selection, and undo history stay as they were.
            </li>
            <li>
              To change a panel&apos;s width, drag the line at its edge. Or move to that line with <kbd>Tab</kbd> and
              use the left and right arrow keys (with <kbd>Shift</kbd> for bigger steps), or <kbd>Home</kbd> and{" "}
              <kbd>End</kbd> for the narrowest and widest.
            </li>
            <li>
              <L>{WRITE.splitView}</L> turns on a second chapter or scene beside the one you are editing, including a
              chapter from another draft in the same manuscript. Pick which document in the split pane.{" "}
              <L>{WRITE.splitDiff}</L> shows word changes between the text you are editing and the saved text beside
              it. The split pane is <L>{WRITE.splitReadOnly}</L>; choose <L>{WRITE.splitEditHere}</L> to open that
              document in the editor. If you have unsaved changes, the usual leave warning appears first.{" "}
              <L>{WRITE.preview}</L> shows the chapter as rendered Markdown beside the text box. The text box stays in
              place, so spelling, proofreading, and comments still use the same offsets. Typing <code>[[</code> or{" "}
              <code>@</code> offers reference titles; inserting one writes the title as ordinary text. You can also
              link that reference. On <L>{NAV.readBook}</L>, <L>{READ_BOOK.besideDrafts}</L> shows the zero draft and
              the author manuscript in two columns when both exist.
            </li>
            <li>
              In <L>{WRITE.modeFocus}</L>, <L>{WRITE.typewriterScroll}</L> keeps the insertion point partway down the
              screen while you type. That choice is remembered in the same layout cookie.
            </li>
            <li>
              This browser remembers the widths, the layout, and the open tab, in a small cookie. No text is stored in
              it.
            </li>
          </ul>
          <p>
            On a medium-width window, <L>{WRITE.modeCompanion}</L> opens the panel over the text. <L>{WRITE.close}</L>{" "}
            or <kbd>Esc</kbd> closes it; choose <L>{WRITE.modeCompanion}</L> again to bring it back. On a narrow window,
            the chapter list is in <L>{SHELL.openProjectMenu}</L>, and the toolbar wraps onto a second row.
          </p>
        </Sub>

        <Sub id="draft-comparison">
          <p>
            <L>{WRITE.splitView}</L> opens a second chapter or scene beside the one you are editing, including one from
            another draft of the same manuscript. <L>{WRITE.splitDiff}</L> marks word changes against the saved text
            beside it. That pane is <L>{WRITE.splitReadOnly}</L>. <L>{WRITE.splitEditHere}</L> opens it in the editor.
            On <L>{NAV.readBook}</L>, <L>{READ_BOOK.besideDrafts}</L> shows the zero draft and the author manuscript in
            two columns when both exist. Comparing drafts does not copy text and does not create a revision.
          </p>
        </Sub>

        <Sub id="local-recovery">
          <p>
            Saving still happens only when you choose Save. While a chapter, scene, or reference is open, this browser
            keeps a local copy of unsaved title, text, and structured fields. After a reload, <L>{WRITE.recoverHeading}</L>{" "}
            offers <L>{WRITE.recoverRestore}</L> or <L>{WRITE.recoverDiscard}</L> when that copy differs from the saved
            record. {WRITE.recoverNote} The copy is not in a workspace backup. Closing the tab warns when the editor has
            unsaved changes. The browser&apos;s Back button does not.
          </p>
        </Sub>
      </Section>

      <Section id="plan">
        <p>
          <L>{SHELL.plan}</L> keeps the existing <code>/plan</code> route. The page is a grid library:{" "}
          <L>{WEAVE.libraryLead}</L> <L>{WEAVE.searchGrids}</L> filters the list, and <L>{WEAVE.newGridAction}</L> opens the
          same create form. A scope with no grid offers <L>{WEAVE.createGridAction}</L> and selects that scope; nothing
          is created until you submit, and <L>{HOME.cancel}</L> closes the form. Saved grids show their scope and beat
          count, and <L>{WEAVE.openGridAction}</L> opens that grid. <L>{WEAVE.movingBeatsNote}</L>{" "}
          <L>{WEAVE.templates}</L>, <L>{ANALYZE.heading}</L>, <L>{WEAVE.buildFromDraft}</L>, <L>{WORLD.boards}</L>, and{" "}
          <L>{WORLD.maps}</L> are links only. Opening this page does not send a model request or change the manuscript.{" "}
          The header shows the cover, the series when one is set, the book title, and a short description.{" "}
          <L>{ONBOARDING.gettingStarted}</L> is in that header and uses the same guided tasks. Dismissing them leaves
          the link in place and does not reopen the tasks. Write, World, and Assistant use the same header. The second project column is hidden here and on{" "}
          <code>/plan/weave</code>, which is the same library. Chapter outlines and story architecture are under{" "}
          <L>{WEAVE.planningReferences}</L>.
        </p>

        <Sub id="plan-weave">
          <p>
            Create separate <L>{WEAVE.viewOriginal}</L>, <L>{WEAVE.viewZeroDraft}</L>, and{" "}
            <L>{WEAVE.viewAuthorRewrite}</L> grids. <L>{WEAVE.viewOriginal}</L> is the intended story structure.{" "}
            <L>{WEAVE.viewZeroDraft}</L> maps what the zero draft contains. <L>{WEAVE.viewAuthorRewrite}</L> holds
            decisions for the author&apos;s rewrite. Add beats, link each beat to an existing chapter or scene, and cite
            World records. Decisions include <L>{WEAVE.decisionKeep}</L>, <L>{WEAVE.decisionCut}</L>,{" "}
            <L>{WEAVE.decisionMove}</L>, <L>{WEAVE.decisionCombine}</L>, and <L>{WEAVE.decisionRebuild}</L>.
          </p>
          <p>
            Each grid has two layouts. <L>{WEAVE.layoutFreeform}</L> is the original drag canvas: repositioning a beat
            never changes book order or a scene&apos;s chapter (see <See anchor="book-order" />).{" "}
            <L>{WEAVE.layoutPlotGrid}</L> shows scenes as rows grouped by collapsible chapters (for the current writing
            draft; chapter-only projects show chapter rows) and editable story-thread columns. Multiple beats can share
            a cell; blank cells stay valid and can receive a beat inline (subtle on desktop hover/focus; always
            available by keyboard Enter and on touch). Drag a beat onto another cell or the Unplaced tray to move it;
            drop position sets order within a cell. Sticky scene labels and thread headers stay visible while you
            scroll. A beat linked to the rewrite pair of a visible row stays on that row, marked{" "}
            <L>{WEAVE.otherDraftBeat}</L>, and cannot be dragged, so the stored link is not moved onto this draft.
            The collapsible Unplaced beats tray holds beats with no scene link, or a link that is neither this draft
            nor its rewrite pair. <L>{WEAVE.filterLinks}</L> keeps beats that cite a character dossier, cite a place, or
            carry a <L>{WEAVE.filterPov}</L> saved on the linked scene. <L>{WEAVE.filterPovAny}</L> shows every beat
            that has one; choosing a name keeps that name. A character cite, a place cite, and a point of view also mark
            the beat. One toolbar sits above the grid: Grid / Freeform, Threads visibility, decision filter,{" "}
            <L>{WEAVE.filterLinks}</L>, density, and gold <L>{WEAVE.addBeatPrimary}</L>. Compact scope chips show the
            project name as plain text; book switches
            among series siblings when more than one exists; plan switches the Write draft when drafts exist. On narrow
            screens the grid becomes a single-thread scene list. Switching layout keeps freeform positions and never
            reorders the manuscript — use Book order on Write for that.{" "}
            <L>{WEAVE.openSceneInWrite}</L> opens the linked scene; Write&apos;s <L>{WRITE.plot}</L> tab shows the same
            beats.
          </p>
          <p>
            Soft-trashed linked records stay on the beat as unavailable until restore or permanent delete. Selecting a
            beat opens the shared context rail with thread, scene, note, setup/payoff links,{" "}
            <L>{WEAVE.openSceneInWrite}</L>, and <L>{WEAVE.compareZeroDraft}</L> when the linked rewrite scene has pinned
            Zero-draft sources (a chooser appears when several are pinned). On the freeform canvas, filter by decision,
            use <L>{WEAVE.fitSelection}</L> / <L>{WEAVE.fitAll}</L>, and move between beats with the arrow keys. Setup→payoff
            links draw as lines between the beat cards, with an arrow toward the payoff. Moving a beat moves its line and
            does not change the link or the manuscript. On the plot grid, arrow keys move between cells; Enter selects or
            adds in a blank cell; drag relocates beats
            without changing book order. Unsaved title and notes stay across refreshes and draft switches on this grid.
            Older projects open in freeform with their existing canvas intact.
          </p>
        </Sub>

        <Sub id="weave-build-from-draft">
          <p>
            <L>{WEAVE.buildFromDraft}</L> (Plan → Weave) uses the same optional assistant connection as discussion and
            proofreading. Choose a manuscript draft, optional chapter range, and a destination grid (new or existing).
            For an Author rewrite plan you may analyze pinned Zero-draft revisions instead of blank rewrite pages.
          </p>
          <p>
            The model proposes story threads, concise chapter/scene summaries (with optional goal / change / forward
            fields), optional scene-boundary suggestions for review only, and beats that each quote an exact source
            passage. It never rewrites manuscript prose and never splits chapters into scenes automatically. Preview
            suggestions beside the existing grid; <L>{WEAVE.buildAccept}</L>, <L>{WEAVE.buildSkip}</L>, or match a
            suggestion to an existing thread or beat. <L>{WEAVE.buildApplyAccepted}</L> writes Weave threads and beats
            only, in one transaction, with stale-source checks. Retrying an apply reuses stable suggestion identities so
            duplicates are not created. Applied grids remain in workspace backups like any other Weave content; build
            runs themselves are local review state.
          </p>
        </Sub>

        <Sub id="analyze-chapter">
          <p>
            <L>{ANALYZE.heading}</L> (Plan) starts with manuscript counts for the Zero draft, the Author manuscript, and
            any legacy chapters that have no draft. Choose one Zero-draft chapter, pin one of its revisions, and choose
            which categories to ask for. Showing the request does not send it. Sending is a separate button, and the
            pin is checked again at that moment. Author-manuscript pages and legacy chapters are counted and are not
            analyzed. Category choices are remembered in this browser and do not change a run you already saved.
          </p>
          <p>
            What leaves the app is the application instructions, the user message, the catalogs you can expand before
            sending (character titles, place titles, accepted fact statements with how many passages are pinned,
            story-event titles with their time text, and plot beats already linked to this chapter), and the full text
            of this pinned chapter. Other chapters&apos; prose is not included. Your Correct / Needs editing /
            Unsupported / Duplicate marks stay in the app. They are not sent, and they do not change canon.
          </p>
          <p>
            The preflight shows the character count of that request, an estimated input-token figure, the configured
            output-token allowance, and how much of the hourly and monthly allowance is left. A character count is not
            a token count, and the estimate is not a price. Chapter analysis uses its own output allowance (8,000
            tokens unless you set <L>ASSISTANT_ANALYSIS_OUTPUT_TOKENS</L>). Discussion and proofreading stay at their
            own output limit. All of them share the hourly request limit and the monthly token cap.
          </p>
          <p>
            Passage verified means the quotation is in the pinned revision at the offsets shown. It does not mean the
            interpretation is right. You still judge whether a mention is physical presence, whether presence is
            knowledge, whether the reader learning something is a character learning it, whether a revealed event
            happened in this chapter, and whether a plan or a line of dialogue is an established fact. Uncertain
            readings stay marked. A new fact stays pending. A new character or place stays a draft. A suggested beat
            stays planning. Zero-draft evidence does not become Author-manuscript evidence.
          </p>
          <p>
            If the same quotation appears more than once, the suggestion has to say which occurrence. The first match
            is not used silently. A chronology suggestion has to name both events in the quotation and say which is
            earlier. Words such as later, on their own, do not create an order, and chapter order does not either. An
            order that would contradict constraints already stored is refused, and that apply writes nothing.
          </p>
          <p>
            Review is grouped by passage. Open a suggestion to see a little of the surrounding text. Each one shows
            what the passage says, what the analysis proposes, the existing record or New record, the uncertainty, and
            what accepting it will change. <L>{ANALYZE.reviewIntro}</L> <L>{ANALYZE.saveExplain}</L> and{" "}
            <L>{ANALYZE.rateExplain}</L> open beside those labels. <L>{ANALYZE.save}</L> is Use existing, Edit
            suggestion, Create new, or Skip, and nothing is preselected. Use existing links a record already in the
            project. Edit suggestion changes the proposed details before saving and does not edit the manuscript.
            Create new adds the proposed item: a new reference record starts as a draft, and a new fact starts pending.
            A story event, a reader reveal, a planning beat, or an earlier/later order is that kind of record, not a
            new reference document. Skip leaves the suggestion out of the changes you apply.{" "}
            <L>{ANALYZE.assessment}</L> is separate. Correct, Needs editing, Unsupported, and Duplicate describe the
            original suggestion. A rating does not select a change, and editing a suggestion does not turn its rating
            into Correct. Using an existing record is not automatically a duplicate: new passage evidence on an
            existing fact can still be useful.
          </p>
          <p>
            When more than one record matches, choose which one. If a selected item depends on one you skipped, the
            page says what to resolve, and Apply will not create that dependency for you. Before Apply,{" "}
            <L>{ANALYZE.writes}</L> lists the records, links, evidence, events, and beats that this selection will
            write. <L>{ANALYZE.ratingsHeading}</L> are counted beside that list and are not part of it. A rating alone
            does not make Apply write story information.
          </p>
          <p>
            A response that stops early, is refused, or does not match the format has no suggestions and cannot be
            applied. The page says so in plain language and offers Try this chapter again. That link does not send a
            new request. Nothing is written to the manuscript. Applying checks the pin and the target records again,
            writes the selection in one step, and a repeat of the same selection does not create a second copy.
            Skipped suggestions stay available. The chapter text, its current revision, and book order stay as they
            were.
          </p>
        </Sub>

        <Sub id="weave-setup-payoff">
          <p>
            <L>{WEAVE.setupPayoff}</L> links an earlier setup beat to a later payoff. Links may span books in the same
            workspace so you can work backward from a reveal in a later book to a plant in an earlier one. Moving beats
            does not create or change these links.
          </p>
        </Sub>

        <Sub id="weave-templates">
          <p>
            Once a grid is stable, <L>{WEAVE.saveGridAsTemplate}</L> (or <L>{WEAVE.newTemplate}</L>) stores an editable
            beat layout. <L>{WEAVE.applyTemplate}</L> creates an independent Weave grid copy; later template edits do not
            change that copy.
          </p>
          <p>
            <L>{WEAVE.presetHeading}</L> on Plan and on <L>{WEAVE.templates}</L> are <L>{WEAVE.presetThreeAct}</L>,{" "}
            <L>{WEAVE.presetSaveTheCat}</L>, <L>{WEAVE.presetHerosJourney}</L>, <L>{WEAVE.presetSevenPoint}</L>,{" "}
            <L>{WEAVE.presetRomance}</L>, and <L>{WEAVE.presetMystery}</L>. <L>{WEAVE.presetStartGrid}</L> opens a plot
            grid with that sheet&apos;s threads, beats, and setup→payoff links. <L>{WEAVE.presetSaveTemplate}</L> copies
            the same beats into a template you can edit. A beat&apos;s column is stored as a first line beginning with{" "}
            <L>{WEAVE.presetThreadPrefix}</L>; applying the template creates those threads and removes that line from the
            notes. The starter itself does not change when you edit the copy.
          </p>
          <p>
            <L>{WEAVE.createSceneFromBeat}</L> is on a beat that is not yet linked to a chapter or scene. Choose a{" "}
            <L>{WEAVE.createSceneChapter}</L>. Story Loom adds a protected scene there, copies the beat notes into the
            synopsis, links each cited World record, and points the beat at the new scene. The scene body stays empty.
            This does not reorder the book (see <See anchor="book-order" />).
          </p>
          <p>
            Weave grids, story threads, beats (including thread associations), setup→payoff links and templates are
            included in workspace backups. Older backups without threads restore as freeform.
          </p>
        </Sub>
      </Section>

      <Section id="world">
        <p>
          <L>{SHELL.world}</L> holds the project&apos;s reference documents of these types:{" "}
          {WORLD_TYPES.map((t) => RECORD_TYPE_LABELS[t]).join(", ")}. The World page is <L>{WORLD.references}</L>:
          search, document-type filters, an optional worldbuilding-kind filter, recent references, and{" "}
          <L>{WORLD.worldDirectory}</L>. The project column lists the same surfaces under <L>{WORLD.loreAndCodex}</L>,{" "}
          <L>{WORLD.visualSpaces}</L>, <L>{WORLD.timeAndContinuity}</L>, and <L>{WORLD.toolsHeading}</L>:{" "}
          <L>{WORLD.references}</L>, <L>{WORLD.relationships}</L>, <L>{WORLD.maps}</L>, <L>{WORLD.boards}</L>,{" "}
          <L>{WORLD.storyTimeline}</L>, <L>{WORLD.worldCalendar}</L>, and <L>{WORLD.nameGenerator}</L>. Opening one
          does not change records. <L>{WORLD.newReference}</L> opens one form: title, document type (Character,
          Worldbuilding, Rules &amp; glossary, or Research note), an optional Worldbuilding kind, optional starting
          headings that are added only after you confirm a preview, writing, and optional details. Document type is
          the category the reference is stored as. Starting headings are an outline in the writing and do not set that
          category or the kind. A Character reference stores name, aliases, and role in Details. Choosing a
          Worldbuilding kind lists that kind&apos;s fields there too, such as parent place and climate. Those fields
          do not rewrite the writing. Saving uses the
          existing record revision. <L>{WORLD.allReferences}</L> and each category still list documents in a table with
          type, canon status, saved version, and protection. Under <L>{WORLD.boards}</L> you can place references,
          images and freeform notes on a
          focused board (see <See anchor="world-boards" />). Under <L>{WORLD.maps}</L> you can pin places on an existing
          reference image (see <See anchor="world-maps" />). <L>{WORLD.storyTimeline}</L> lists events in an order you
          set, separate from the manuscript (see <See anchor="story-events" />). Plot grids stay under{" "}
          <L>{SHELL.plan}</L>.
        </p>
        <p>
          <L>{WORLD.importReferences}</L> opens <L>{NAV.importMarkdown}</L> (see <See anchor="importing" />).{" "}
          <L>{WORLD.exportForChatGpt}</L> opens <L>{NAV.exportContext}</L> with the documents you were looking at
          already ticked: one document from its page, a category from that category, or every World document from the
          World page. You see <em>{EXPORT.preselected("N")}</em>. Tick or untick anything before generating. See{" "}
          <See anchor="chatgpt" />.
        </p>
        <p>
          <L>{WORLD.exportPdf}</L> on the World page opens <L>{NAV.exportPdf}</L> with that category, or every World
          document, ticked. <L>{WORLD.downloadPdf}</L> on a document&apos;s page downloads a PDF of that document straight
          away. See <See anchor="pdf-export" />.
        </p>

        <Sub id="world-boards">
          <p>
            <L>{WORLD.boards}</L> opens the board list for this project. The project column links to Boards; each board
            title stays on that page. A project can have none; creating the
            first board does not change existing records. Choose <L>{WORLD.newBoard}</L> with{" "}
            <L>{WORLD.templateBlank}</L> (empty) or <L>{WORLD.templateGeography}</L> (invented region notes you can edit,
            move or remove).
          </p>
          <ul>
            <li>
              Add a reference, an image from a reference, or a freeform note. Drag a card to reposition it; the position
              is stored on that board only.
            </li>
            <li>
              The same record can appear on several boards. Selecting a reference or image card opens that record in the
              reference inspector (Overview, Sections, Images, Relationships, and Established in when the record supports
              it). <L>{WORLD.inspectorOpenRecord}</L> opens the record page. The record&apos;s Overview lists the boards
              and maps that contain it. The rail still collapses, resizes, and overlays on a narrow window. Filter by
              card kind, use{" "}
              <L>{WORLD.fitSelection}</L> / <L>{WORLD.fitAll}</L>, and move between cards with the arrow keys. Unsaved
              note title and body stay when the board refreshes after another card save.
            </li>
            <li>
              <L>{WORLD.removeCard}</L> removes the card from that board only; the source record or image is unchanged.
            </li>
          </ul>
          <p>
            Boards and cards are included in workspace backups. Older backups that omit them restore with no boards.
            Named camera or filter views for a board are not stored yet; that is a next increment if needed.
          </p>
          <p>
            <L>{WORLD.askAboutBoard}</L> previews the linked records and their sections, then opens the assistant with
            those records included. Any proposed updates still go through the usual Review and Apply flow (see{" "}
            <See anchor="assistant-proposals" />
            ).
          </p>
        </Sub>

        <Sub id="established-in">
          <p>
            On a reference page, the inspector&apos;s <L>{WORLD.establishedIn}</L> tab links facts to exact manuscript or
            plan passages at a saved revision. Planned material, zero-draft evidence, and author-rewrite evidence stay
            distinct. Offering extracted facts creates pending items you can accept or dismiss — nothing is accepted
            until you review it.
          </p>
          <ul>
            <li>
              Linking a passage stores the source revision, offsets, and excerpt. If that source is edited later, the
              evidence is flagged for recheck.
            </li>
            <li>
              On a character dossier, <L>{WORLD.characterKnowledgeCheck}</L> is a heuristic: it scans a chosen draft and
              chapter or scene for the character&apos;s names, lists the passages checked (the first 40 when there are
              more), and compares accepted facts against every name match by linked evidence and/or keyword overlap.
              That is not proof the character &ldquo;knows&rdquo; a fact. Results split linked evidence from keyword-only
              matches.
            </li>
            <li>
              <L>{WORLD.earlierSceneTracing}</L> (next increment): walk prior scenes in draft order with cited passages and
              uncertainty. Not available yet — {WORLD.earlierSceneTracingNote}
            </li>
          </ul>
          <p>Established facts and evidence are included in workspace backups. Older backups that omit them restore with none.</p>
        </Sub>

        <Sub id="world-maps">
          <p>
            <L>{WORLD.maps}</L> use a reference image as a backdrop. <L>{WORLD.newMap}</L> offers{" "}
            <L>{WORLD.mapSourceUpload}</L> or <L>{WORLD.mapSourceExisting}</L>. An upload is stored with the same image
            rules as a reference document, including the protection tick, and the image is kept only when the map is
            created. Marker positions are fractions of the image width and height (0–1), so they stay aligned when the
            map is resized.
          </p>
          <ul>
            <li>
              A marker can link a reference, another map, or both. <L>{WORLD.openReference}</L> opens the record.{" "}
              <L>{WORLD.openDetailedMap}</L> opens that map and keeps a path you can follow back. Zoom and pan are
              restored for the map you return to. The same place can appear on several maps.
            </li>
            <li>
              <L>{WORLD.mapModeBrowse}</L> pans and zooms without moving markers. <L>{WORLD.mapModeEdit}</L> uses a
              compact tool for <L>{WORLD.markerKindPoint}</L>, <L>{WORLD.markerKindRoute}</L>,{" "}
              <L>{WORLD.markerKindArea}</L>, or <L>{WORLD.markerKindLabel}</L>. A route is an ordered path. An area is a
              closed boundary. A label is text at one position. Instructions appear only while one of those tools is in
              use. <L>{WORLD.drawUndo}</L> and <L>{WORLD.drawCancel}</L> drop points that have not been saved.{" "}
              <L>{WORLD.drawSave}</L> and <L>{WORLD.deleteShape}</L> go through the map service. If the marker was saved
              again after you started, the write is refused and the stored shape stays as it was. The marker list and
              the point fields (<L>{WORLD.drawPointX}</L>, <L>{WORLD.drawPointY}</L>, <L>{WORLD.drawMoveEarlier}</L>,{" "}
              <L>{WORLD.drawMoveLater}</L>) select and edit a shape without the pointer. Each marker can still link a
              World reference.               Freehand drawing is not part of this screen. Positions are not travel time.{" "}
              <L>{WORLD.mapMeasure}</L> and <L>{WORLD.mapRouteLength}</L> estimate a distance from the scale bar you
              set, and the result is labelled <L>{WORLD.mapMeasureDerived}</L>.
            </li>
            <li>
              Each map has author-defined <L>{WORLD.mapLayers}</L>. Older maps open with the former four groups as
              default layer names. In <L>{WORLD.mapModeEdit}</L> you can rename layers, add more (up to sixteen), and
              save them. The <L>{WORLD.mapLayerLegend}</L> toggles which layers show on the map.{" "}
              <L>{WORLD.mapLayersShowAll}</L>, <L>{WORLD.mapLayersHideAll}</L>, and <L>{WORLD.mapLayerPreset("Places")}</L>{" "}
              switch a whole preset at once. New markers use the
              layer you pick in the toolbar or on the marker form.
            </li>
            <li>
              An optional labelled <L>{WORLD.mapScale}</L> bar sits on the image. You write the caption and how wide the
              bar is as a percent of the image. <L>{WORLD.mapMeasure}</L> uses two clicks, and a route shows{" "}
              <L>{WORLD.mapRouteLength}</L>. Both say <L>{WORLD.mapMeasureDerived}</L>. A caption needs a number at the
              start, such as 10 miles, or the distance stays blank. See <L>{WORLD.geometryNote}</L>.{" "}
              <L>{WORLD.mapExportSvg}</L> and <L>{WORLD.mapExportPng}</L> download the markers that are currently
              visible, including the scale caption. The export does not change the map.
            </li>
            <li>
              <L>{WORLD.mapGeography}</L> lists places linked by part_of (see <See anchor="place-relations" />).{" "}
              <L>{WORLD.showOnMap}</L> selects a marker when that place is pinned on this map.
            </li>
            <li>
              The marker list can be searched and moved with the keyboard. Arrow keys stay on the list. Enter on{" "}
              <L>{WORLD.openSceneInWrite}</L>, <L>{WORLD.openChapterInWrite}</L>, or another link follows that link.
              Selecting a marker opens the same inspector a
              board card uses when it links a reference. When that reference has scene locations, the rail lists the
              chapters and scenes in manuscript order. Filter them by draft and book. <L>{WORLD.openSceneInWrite}</L>{" "}
              and <L>{WORLD.openChapterInWrite}</L> open the page in Write. See <See anchor="scene-locations" />.
            </li>
            <li>
              <L>{WORLD.removePin}</L> removes the marker from that map only. Moving a marker never creates or changes a
              place relationship (see <See anchor="place-relations" />).
            </li>
            <li>
              Soft-trashing the image&apos;s host record hides the map until restore. Soft-trashing a linked reference
              keeps the marker and marks it unavailable. A missing or trashed detailed map stays on the marker with{" "}
              <L>{WORLD.openDetailedMap}</L> disabled. Permanently deleting the image deletes maps that used it;
              permanently deleting a linked record removes markers that point at that record.
            </li>
          </ul>
          <p>
            Maps and markers are included in workspace backups. Older backups that omit maps restore with none. Older
            backups that have pins but omit the newer marker fields restore those pins as Places, still linked to the
            same records, at the same positions. A backup that omits route, area, or label geometry restores those
            markers as point pins. Point pins in a new backup omit the geometry fields, so an older copy of the app can
            still read a map that has only points. A backup that includes a route or an area will not restore on an
            older copy that does not know those fields. Backups that omit <L>{WORLD.mapLayers}</L> or map scale fields
            restore with default layer names and no scale bar.
          </p>
        </Sub>

        <Sub id="scene-locations">
          <p>
            A <L>{WRITE.sceneLocations}</L> is a place you assign to a chapter or scene. Assign it from the{" "}
            <L>{WRITE.references}</L> tab in Write with <L>{WRITE.assignLocation}</L>. One of those places can be the{" "}
            <L>{WRITE.primaryLocation}</L>. You can assign more than one. This is not a mention in the prose, not a{" "}
            <L>{WRITE.linkedReferences}</L> link, and not an established fact or a planned event (see{" "}
            <See anchor="established-in" />). Story dates stay unknown unless you write them in the text. The list on a
            map uses manuscript order, not a story calendar.
          </p>
          <p>
            Soft-trashing a chapter, scene, or place keeps the assignment and hides the trashed end until you restore
            it. Permanently deleting either end removes the assignment. Assigning a location does not change the text
            or its saved revisions, so protection does not apply. Scene locations are included in workspace backups.
            Older backups that omit them restore with none. A backup that includes scene locations will not restore on
            an             older copy of the app that does not know that field.
          </p>
        </Sub>

        <Sub id="world-calendar">
          <p>
            <L>{WORLD.worldCalendar}</L> on <L>{SHELL.world}</L> holds one calendar per project: month names, how many days
            each month has, and optional eras with an abbreviation and a year offset for comparing dates across eras. Saving
            a new calendar clears structured dates on story events so nothing points at removed months or eras. Calendar data
            is included in workspace backups.
          </p>
        </Sub>

        <Sub id="story-events">
          <p>
            <L>{WORLD.storyTimeline}</L> is a list of events. Each event has a title, a summary, optional places,
            chapters or scenes that reveal it, a draft, and optional passages pinned to a saved revision. Several
            scenes can reveal one event. <L>{WORLD.storyEventPlanned}</L> stays marked, and it is not a scene location
            or an established fact.
          </p>
          <p>
            Leave <L>{WORLD.storyEventTime}</L> blank when the time is unknown. The app does not invent a date. On{" "}
            <L>{WORLD.worldCalendar}</L> you define months, day counts, and eras; on the timeline you can add an optional{" "}
            <L>{WORLD.structuredDate}</L> alongside the free-text time. Incomplete or missing structured dates are fine.
            If a full structured date disagrees with an explicit <L>{WORLD.recordOrder}</L> link, the timeline warns you;
            it never changes constraints for you. <L>{WORLD.recordOrder}</L> says which event happens first. That order is
            not the manuscript order, so a later chapter can reveal an earlier event. A circle is refused and nothing is saved.
            <L>{WORLD.timelineBoard}</L> places events on lanes for <L>{WORLD.timelineLaneCharacters}</L>,{" "}
            <L>{WORLD.timelineLaneFactions}</L>, or <L>{WORLD.timelineLaneLocations}</L>. A full structured date sets the
            horizontal position. Events without one stay on the recorded order and are marked{" "}
            <L>{WORLD.timelineUnknownTime}</L>. The list under the board stays available from the keyboard.
          </p>
          <p>
            Selecting an event shows its passages and revealing scenes in the right rail.{" "}
            <L>{WORLD.openSceneInWrite}</L> follows the link. <L>{WORLD.showOnMap}</L> appears when a linked place has
            a marker. If more than one map has that place, choose the map first. Selecting a place lists its events.
            Filter the list by draft. A passage pinned to an older revision is marked{" "}
            <L>{WORLD.evidenceStale}</L> after the source is saved again. The excerpt stays as it was pinned.
          </p>
          <p>
            <L>{WORLD.timelineWarnings}</L> are notes, not contradictions the app will fix. An event whose title or
            summary contains the word birth or born, with a full structured date, is that character&apos;s birth. Later
            dated events for the same character show <L>{WORLD.timelineAge("Name", "N")}</L>. A character linked to two
            different places on the same structured date is listed with <L>{WORLD.timelineSameDate("Name", "Place, Place")}</L>.
            When the manuscript reveals a later event before an earlier one, the board says so unless the event or the
            revealing chapter or scene title contains the word Flashback. Ages and notes are calculated when you open
            the timeline. They are not written back onto the records.
          </p>
          <p>
            Adding an event does not change prose, revisions, scene locations, or markers. Events are included in
            workspace backups. Older backups that omit them restore with none. A backup that includes story events
            will not restore on an older copy of the app that does not know those fields. The assistant can read this
            list when you ask what happened at a place, which scenes reveal an event, what is established before a
            scene, or whether a chapter disagrees with the recorded order. See <See anchor="assistant-context" />.
          </p>
        </Sub>

        <Sub id="place-relations">
          <p>
            On a reference page, <L>{WORLD.placeRelations}</L> records explicit edges such as{" "}
            <L>{WORLD.relationPartOf}</L>, <L>{WORLD.relationFlowsInto}</L>, and <L>{WORLD.relationGovernedBy}</L>. These
            are independent of board cards and map pins: moving cards or pins never creates or changes a relationship.
          </p>
          <p>
            Soft-trashed ends are hidden from the list; permanent delete of either end removes the relationship. Place
            relationships are included in workspace backups. See also <See anchor="established-in" /> for facts linked to
            manuscript passages.
          </p>
        </Sub>

        <Sub id="relationship-views">
          <p>
            <L>{WORLD.relationships}</L> on <L>{SHELL.world}</L> opens a graph and three trees built only from{" "}
            <L>{WORLD.placeRelations}</L> and <L>{WORLD.recordRelations}</L>. Choose <L>{WORLD.relationshipGraphView}</L>{" "}
            to focus on one record and limit how many steps out to show, with kind filters.{" "}
            <L>{WORLD.relationshipFamilyView}</L>, <L>{WORLD.relationshipOrganizationView}</L>, and{" "}
            <L>{WORLD.relationshipGeographyView}</L> use <em>parent of</em> / <em>sibling</em> / <em>spouse</em>,{" "}
            <em>member of</em> / <em>leads</em> / <em>serves</em>, and <em>part of</em> respectively. Switch to{" "}
            <L>{WORLD.relationshipListView}</L> for a keyboard-friendly list of the same data.
          </p>
          <p>
            Graph and tree nodes show the reference&apos;s <L>{IMAGES.profileImage}</L> when you set one on its{" "}
            <L>{IMAGES.heading}</L> gallery; otherwise the dot shows initials from the title.
          </p>
        </Sub>

        <Sub id="record-relations">
          <p>
            On a character dossier, an organization, or a place reference, <L>{WORLD.recordRelations}</L> stores explicit
            edges such as <em>Member of</em>, <em>Spouse of</em>, and <em>Rival of</em>, or a custom label you type.
            These rows are separate from <L>{WORLD.placeRelations}</L> (part of, flows into, governed by). Moving board
            cards or map pins never creates or changes a record relationship.
          </p>
          <p>
            The reference inspector&apos;s <L>{WORLD.inspectorRelationships}</L> tab lists both kinds when they exist. Soft-trashed
            ends are hidden; permanently deleting either end removes the relationship. Record relationships are included in
            workspace backups.
          </p>
        </Sub>

        <Sub id="world-nav">
          <p>
            The project column on World keeps every surface visible: <L>{WORLD.loreAndCodex}</L> (
            <L>{WORLD.references}</L>, <L>{WORLD.relationships}</L>), <L>{WORLD.visualSpaces}</L> (
            <L>{WORLD.maps}</L>, <L>{WORLD.boards}</L>), <L>{WORLD.timeAndContinuity}</L> (
            <L>{WORLD.storyTimeline}</L>, <L>{WORLD.worldCalendar}</L>), and <L>{WORLD.toolsHeading}</L> (
            <L>{WORLD.nameGenerator}</L>). The same list is <L>{WORLD.worldSections}</L> on a narrow window. One surface
            is current. A map, a board, or a reference record keeps its parent surface current without listing every
            title in the column. Maps and boards are chosen on their own pages. Deeper pages show a breadcrumb trail
            back to World.
          </p>
          <ul>
            <li>
              <L>{WORLD.searchReferences}</L> on the World page searches titles, text, and structured fields. The results
              say where each match was found and show the surrounding text. Every match is listed.{" "}
              <L>{WORLD.clearSearch}</L> returns to the World page. Search ignores upper and lower case and does not
              change any record.
            </li>
            <li>
              <L>{WORLD.allDocumentTypes}</L> and one filter per document type:{" "}
              {WORLD_TYPES.map((t) => WORLD_CATEGORY_LABELS[t]).join(", ")}. The number beside each is how many documents
              of that type the project has. Choose one to list those documents. While a search or a filter is active,
              the directory is hidden and <L>{WORLD.clearFilters}</L> or <L>{WORLD.clearSearch}</L> returns to the hub.
            </li>
          </ul>
          <p>
            The categories are the document types you choose when importing or creating a record; the app never guesses
            them. Places, religions, magic systems, and other setting notes stay{" "}
            {RECORD_TYPE_LABELS.worldbuilding} records. On those records you can optionally choose a{" "}
            <L>{WORLD_KIND.kindLabel}</L> (place, magic system, organization, and the rest) in structured fields. That kind
            only filters the World list; it is never inferred from the title or text. See{" "}
            <See anchor="world-kinds" />. A document that covers several subjects still has one document type.
          </p>
        </Sub>

        <Sub id="world-kinds">
          <p>
            <L>{WORLD_KIND.kindLabel}</L> is optional metadata on a {RECORD_TYPE_LABELS.worldbuilding} record, stored as{" "}
            <code>kind</code> in structured fields. The eight kinds match the original outline names: place, religion,
            culture, organization, species, magic system, object, and language. Choosing a kind lists a few optional
            fields in Details (parent place, climate, goal, and so on). They are saved with the record and travel in backups and
            change packages like other structured fields.
          </p>
          <p>
            When you set a kind, the World page can filter {RECORD_TYPE_LABELS.worldbuilding} records by each built-in kind,
            then <L>{WORLD.worldKindOther}</L> for custom names, and <L>{WORLD.worldKindUnset}</L> for records with no kind.
            Choosing a filter does not write a kind. Choose <L>{WORLD_KIND.kindCustomOption}</L> when editing to type any label; it is stored in{" "}
            <code>kind</code> like the built-ins. For that custom name, <L>{KIND_TEMPLATE.legend}</L> can remember field keys and labels
            for this book. <L>{KIND_TEMPLATE.remember}</L> stores the list; it does not rewrite the reference. {WORLD_KIND.historyNote}{" "}
            <L>{WORLD.outlineHeading}</L> still only adds Markdown headings to the text; it does not set <code>kind</code>.
          </p>
          <p>
            For <L>{RECORD_TYPE_LABELS.worldbuilding}</L> records with kind <em>language</em>, optional{" "}
            <strong>Name syllables</strong> and <strong>Name patterns</strong> fields support the{" "}
            <L>{WORLD.nameGenerator}</L> (see <See anchor="world-names" />). Patterns use <code>{"{s}"}</code> or{" "}
            <code>{"{S}"}</code> for a random syllable. They are revisioned with the record, not a separate table.
          </p>
        </Sub>

        <Sub id="world-series">
          <p>
            When two books in the same workspace share a series name, a reference whose scope is Series shows up in the
            other book. World lists it with <L>{SERIES.homeBadge("the home book")}</L> and{" "}
            <L>{SERIES.editIn("the home book")}</L>. Opening it there is read-only. Saving, linking, and Trash stay on
            the book that owns the record. A Book scope, or no scope, stays in its own book. Search on World and the
            context rail beside a chapter can find these references. A context export includes them with{" "}
            <code>seriesHome</code> and tells the reader not to update them in this book&apos;s change package.
          </p>
        </Sub>

        <Sub id="world-continuity">
          <p>
            World → <L>{CONTINUITY.nav}</L> (<code>/projects/&lt;project&gt;/continuity</code>) gathers{" "}
            <L>{CONTINUITY.unresolved}</L>, sections titled <L>{INFOBOX.openQuestions}</L>,{" "}
            <L>{CONTINUITY.facts}</L>, <L>{CONTINUITY.storyEvidence}</L>, <L>{CONTINUITY.comments}</L>, and{" "}
            <L>{CONTINUITY.reviews}</L>. Opening the page changes nothing. Each row links to the record, or to the story
            timeline for story evidence.
          </p>
          <p>
            Characters, canon decisions, and continuity notes can also store <L>{REFERENCE_META.name}</L>,{" "}
            <L>{REFERENCE_META.aliases}</L>, and <L>{REFERENCE_META.role}</L> or <L>{REFERENCE_META.summary}</L> in
            structured fields. Empty values are removed. Other JSON keys stay.
          </p>
        </Sub>

        <Sub id="world-names">
          <p>
            World → <L>{WORLD.nameGenerator}</L> reads syllables and patterns from a language-kind reference, then
            lists suggested names. Set a <L>{WORLD.nameGeneratorSeed}</L> to reproduce the same list later; change the
            seed to vary results. Generation does not write anything. For each suggestion, choose{" "}
            <L>{WORLD.nameGeneratorAddDictionary}</L> (project or workspace scope) or{" "}
            <L>{WORLD.nameGeneratorCreateDossier}</L> to open a new character dossier with that title. Both paths use the
            existing dictionary and record services.
          </p>
          <p>
            This is not distance, grammar, or automatic prose replacement. Invalid syllables for the dictionary are
            refused when you add. See <See anchor="dictionary" /> and <See anchor="world-kinds" />.
          </p>
        </Sub>

        <Sub id="reference-page">
          <p>
            Every record except manuscript chapters and scenes opens on this page: World documents, chapter outlines,
            story architecture, and scene notes. The links above the title show where it belongs: <L>{SHELL.world}</L>{" "}
            and its category, <L>{SHELL.plan}</L>, or <L>{SHELL.write}</L> and the chapter or scene a note is on.
          </p>
          <p>Below the title, four separate labels describe different things:</p>
          <ul>
            <li>
              <L>{WORLD.documentType}</L>: what kind of document it is.
            </li>
            <li>
              <L>{WORLD.canonStatus}</L>: how settled it is. Anything other than <L>approved</L> also says{" "}
              <em>(not canon)</em>. The status covers the whole document. It does not mean every section in it has been
              approved. See <See anchor="canon-status" />.
            </li>
            <li>
              <L>{WORLD.savedVersion}</L>: the number of the current saved version, and when it was saved.
            </li>
            <li>
              <L>{WORLD.protection}</L>: <L>{WORLD.protectedLabel}</L> or <L>{WORLD.notProtected}</L>. Protection does not
              depend on the canon status. See <See anchor="protection" />.
            </li>
          </ul>
          <h4>The text</h4>
          <p>
            The saved text is shown formatted: headings, paragraphs, bulleted and numbered lists, tables, block quotes,
            links, bold, italic and code. The text itself is not changed. Wide tables scroll sideways inside their box.
            Links to web pages open in a new tab. Images attached to the document are shown where the text refers to
            them (see <See anchor="images" />). Any other picture address is shown as a link and is not loaded. HTML is
            shown as plain text.
          </p>
          <p>
            On linkable references (not while editing), <L>{INFOBOX.heading}</L> at the top summarizes kind fields,
            aliases, accepted established facts, relationships, map pins, and the first manuscript appearance from saved
            name matches. Pending or dismissed facts are omitted. Open questions still come from an{" "}
            <L>{INFOBOX.openQuestions}</L> heading in the text. See <See anchor="mentioned-by" /> for backlinks.
          </p>
          <p>
            <L>{WORLD.contents}</L> lists the document&apos;s own headings. Choose one to jump to it. Structured fields, if
            the document has any, are shown in a table below the text. They are stored separately: editing the text does
            not change them, and editing them does not change the text.
          </p>
          <p>
            If your last save changed a field but the text still contains its old value, the page shows{" "}
            <L>{WORLD.disagreementsHeading}</L>. Nothing was changed for you; check the text and fields yourself.
          </p>
          <h4>Editing</h4>
          <ol>
            <li>
              Choose <L>{WORLD.edit}</L>. The editor described in <See anchor="editing" /> opens in place of the formatted
              text.
            </li>
            <li>
              Make your changes. On a protected document, tick <L>{RECORD.unlockProtected}</L>
            </li>
            <li>
              Choose <L>{RECORD.saveAsRevision("N")}</L>.
            </li>
            <li>
              Choose <L>{WORLD.doneEditing}</L> to see the formatted text again. If you have unsaved changes, you are
              asked first.
            </li>
          </ol>
          <p>
            If the document was saved somewhere else after you opened the editor (for example in another tab, or by
            changing its status), the save is refused with <code>STALE_REVISION</code> and your typing stays on screen.
            Copy your text, reload the page, and make the change again on the current version.
          </p>
          <p>
            <L>{WORLD.history}</L> and <L>{WORLD.statusAndProtection}</L> jump to the boxes below the document:{" "}
            <L>{RECORD.statusHeading}</L>, <L>{RECORD.protectionHeading}</L>, <L>{RECORD.historyHeading}</L>,{" "}
            <L>{RECORD.compareHeading}</L>, and <L>{WORLD.importedFiles}</L>. See <See anchor="saved-versions" />.
          </p>
        </Sub>

        <Sub id="reference-context">
          <p>
            The context rail beside the document uses the same collapse, resize, and narrow-screen overlay as Write
            (<L>{WRITE.showContext}</L> / <L>{WRITE.hideContext}</L>). Arrow keys move between the inspector tabs. The
            same tabs open when you select a board card or a map pin. The inspector shows the saved document, so unsaved
            text stays in the editor until you save.
          </p>
          <ul>
            <li>
              <L>{WORLD.inspectorOverview}</L>: type, canon status, saved version, protection, a short lead, structured
              field names, and the boards and maps that contain this record. It also includes{" "}
              <L>{WRITE.pinnedReferences}</L> for the active draft (or the whole project when there are no drafts). Pin
              and unpin never link or unlink manuscript scenes.
            </li>
            <li>
              <L>{WORLD.inspectorSections}</L>: the document&apos;s headings, with any status tags shown word for word.
              Choose one to jump to it. See <See anchor="section-status" />.
            </li>
            <li>
              <L>{WORLD.inspectorImages}</L>: images attached to this record. See <See anchor="images" />.
            </li>
            <li>
              <L>{WORLD.inspectorRelationships}</L>: place and record relationships when the reference supports them,{" "}
              <L>{WORLD.linkedManuscript}</L> from a chapter or scene&apos;s <L>{WRITE.references}</L> tab,{" "}
              <L>{XREF.heading}</L>, and <L>{MENTIONED_BY.heading}</L>. A scene note shows <L>{WORLD.noteOn}</L> instead
              of linked chapters. See <See anchor="place-relations" />, <See anchor="record-relations" />,{" "}
              <See anchor="cross-references" />, and <See anchor="mentioned-by" />.
            </li>
            <li>
              <L>{WORLD.establishedIn}</L> when the record can have it. See <See anchor="established-in" />.
            </li>
            <li>
              <L>{WORLD.recentChanges}</L>: the latest five saved versions, with their status and where they came from.
              Choose one to see what changed. <L>{WORLD.viewHistory}</L> jumps to the full list.
            </li>
            <li>
              <L>{WORLD.openReview}</L>: items in <L>{HISTORY.openReviewItems}</L> about this document. Resolve them on{" "}
              <L>{NAV.history}</L>. See <See anchor="review-items" />.
            </li>
            <li>
              <L>{WORLD.proposals}</L>: assistant proposals that would change this document and have not been applied.
              They are marked <em>{WORLD.proposedBadge}</em> and are not part of the text shown. <L>{WORLD.reviewProposal}</L>{" "}
              opens the proposal&apos;s review page, where you can read the exact changes and apply them. See{" "}
              <See anchor="change-review" />.
            </li>
            <li>
              <L>{WORLD.importedFiles}</L>: Markdown files imported into this document. <L>{WORLD.showOriginal}</L> shows
              the file exactly as it was imported. Later edits change the document, not this copy.
            </li>
          </ul>
          <p>
            Each section says so when it has nothing to show. Changing one document never changes linked or related
            documents. Update them yourself if needed.
          </p>
        </Sub>

        <Sub id="mentioned-by">
          <p>
            <L>{MENTIONED_BY.heading}</L> on a reference page (and in the reference inspector) lists where that record
            appears elsewhere in the project: names in manuscript chapters and scenes, cross-references, links from the{" "}
            <L>{WRITE.references}</L> tab, scene locations, story events, Weave beats, and pins on boards or maps. Each
            line is a link and a short label for the kind of mention. It is read-only and uses saved data only.
          </p>
          <p className="small muted">
            The same cross-reference may also appear under <L>{XREF.heading}</L>; both stay available until a later change
            deduplicates them.
          </p>
        </Sub>

        <Sub id="reference-outlines">
          <p>
            On a World reference, <L>{WORLD.outlineHeading}</L> offers eight optional outlines: Place, Religion, Culture,
            Organization, Species, Magic system, Object, and Language. They are not new document types and they do not set{" "}
            <L>{WORLD_KIND.kindLabel}</L>. A place is still {RECORD_TYPE_LABELS.worldbuilding}; use structured fields if you
            want the record grouped as a place. See <See anchor="world-kinds" />.
          </p>
          <ul>
            <li>
              Choosing an outline on <L>{RECORD.newRecordHeading}</L> fills an empty text box with headings. Text you
              have already typed is left as it is.
            </li>
            <li>
              On a document that already has text, choose an outline to review the mapping. Headings that already match
              stay. Other headings and any text outside them stay word for word. Structured fields are listed and are
              not changed. <L>{WORLD.outlineApply}</L> only appends empty headings that are missing.
            </li>
            <li>
              Nothing is written until you apply. Applying again when the headings are already there does not create
              another revision. On a protected document, tick <L>{RECORD.unlockProtected}</L> first. If the document was
              saved elsewhere, apply is refused and your saved text is unchanged.
            </li>
          </ul>
          <p>Finish editing before applying an outline, so unsaved text is not replaced.</p>
        </Sub>

        <Sub id="images">
          <p>
            Every record that opens on a reference page can have images: World documents, Plan documents and scene notes.
            Manuscript chapters and scenes cannot. The <L>{IMAGES.heading}</L> box is below the document text, with every
            image attached to the document.
          </p>
          <h4>Adding images</h4>
          <ol>
            <li>
              Under <L>{IMAGES.heading}</L>, use <L>{FILE.chooseFiles}</L> in <L>{IMAGES.chooseFiles}</L>. You can pick
              several at once.
            </li>
            <li>
              On a protected document, tick <L>{RECORD.unlockProtected}</L>
            </li>
            <li>
              Choose <L>{IMAGES.add}</L>.
            </li>
          </ol>
          <p>
            PNG, JPEG, GIF and WebP files are accepted, up to {formatBytes(MAX_IMAGE_BYTES)} each and{" "}
            {MAX_IMAGES_PER_RECORD} per document. The app checks what each file really contains, not just its name. If
            one file is refused, none of the batch is added and the message says which file and why.
          </p>
          <p>
            Images are stored in the app&apos;s database, not as separate files, and are included in workspace backups.
            Adding, captioning or removing an image does not create a saved version of the document and does not change
            its text. Each change is recorded in the project&apos;s history.
          </p>
          <h4>Showing an image in the text</h4>
          <p>
            Each image has a name, such as <code>harbour-map.png</code>, made from its file name. A line like{" "}
            <code>![The harbour at dawn](image:harbour-map.png)</code> in the text shows that image at that place, with
            its caption below. The words in the square brackets describe the image for screen readers.
          </p>
          <ul>
            <li>
              <L>{IMAGES.copyReference}</L> on an image copies that line. Paste it into the text while editing.
            </li>
            <li>
              While editing, <L>{IMAGES.insertLabel}</L> above the text box lists the document&apos;s images.{" "}
              <L>{IMAGES.insertButton}</L> adds the chosen image&apos;s line where the cursor is, or in place of selected text. Undo it with{" "}
              <kbd>Ctrl</kbd>+<kbd>Z</kbd> in the text box. If your browser cannot add it to its undo history, the{" "}
              <L>{WRITING.undoReplacement}</L> button of <See anchor="find-replace" /> removes it instead.
            </li>
          </ul>
          <p>
            Images shown in the text are marked <em>{IMAGES.inText}</em>. If the text refers to a name that no attached
            image has, the formatted text says the image is not found, and <L>{IMAGES.missingHeading}</L> lists the
            names. The text is never changed for you.
          </p>
          <h4>Captions and removing</h4>
          <p>
            Open <L>{IMAGES.details}</L> under an image to change its <L>{IMAGES.caption}</L> and{" "}
            <L>{IMAGES.altText}</L>, then choose <L>{IMAGES.save}</L>. <L>{IMAGES.setProfileImage}</L> marks one image as
            the <L>{IMAGES.profileImage}</L> for that reference; other attachments stay in the gallery.{" "}
            <L>{IMAGES.remove}</L> asks you to confirm, then deletes the stored image. It is not offered while the text
            shows the image: remove the line from the text and save first. Older saved versions that showed a removed
            image say it is not found.
          </p>
          <p>Choose an image to open it at full size in a new tab.</p>
        </Sub>
      </Section>

      <Section id="series-documents">
        <p>
          A series bible and its companion files often mark status section by section, refer to each other by filename,
          and give decisions IDs such as <code>SA-WORLD-001</code>. The app reads these markings from the saved text each
          time a page opens. It never changes a record because of them, and nothing about them is stored.
        </p>

        <Sub id="section-status">
          <p>
            A heading can end with a status tag in square brackets, such as <code>## Rules [APPROVED FRAMEWORK]</code> or{" "}
            <code>[WORKING PROPOSAL; NOT FULLY APPROVED ARC]</code>, or after a dash, such as{" "}
            <code>### Harbour scene — SELECTED; after the storm</code>. A tag starts with, or contains, a word in capitals.
            Dates such as <code>[25 October 2026]</code> and lower-case notes after a dash are not tags.
          </p>
          <ul>
            <li>
              <L>{WORLD.contents}</L> beside a reference shows each heading with its tag in a dashed box, word for word. Tags in
              the text apply to their own sections; the record&apos;s <L>{WORLD.canonStatus}</L> still describes the whole
              document, and you set it yourself. See <See anchor="canon-status" />.
            </li>
            <li>
              The assistant, the context export and the read-only adapter are all told that these markings govern their
              sections, so a section marked as working, proposed or open is not treated as settled even in an approved
              document.
            </li>
          </ul>
        </Sub>

        <Sub id="cross-references">
          <p>In a reference document&apos;s text, the app turns two kinds of mention into links:</p>
          <ul>
            <li>
              <strong>Filenames</strong> such as <code>Harbour_Guide_APPROVED_WORKING_v1.4.md</code> link to the document
              imported from that file, whatever its version: the version number, a date, status words in capitals at the
              end, and a number at the start such as <code>18-</code> are ignored.
            </li>
            <li>
              <strong>IDs</strong> such as <code>SA-TIDE-001</code> or <code>SA-B1-C01</code> (capital letters and digits
              joined by hyphens) link to where the ID is defined: a heading that starts with it, a bold list item or
              paragraph that starts with it, or a table row whose first cell is it.
            </li>
          </ul>
          <p>
            To give a chapter, scene or any other record its own ID, add it to the record&apos;s structured fields, for
            example <code>{`{"refIds": ["SA-B1-C01"]}`}</code>. Mentions of that ID then link to the record itself rather
            than to a row in a register.
          </p>
          <p>
            The <L>{XREF.heading}</L> section, beside a reference and below a chapter&apos;s text, lists{" "}
            <L>{XREF.definedHere}</L>, the filenames and IDs the text <L>{XREF.mentions}</L>, and the documents it is{" "}
            <L>{XREF.mentionedBy}</L>. A filename that was never imported is marked <em>{XREF.notImported}</em>; an ID no
            document defines is marked <em>{XREF.notDefined}</em>.
          </p>
          <p>
            When a link leads to a document whose canon status is <em>superseded</em> or <em>draft</em>, the{" "}
            <L>{XREF.heading}</L> section says so beside the link, and names the document that replaces a superseded
            one when its <em>Superseded by</em> is set. In the document text, a link to a superseded document has a wavy
            underline and a small dagger (†); a link to a draft has a dashed underline. Point at a link to see the
            reason. If an ID is defined both in a superseded document and in a current one, links go to the current one.
          </p>
        </Sub>

        <Sub id="names-in-manuscript">
          <p>
            Characters (character dossiers) and places and other world details (worldbuilding records) are looked for
            by name in every chapter and scene. Names are matched as whole words, with capitals exactly as written.
          </p>
          <ul>
            <li>
              The name is the record&apos;s title up to a dash, colon or bracket: <em>Seren — Character Dossier</em> is
              found as <em>Seren</em>. A title starting with &ldquo;The&rdquo; is also found without it, so{" "}
              <em>The Salt Guild</em> also matches <em>Salt Guild</em>.
            </li>
            <li>
              For a character with two or more words in the name, the first and last words are also found on their own
              (<em>Mara Venn</em> also as <em>Mara</em> and <em>Venn</em>), unless another character uses the same
              word, or it is a title such as <em>Lady</em> or <em>Captain</em>.
            </li>
            <li>
              To add nicknames or other spellings, put them in the record&apos;s structured fields, for example{" "}
              <code>{`{"aliases": ["Mags", "the Archivist"]}`}</code>.
            </li>
            <li>A title that does not start with a capital letter is not looked for unless it has aliases.</li>
            <li>Superseded records are not looked for.</li>
          </ul>
          <p>
            Below a chapter or scene, the <L>{XREF.heading}</L> section lists <L>{XREF.namesHere}</L> with how often
            each appears. On a dossier or worldbuilding record it lists <L>{XREF.namedIn}</L>: the forms looked for and
            the chapters and scenes that use them.             Nothing is changed in either text.
          </p>
        </Sub>

        <Sub id="record-rename">
          <p>
            On a character dossier or worldbuilding record, <L>{RECORD_RENAME.heading}</L> updates the reference and can
            replace its name forms in every saved chapter, scene and scene note in the draft you have selected.
          </p>
          <ol>
            <li>
              Enter a new <L>{RECORD_RENAME.titleField}</L>, <L>{RECORD_RENAME.nameField}</L>, and{" "}
              <L>{RECORD_RENAME.aliasesField}</L>, then choose <L>{RECORD_RENAME.preview}</L>.
            </li>
            <li>
              Each manuscript match shows the old and new wording. <L>{RECORD_RENAME.ambiguous}</L> matches start
              unticked when more than one record shares that form. Tick only the ones you want.
            </li>
            <li>
              Choose <L>{RECORD_RENAME.apply}</L>. Protected records need <L>{RECORD.unlockProtected}</L>. Every chosen
              record is saved in one step; if any record is out of date, nothing is saved.
            </li>
          </ol>
        </Sub>

        <Sub id="cross-reference-check">
          <p>
            <L>{NAV.crossRefCheck}</L> under <L>{SHELL.projectTools}</L> checks every document in the project at once
            and lists:
          </p>
          <ul>
            <li>
              <L>{XREF_CHECK.undefinedIds}</L>, with the documents that mention each one. Only IDs whose first part
              some document uses are listed, so ordinary capitalised words with a hyphen are not.
            </li>
            <li>
              <L>{XREF_CHECK.missingFiles}</L>: Markdown filenames mentioned in the text that were never imported.
            </li>
            <li>
              <L>{XREF_CHECK.conflicts}</L>, with each place it is defined. A table row in a register next to the
              document that defines the ID is not counted, and definitions in superseded documents are not counted.
            </li>
            <li>
              <L>{XREF_CHECK.flagged}</L>, superseded first, with the replacement when there is one.
            </li>
            <li>
              <L>{XREF_CHECK.names}</L>: how many chapters and scenes name each character and place, and which are not
              named anywhere yet.
            </li>
          </ul>
          <p>
            Mentions made by superseded documents are left out: an old version that refers to old material is
            expected. The check reads saved text each time the page opens and changes nothing.
          </p>
        </Sub>

        <Sub id="new-versions">
          <p>
            When you import a newer version of a file, for example <code>Harbour_Guide_APPROVED_WORKING_v1.5.md</code> after{" "}
            <code>..._v1.4.md</code>, the import page marks it a possible duplicate: <em>same document, another version</em>.
            Choose <L>{MARKDOWN_IMPORT.replacePrefix} &ldquo;title&rdquo;</L> to save it as a new saved version of the
            existing record, keeping the earlier one; or keep both, or skip it. Nothing is replaced unless you choose it,
            and the status words in the filename never set the canon status. See <See anchor="duplicates" />.
          </p>
        </Sub>

        <Sub id="long-documents">
          <p>
            A long series bible can be larger than the assistant&apos;s limit. On the assistant page, a reference with
            several headings has <L>{ASSISTANT.sectionsHeading}</L> under it: tick the sections to send
            instead of the whole document. A section runs to the next heading of the same or higher level, so it includes
            its subsections. Each section is sent whole with the headings above it and their tags; nothing is cut. See{" "}
            <See anchor="assistant-context" />.
          </p>
          <p>
            The read-only adapter can do the same: it lists a document&apos;s sections and reads one at a time. See{" "}
            <See anchor="chatgpt-direct" />.
          </p>
        </Sub>

        <Sub id="load-from-file">
          <p>
            To bring a chapter or scene you wrote elsewhere into one you created here, open it on the writing page, choose{" "}
            <L>{WRITE.more}</L>, then <L>{WRITE.loadFromFile}</L>, and pick a <code>.md</code>, <code>.markdown</code> or{" "}
            <code>.txt</code> file of up to 5 MB.
          </p>
          <ul>
            <li>The file replaces the text in the editor. If the editor already has text, the app asks first.</li>
            <li>
              Nothing is saved until you choose <L>{WRITE.save}</L>. <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes the load.
            </li>
            <li>
              On protected text, tick <L>{RECORD.unlockProtected}</L> first. The title, status and structured fields are
              not changed.
            </li>
          </ul>
          <p>Reference files are imported instead; see <See anchor="importing" />. Importing never creates chapters.</p>
        </Sub>
      </Section>

      <Section id="pdf-export">
        <p>
          The app makes PDF files of your saved documents on this computer. Unsaved edits are not included, and the app
          does not keep a copy of the PDF.
        </p>
        <h4>One reference document</h4>
        <p>
          On a document&apos;s page, choose <L>{WORLD.downloadPdf}</L>. The PDF has the title, document type, canon
          status, saved version and protection, then the text, structured fields and images.
        </p>
        <h4>Several documents or a category</h4>
        <ol>
          <li>
            Open the project and choose <L>{NAV.exportPdf}</L>, or <L>{WORLD.exportPdf}</L> on the World page or a
            category.
          </li>
          <li>
            Under <L>{PDF.referencesHeading}</L>, tick documents. The box beside a category name ticks or unticks the
            whole category.
          </li>
          <li>
            Choose <L>{PDF.downloadReferences("N")}</L>, <L>{PDF.downloadReferencesDocx("N")}</L>,{" "}
            <L>{PDF.downloadReferencesEpub("N")}</L>, or <L>{PDF.downloadReferencesMarkdown("N")}</L>. DOCX, EPUB, and
            the Markdown zip use the same ticked references. The Markdown zip is one file per document plus a list.
          </li>
        </ol>
        <p>
          The PDF starts with a list of the documents by type. Each document starts on a new page, ordered by type and
          then title. The PDF&apos;s bookmarks list every document.
        </p>
        <h4>The manuscript</h4>
        <ol>
          <li>
            Open <L>{NAV.exportPdf}</L>.
          </li>
          <li>
            If the project has manuscript drafts, choose which draft to export (or rely on{" "}
            <L>{DRAFT.setDefaultExport}</L>). The PDF includes only that draft&apos;s chapters and scenes.
          </li>
          <li>
            Under <L>{PDF.manuscriptHeading}</L>, optionally tick <L>{PDF.sceneTitles}</L>.
          </li>
          <li>
            Set the <L>{COMPILE_PROFILE.heading}</L> (title and other front matter, scene-break glyph, chapter heading
            alignment, trim, margins, running header and footer, font and spacing, and whether to include synopses or margin comments), then choose{" "}
            <L>{PDF.downloadManuscript}</L>, <L>{PDF.downloadManuscriptDocx}</L>, or <L>{PDF.downloadManuscriptEpub}</L>.
          </li>
        </ol>
        <p>
          Chapters are in book order, as under <L>{BOOK_ORDER.heading}</L> on <L>{SHELL.write}</L>, each starting on a new page, with its text followed by
          its scenes. Notes and references are not included. Projects without drafts export the whole manuscript as
          before. {PDF.manuscriptFormatsNote}
        </p>
        <h4>Compile profile</h4>
        <p>
          One profile per project. Filled-in title, copyright, dedication, and acknowledgement pages are included before
          the first chapter in every manuscript format. A custom title page replaces the default project title page. Scene
          breaks use your glyph when scene titles are off. Synopses and unresolved margin comments are optional.{" "}
          <L>{COMPILE_PROFILE.trimSize}</L>, <L>{COMPILE_PROFILE.marginInches}</L>, <L>{COMPILE_PROFILE.runningHeader}</L>,{" "}
          <L>{COMPILE_PROFILE.runningFooter}</L>, <L>{COMPILE_PROFILE.fontPreset}</L>, and{" "}
          <L>{COMPILE_PROFILE.spacingPreset}</L> shape the manuscript PDF. <L>{COMPILE_PROFILE.includeToc}</L> adds a
          contents page whose chapter titles jump to those chapters. <L>{COMPILE_PROFILE.dropCap}</L> sets the first
          letter of each chapter larger in the PDF. <L>{COMPILE_PROFILE.includeInCompile}</L> leaves unticked chapters
          and scenes out of PDF, DOCX, and EPUB without changing the manuscript. <L>{COMPILE_PROFILE.backMatter}</L>{" "}
          follows the chapters.
        </p>
        <h4>What a PDF contains</h4>
        <ul>
          <li>Text is formatted the way the reference page shows it: headings, lists, tables, quotes, links and code.</li>
          <li>
            PNG and JPEG images are included where the text shows them, and images the text does not show come after the
            text. GIF and WebP images are listed by name instead.
          </li>
          <li>Pages after the first are numbered. The page size is A4.</li>
        </ul>
      </Section>

      <Section id="writing-tools">
        <p>
          On a record page, the <L>{RECORD.editHeading}</L> panel has a <L>{WRITING.toolsHeading}</L> box above the
          text. The tools work on this record&apos;s text box (<L>{RECORD.bodyLabel}</L>) only.
        </p>
        <p>
          On a chapter or scene, the same tools are spread over the writing page: <L>{WRITE.find}</L> and{" "}
          <L>{WRITE.spellcheck}</L> in the toolbar, word counts and <L>{WRITING.spellingLanguage}</L> below the text,
          and proofreading in the <L>{WRITE.proofread}</L> tab. There, choose <L>{WRITE.save}</L> wherever these steps
          say <L>{RECORD.saveAsRevision("N")}</L>.
        </p>

        <Sub id="spelling">
          <p>
            A record&apos;s text box is checked as you type. Words the checker does not recognise get a wavy red
            underline. <L>{SPELLING.checker}</L> chooses who checks it:
          </p>
          <ul>
            <li>
              <L>{SPELL_CHECKERS[0].label}</L> (the default): the app checks the text itself, with a standard English
              word list plus your <See anchor="dictionary" />. It works without the internet and without the assistant,
              and nothing is sent anywhere.
            </li>
            <li>
              <L>{SPELL_CHECKERS[1].label}</L>: your browser checks the text with its own dictionaries and settings, as
              before. It does not know your dictionary. Right-click an underlined word for the browser&apos;s
              suggestions.
            </li>
          </ul>
          <p>Only one checker underlines the text at a time. The choice is saved in this browser.</p>
          <h4>Checking with Story Loom</h4>
          <ol>
            <li>
              Click an underlined word, or choose <L>{SPELLING.next}</L> or <L>{SPELLING.previous}</L> to select the
              next or previous one. The count beside them shows how many words are not recognised.
            </li>
            <li>
              The word appears in the <L>{WRITING.toolsHeading}</L> box with <L>{SPELLING.suggestions}</L>. Choose a
              suggestion to replace the word in the text box.
            </li>
            <li>
              Or choose <L>{SPELLING.ignoreOnce}</L> to remove the underline from this one place only. The same word
              elsewhere stays underlined, and the underline comes back when you reload the page.
            </li>
            <li>
              Or choose <L>{SPELLING.addToProject}</L> (this book) or <L>{SPELLING.addToWorkspace}</L> (every project
              in the workspace). Tick <L>{SPELLING.matchCase}</L> first if only this exact capitalisation is correct; it
              is ticked for words with capitals. A possessive such as &ldquo;Aldreth&rsquo;s&rdquo; is added as
              &ldquo;Aldreth&rdquo;, which then covers both.
            </li>
            <li>
              Choose <L>{RECORD.saveAsRevision("N")}</L> to keep replacements. Nothing in the text is saved before that.
              Adding a word to the dictionary is saved at once and changes no record.
            </li>
          </ol>
          <ul>
            <li>
              Checking waits until you pause typing, so typing never slows down. Underlines can take a moment to appear
              after the page opens, the first time the word list is loaded.
            </li>
            <li>
              When a word is close to one in your dictionary, the box says so, for example a misspelt character name.
              It stays underlined: your dictionary only accepts the exact words in it.
            </li>
            <li>
              Suggestions start with similar words from your dictionary, then come from the standard word list.
              Suggestions can take a second or two for long or unusual words.
            </li>
            <li>
              Code, link addresses, URLs, HTML and words joined to digits (such as &ldquo;3rd&rdquo;) are not checked.
              Hyphenated words are checked part by part.
            </li>
            <li>
              On a protected record, suggestions cannot be used until you choose <L>{WRITE.enableEditing}</L>. The same
              control is in the spelling box. Ignoring and adding words still work.
            </li>
            <li>
              If the Story Loom checker cannot start, the box says so and the browser&apos;s checker is used instead.
            </li>
          </ul>
          <h4>Spelling language</h4>
          <ol>
            <li>Open any record.</li>
            <li>
              In <L>{WRITING.spellingLanguage}</L>, choose{" "}
              {SPELLING_LANGUAGES.map((l, i) => (
                <span key={l.code}>
                  {i > 0 ? " or " : null}
                  <L>{l.label}</L>
                </span>
              ))}
              .
            </li>
          </ol>
          <p>
            The choice is saved in this browser. Story Loom checks with the matching US or UK word list. Record titles, and
            the text in <L>{RECORD.newRecordHeading}</L>, are always checked by the browser, which is told the language
            you chose.
          </p>
          <p className="warning">
            The browser decides whether to check spelling and which dictionary to use. If the browser&apos;s checker
            underlines nothing, or marks US spellings in UK mode, check that spell check is on in your browser&apos;s
            settings and that the English you want is installed there.
          </p>
          <p>Structured fields and change package boxes are not checked, because they hold codes rather than prose.</p>
        </Sub>

        <Sub id="dictionary">
          <p>
            Your dictionary holds invented names and words that are spelled correctly, so the Story Loom checker stops
            underlining them and AI proofreading leaves them alone. Open it with <L>{NAV.dictionary}</L> in a
            project&apos;s menu, or <L>{SPELLING.manageDictionary}</L> in the <L>{WRITING.toolsHeading}</L> box.
          </p>
          <ul>
            <li>
              <L>{DICTIONARY.scopeProject}</L>: words for this book only.
            </li>
            <li>
              <L>{DICTIONARY.scopeWorkspace}</L>: words for every project in the workspace, such as names that recur
              across a series.
            </li>
          </ul>
          <p>A project never sees another project&apos;s words, and nothing is shared between workspaces.</p>
          <h4>Add, edit and remove words</h4>
          <ol>
            <li>
              In <L>{DICTIONARY.addHeading}</L>, type one word or a phrase such as an invented place name, choose the{" "}
              <L>{DICTIONARY.scope}</L>, and optionally a note. Choose <L>{DICTIONARY.add}</L>.
            </li>
            <li>
              Choose <L>{DICTIONARY.edit}</L> beside a word to change its spelling, <L>{DICTIONARY.matchCase}</L>, note
              or dictionary, then <L>{DICTIONARY.save}</L>.
            </li>
            <li>
              Choose <L>{DICTIONARY.remove}</L>, then confirm. The word is underlined again wherever it appears.
            </li>
          </ol>
          <ul>
            <li>
              <L>{DICTIONARY.matchCase}</L> ticked: only that exact capitalisation is accepted (&ldquo;Aldreth&rdquo;,
              not &ldquo;aldreth&rdquo;). It starts ticked for words typed with capitals. Unticked: any capitalisation is
              accepted.
            </li>
            <li>
              You can add a multi-word phrase (for example &ldquo;Salt Quay&rdquo;); the checker accepts only that exact
              phrase, not the same words on their own. Hyphenated names are still added part by part. An entry that is
              already accepted cannot be added again.
            </li>
            <li>
              Words close to another word in your dictionary are marked &ldquo;{DICTIONARY.similar}&rdquo;, so two
              spellings of one name stand out. Both stay in the dictionary until you remove one.
            </li>
            <li>
              Adding, editing and removing words never changes a record. Each change is listed in{" "}
              <L>{HISTORY.auditLog}</L> on the <L>{NAV.history}</L> page of the project where you made it.
            </li>
          </ul>
          <h4>{DICTIONARY.referencesHeading}</h4>
          <p>{DICTIONARY.referencesNote}</p>
          <ol>
            <li>
              Choose <L>{DICTIONARY.findNames}</L>. Each word is listed with the records it was found in.
            </li>
            <li>Tick the words you want. None are ticked to start with.</li>
            <li>
              Choose the <L>{DICTIONARY.scope}</L>, then <L>{DICTIONARY.addSelected("N")}</L>.
            </li>
          </ol>
          <h4>Export and import</h4>
          <ul>
            <li>
              In <L>{DICTIONARY.exportHeading}</L>, <L>{DICTIONARY.exportScope("project")}</L> and{" "}
              <L>{DICTIONARY.exportScope("workspace")}</L> download a JSON file with each word, its match-case setting
              and note.
            </li>
            <li>
              In <L>{DICTIONARY.importHeading}</L>, choose a file exported this way, or a plain list with one word or
              phrase per line (lines starting with # are skipped; Hunspell .dic files also work). The entries are listed,
              with those already in your dictionary, repeated, or invalid lines marked and not selectable.
            </li>
            <li>
              Nothing is selected at first. Tick words one by one or choose <L>{DICTIONARY.selectAllNew}</L>, choose
              the <L>{DICTIONARY.scope}</L>, then <L>{DICTIONARY.addSelected("N")}</L>. Words that could not be added
              are listed with the reason.
            </li>
          </ul>
          <p>
            Dictionary words are included in full workspace backups and restored with them. See{" "}
            <See anchor="full-backup" />.
          </p>
        </Sub>

        <Sub id="word-counts">
          <p>Below the text box you see:</p>
          <ul>
            <li>
              <L>{WRITING.documentCount}</L> (<L>{WRITING.chapterCount}</L> for a chapter, <L>{WRITING.sceneCount}</L>{" "}
              for a scene): words in the text box now.
            </li>
            <li>
              <L>{WRITING.selectionCount}</L>: words in the text you have selected.
            </li>
            <li>
              <L>{WRITING.bookCount}</L>, for chapters and scenes only: {WRITING.bookCountNote}.
            </li>
          </ul>
          <p>
            Counts change as you type and include changes you have not saved. On the <L>{NAV.records}</L> page, each
            manuscript chapter shows its word count, and the chapter group shows the <L>{WRITING.bookCount}</L> total of
            their saved text.
          </p>
          <details>
            <summary>What is counted</summary>
            <ul>
              <li>Only the words a reader would see. Markdown symbols such as ** and # are not counted.</li>
              <li>Link text is counted; link addresses, images, HTML tags and hidden comments are not.</li>
              <li>Scene-break lines such as *** count nothing.</li>
              <li>
                Hyphenated words count as one: &ldquo;well-known&rdquo; and &ldquo;mother-in-law&rdquo; are one word
                each.
              </li>
              <li>
                Apostrophes stay inside a word: &ldquo;don&apos;t&rdquo; and &ldquo;Mara&rsquo;s&rdquo; are one word
                each.
              </li>
              <li>Dashes separate words: &ldquo;yes&mdash;no&rdquo; is two words.</li>
              <li>Numbers such as 3.14, 1,000 and 10:30 are one word each.</li>
            </ul>
            <p>The same rules are used everywhere counts appear.</p>
          </details>
        </Sub>

        <Sub id="find-replace">
          <ol>
            <li>
              Type the text to look for in <L>{WRITING.find}</L>. The number of matches appears beside the buttons.
            </li>
            <li>
              Choose <L>{WRITING.next}</L> or <L>{WRITING.previous}</L>. The match is selected in the text and the count
              shows which one it is, for example &ldquo;2 of 5&rdquo;. In the <L>{WRITING.find}</L> box, Enter goes to the
              next match and Shift+Enter to the previous one.
            </li>
            <li>
              Type the new text in <L>{WRITING.replaceWith}</L>. Leave it empty to delete the matches.
            </li>
            <li>
              Choose <L>{WRITING.replace}</L> to change the selected match, or the next one after the cursor. The
              following match is then selected.
            </li>
            <li>
              Or choose <L>{WRITING.replaceAll}</L> to change every match at once.
            </li>
            <li>
              Choose <L>{RECORD.saveAsRevision("N")}</L> to keep the changes. Nothing is saved before that.
            </li>
          </ol>
          <ul>
            <li>
              The search matches exactly what you type, including symbols such as * or ?. Tick{" "}
              <L>{WRITING.matchCase}</L> to tell &ldquo;Salt&rdquo; from &ldquo;salt&rdquo;; otherwise case is ignored.
            </li>
            <li>
              It searches this record&apos;s text box only, not the title, structured fields, or other records. To find
              text in every chapter and scene, see <See anchor="manuscript-search" />.
            </li>
            <li>
              A replacement changes only the matched characters. Formatting symbols around them, such as the ** around a
              bold word, stay as they were.
            </li>
            <li>
              Undo a replacement with <kbd>Ctrl</kbd>+<kbd>Z</kbd> in the text box. <L>{WRITING.replaceAll}</L> undoes
              in one step. If your browser cannot add a replacement to its undo history, an{" "}
              <L>{WRITING.undoReplacement}</L> button appears instead.
            </li>
          </ul>
          <p className="warning">
            On a protected record, <L>{WRITING.replace}</L> and <L>{WRITING.replaceAll}</L> stay unavailable until you
            choose <L>{WRITE.enableEditing}</L>. The same control is in the find box. Saving still needs it. See{" "}
            <See anchor="protection" />.
          </p>
        </Sub>

        <Sub id="proofreading">
          <p>
            <L>{PROOFREAD.heading}</L> checks spelling, grammar and punctuation in this record&apos;s text with an OpenAI
            model. It uses the assistant&apos;s setup and is off until the assistant is set up (
            <See anchor="assistant-setup" />
            ). Without it, the box says so and everything else works as usual.
          </p>
          <ol>
            <li>
              Save your changes first. Proofreading checks the saved text, so while there are unsaved changes the buttons
              are unavailable and the box says <em>{PROOFREAD.saveFirst}</em>
            </li>
            <li>
              Select text in the text box and choose <L>{PROOFREAD.proofreadSelection}</L>, or choose{" "}
              <L>{PROOFREAD.proofreadDocument}</L> to check all of it. The approximate size and the limit are shown beside
              the buttons.
            </li>
            <li>
              Wait for the suggestions, or choose <L>{PROOFREAD.cancel}</L>.
            </li>
            <li>
              Each suggestion shows its category (spelling, grammar or punctuation), the original text struck through,
              the replacement, a short explanation and the text around it. The original is selected in the text box. Move
              with <L>{PROOFREAD.previous}</L> and <L>{PROOFREAD.next}</L>; <L>{PROOFREAD.showInText}</L> selects it
              again.
            </li>
            <li>
              Choose <L>{PROOFREAD.accept}</L> to change exactly that text in the text box, or <L>{PROOFREAD.dismiss}</L>{" "}
              to leave it. The next open suggestion is then shown.
            </li>
            <li>
              Choose <L>{RECORD.saveAsRevision("N")}</L> to keep accepted changes. Nothing is saved before that.
            </li>
          </ol>
          <ul>
            <li>
              Nothing changes until you accept a suggestion, one at a time. There is no &ldquo;accept all&rdquo;.
              Suggestions that would change more than 200 characters at once or add or remove a line break are left out,
              so paragraphs are never rewritten.
            </li>
            <li>
              To undo, choose <L>{PROOFREAD.undo}</L> on an accepted suggestion, or press <kbd>Ctrl</kbd>+<kbd>Z</kbd> in
              the text box. Once the original text is back, the suggestion is open again.
            </li>
            <li>
              The model is told to keep your voice and meaning, and to leave dialogue, dialect, slang and invented names
              and terms alone when they could be deliberate. It can still be wrong, so read each suggestion.
            </li>
            <li>
              Words from your <See anchor="dictionary" /> that appear in the text are sent with it as accepted
              spellings. A suggestion that would change one of them is left out. A name that only resembles a
              dictionary word can still be corrected.
            </li>
            <li>
              Suggestions work on the Markdown text in the box, not on formatted text. A suggestion that would add,
              remove or move formatting symbols such as ** or _, or that touches code, a link address, a URL or HTML, is
              left out. Symbols around a corrected word stay as they were.
            </li>
            <li>
              Each suggestion is tied to one place in the text. When the same words appear more than once, the text
              around them decides which place is meant; if it cannot, the suggestion is left out.
            </li>
            <li>
              Suggestions that could not be placed safely are listed under &ldquo;{PROOFREAD.leftOut("N")}&rdquo; with
              the reason. They are never applied.
            </li>
            <li>
              If the text at a suggestion, or right next to it, changes after proofreading (by typing, find and replace,
              or accepting an overlapping suggestion), the suggestion is marked <em>{PROOFREAD.stale}</em> and cannot be
              accepted. Suggestions elsewhere keep working. Save and proofread again to get fresh ones.
            </li>
            <li>
              On a protected record you can proofread and review suggestions, but <L>{PROOFREAD.accept}</L> and{" "}
              <L>{PROOFREAD.undo}</L> stay unavailable until you tick <L>{RECORD.unlockProtected}</L> The tick box is shown
              above the suggestions too. Saving still needs that tick. Proofreading never unlocks a record by itself.
            </li>
            <li>
              If the record was saved somewhere else after you opened the page, proofreading is refused. Reload the page
              first.
            </li>
            <li>
              If the model declines, stops at the output limit, or returns something unusable, the box says so and shows
              no suggestions. After an output-limit stop, proofread a shorter selection.
            </li>
            <li>
              Suggestions stay until you leave or reload the page, or choose <L>{PROOFREAD.clear}</L>. They are not
              saved.
            </li>
          </ul>
          <p className="warning">
            {PROOFREAD.privacyNote} Proofreading shares the assistant&apos;s request limits, monthly cap and usage count.
            See <See anchor="assistant-privacy" />.
          </p>
        </Sub>

        <Sub id="selection-assist">
          <p>
            On the <L>{WRITE.proofread}</L> tab (Write page and record pages), <L>{SELECTION_ASSIST.heading}</L> works on a
            text selection in the saved revision. Pin references on the <L>{WRITE.references}</L> tab first; those pins are the
            codex context sent with the selection.
          </p>
          <ol>
            <li>Save the chapter or scene so assist matches the saved text.</li>
            <li>Select text in the editor.</li>
            <li>
              Choose <L>{SELECTION_ASSIST.rewrite}</L>, <L>{SELECTION_ASSIST.expand}</L>, or{" "}
              <L>{SELECTION_ASSIST.describe}</L>.
            </li>
            <li>
              Review the suggestion. <L>{SELECTION_ASSIST.accept}</L> replaces only the selection in the text box;{" "}
              <L>{SELECTION_ASSIST.dismiss}</L> leaves your text unchanged.
            </li>
            <li>Save when ready, with the protection tick if the record is protected.</li>
          </ol>
          <p className="warning">
            {SELECTION_ASSIST.privacyNote} Writing assist shares the same assistant connection, hourly limit, monthly cap,
            and usage counters as proofreading and discussion. See <See anchor="assistant-privacy" />.
          </p>
        </Sub>

        <Sub id="formatting">
          <p>
            The text box is plain text. Formatting is written with Markdown symbols and stored exactly as typed. It is not
            shown formatted. On chapters and scenes, the formatting toolbar writes these symbols for you (see{" "}
            <See anchor="write-page" />
            ); other records have no formatting buttons.
          </p>
          <ul>
            <li>
              Bold: <code>**word**</code>
            </li>
            <li>
              Italics: <code>*word*</code> or <code>_word_</code>
            </li>
            <li>New paragraph: leave one blank line.</li>
            <li>
              Scene break: a line containing only <code>***</code> (or <code>* * *</code>).
            </li>
          </ul>
          <p>
            Undo and redo are the browser&apos;s own: <kbd>Ctrl</kbd>+<kbd>Z</kbd> to undo, and <kbd>Ctrl</kbd>+
            <kbd>Y</kbd> or <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> to redo (on a Mac, <kbd>Cmd</kbd> instead of{" "}
            <kbd>Ctrl</kbd>). The history lasts until you leave or reload the page, even after saving. After that, use{" "}
            <See anchor="saved-versions" />.
          </p>
        </Sub>
      </Section>

      <Section id="assistant">
        <p>
          The assistant lets you discuss chosen records or a manuscript passage with an OpenAI model, inside the app.
          It is optional and off until you set it up. Open a project and choose <L>{NAV.assistant}</L>.
        </p>
        <ul>
          <li>
            Discussing never changes records, even if you say yes or agree in the conversation. To change reference
            records, ask for a change proposal, review the exact changes, and apply that proposal yourself. See{" "}
            <See anchor="assistant-proposals" />.
          </li>
          <li>
            It does not use your ChatGPT account. It has no access to your ChatGPT memory, conversations, or Projects,
            and nothing appears in ChatGPT.
          </li>
          <li>It only sees what you include in each question. Nothing else from the workspace is sent.</li>
          <li>Conversations are saved in this app, separately for each project.</li>
          <li>
            The same setup turns on <L>{PROOFREAD.heading}</L> on record pages. See <See anchor="proofreading" />.
          </li>
        </ul>

        <Sub id="assistant-setup">
          <p>
            The assistant uses an OpenAI API key, which is separate from a ChatGPT subscription and billed separately by
            OpenAI. Setup happens in the <code>.env</code> file in the Story Loom folder, never in the app.
          </p>
          <ol>
            <li>Create an API key in your OpenAI API account (platform.openai.com).</li>
            <li>
              Open <code>.env</code> in a text editor and add two lines: <code>WORDLY_OPENAI_API_KEY=</code> followed by
              your key, and <code>OPENAI_MODEL=</code> followed by a model ID. Choose a text model from OpenAI&apos;s model
              list that supports the Responses API and that your API project can use.
            </li>
            <li>Save the file.</li>
            <li>
              Restart the app: press <kbd>Ctrl</kbd>+<kbd>C</kbd> in its terminal, then run <Cmd script="dev" /> again.
            </li>
            <li>
              Open <L>{NAV.assistant}</L>. The model ID and limits are shown at the top. If something is missing, the page
              says what.
            </li>
          </ol>
          <p className="warning">
            Keep the key only in <code>.env</code>. Do not paste it into the app, a record, a chat, or any file that is
            shared. <code>.env</code> is not saved to git. Never put the key in a variable whose name starts with{" "}
            <code>NEXT_PUBLIC_</code>; the assistant refuses to run if one is set.
          </p>
          <p>
            Story Loom uses only its own key. A key in the general <code>OPENAI_API_KEY</code> variable, which other
            apps on the computer may share, is ignored, and the assistant stays off until <code>WORDLY_OPENAI_API_KEY</code>{" "}
            is set. A separate key also lets you see this app&apos;s usage and spending on its own in your OpenAI account.
            Other shared OpenAI settings (organisation, project and server address) are not used either; if{" "}
            <code>OPENAI_CUSTOM_HEADERS</code> is set, the assistant stays off until it is removed.
          </p>
          <p>
            Without a key, the page explains what is missing and nothing can be sent. Everything else in the app works as
            usual. Optional limits are listed in <See anchor="assistant-privacy" />.
          </p>
        </Sub>

        <Sub id="assistant-context">
          <p>
            On Write, open the context rail and choose the <L>{ASSISTANT.tabAssistant}</L> tab for an in-page assistant:
            conversation selector, <L>{ASSISTANT.memory}</L>, <L>{ASSISTANT.expand}</L> to the full assistant page, scope
            (chapter / book / series), streaming answers with safe Markdown, source pills, coverage details, proposal
            cards, and suggested actions (<L>{ASSISTANT.checkContinuity}</L>, <L>{ASSISTANT.exploreOptions}</L>,{" "}
            <L>{ASSISTANT.prepareChanges}</L>). The composer draft and selected conversation are kept when you expand.
            Unsaved manuscript text stays in the editor; only the optional{" "}
            <L>{ASSISTANT.includeUnsavedProse}</L> tick sends it.
          </p>
          <p>
            The full assistant page still puts the conversation in the middle, with the question box under the latest
            message. What to send is chosen in <L>{ASSISTANT.contextHeading}</L>, the shared context rail on the right
            (collapse, resize, and overlay on a narrow window, same as Write). Closing the rail does not change what is
            sent. The line above the question box shows how many items are included and the approximate size.{" "}
            <L>{ASSISTANT.conversations}</L> stays in the left column of the assistant page. {ASSISTANT.toolsNote} Source
            links open the scene, the event, or the map the answer used.
          </p>
          <ol>
            <li>
              Under <L>{ASSISTANT.conversations}</L>, choose <L>{ASSISTANT.newConversation}</L>, or open an earlier
              conversation. You may edit <L>{ASSISTANT.conversationSummary}</L> and save it; a non-empty saved summary is
              sent with the next question. Under <L>{ASSISTANT.assistantSettings}</L>, turn on{" "}
              <L>{ASSISTANT.autoIncludeRecent}</L> only when you want recent complete messages filled into Include up to
              your character budget — nothing is inferred.
            </li>
            <li>
              Optionally choose <L>{ASSISTANT.findRelevantContext}</L> after you have a question and an open chapter or
              scene (whole text, or a selected passage). It derives soft terms from the open scene when there is no
              passage selection, labels them distinctly from a true selection, and always surfaces linked references.
              Preview the exact passages and saved revisions, remove or replace items, then{" "}
              <L>{ASSISTANT.findRelevantConfirm}</L> to add them to Include — nothing is sent yet. A reading pin alone
              never authorizes a send. You may tick <L>{ASSISTANT.includePinnedZeroDraft}</L> to also consider pins from
              the Zero draft. Find still uses the saved manuscript body unless Write supplies an unsaved body.
            </li>
            <li>
              In <L>{ASSISTANT.contextHeading}</L>, under <L>{ASSISTANT.references}</L>, tick the records to include. Each shows its type, canon status, saved
              version, and length. For a document with several headings, open <L>{ASSISTANT.sectionsHeading}</L> under it
              and tick only the sections you need instead; a ticked section includes its subsections, and ticking a
              section unticks the whole document. See <See anchor="long-documents" />.
            </li>
            <li>
              Under <L>{ASSISTANT.manuscript}</L>, choose a chapter (grouped by draft when drafts exist), or leave{" "}
              <L>{ASSISTANT.noManuscript}</L>. Choose <L>{ASSISTANT.wholeChapter}</L>, or <L>{ASSISTANT.passageOnly}</L>:
              select text in the chapter shown, then choose <L>{ASSISTANT.usePassage}</L>. The chosen characters and the
              start of the passage are shown.
            </li>
            <li>
              To give the assistant earlier parts of the conversation, tick <L>{ASSISTANT.includeMessage}</L> on those
              messages, or use <L>{ASSISTANT.includeAll}</L> and <L>{ASSISTANT.includeNone}</L>. When auto-include is on,
              the rail shows which messages the budget selected; you can still untick before send. Unticked messages are
              not sent. Oversized requests are refused; there is no automatic retry.
            </li>
            <li>
              Check <L>{ASSISTANT.summaryHeading}</L>. It lists every item, its saved version, and its length, with an
              approximate total against the limit (including a saved conversation summary when present).
            </li>
            <li>
              Type your question in the box under the conversation and choose <L>{ASSISTANT.send}</L>. The conversation
              scrolls to the newest message unless you have scrolled up to read an earlier one.
            </li>
          </ol>
          <p>
            Records and chosen sections are sent whole; nothing is cut to fit. If the total is over the limit, <L>{ASSISTANT.send}</L> stays
            unavailable. If the app refuses a question as too large, it lists each item&apos;s size and how many characters
            to remove. Untick records or earlier messages, or choose a shorter passage.
          </p>
          <p>
            If a selected record is saved somewhere else after you selected it, the app refuses to send and reloads the
            list. Check the new version and send again.
          </p>
          <p>
            Assistant conversations (including summaries), messages, context items, proposals, and project assistant
            preferences can be included in workspace backups. Older backups that omit those keys restore with empty
            conversations and default preferences. Proofread runs stay in SQLite only and are not in the backup file.
          </p>
        </Sub>

        <Sub id="assistant-answers">
          <p>
            The answer appears as it is written. Under each answer, <em>Used</em> lists the records, saved versions, and
            passage that were sent, and how many earlier messages were included. Token counts reported by OpenAI are
            shown; counts marked as an estimate were worked out by the app.
          </p>
          <ul>
            <li>
              <L>{ASSISTANT.olderVersion}</L> means at least one record used has been saved again since. The old and new
              version numbers are shown. Ask again to discuss the current version.
            </li>
            <li>
              {ASSISTANT.proposalsNote} The assistant is told to put suggestions under a heading saying they are proposals.
              Approving an idea is up to you: edit the record yourself, or ask for a change proposal (
              <See anchor="assistant-proposals" />).
            </li>
            <li>
              Imported text is sent as source material. The assistant is told not to follow instructions found inside
              records or passages.
            </li>
            <li>
              Choose <L>{ASSISTANT.cancel}</L> to stop an answer. The part already written is kept and marked cancelled.
            </li>
            <li>
              A failed or cancelled answer shows the reason and <L>{ASSISTANT.retry}</L>. Retry sends the same question,
              the same saved versions of the same records, and the same earlier messages. It is never retried
              automatically.
            </li>
            <li>An answer stopped by the output limit is marked incomplete.</li>
            <li>
              <L>{ASSISTANT.deleteConversation}</L> asks you to tick <L>{ASSISTANT.confirmDelete}</L> first. Records are
              not affected.
            </li>
          </ul>
        </Sub>

        <Sub id="assistant-proposals">
          <p>
            A change proposal is a change package the assistant prepares for reference records. It is applied through
            the same checks as <See anchor="change-package-import" />, and only when you choose to apply it.
          </p>
          <ol>
            <li>
              Choose the records to change under <L>{ASSISTANT.references}</L>. The assistant can only change records you
              include; it can also suggest new reference records. A chapter or passage can be included as source
              material, but manuscript text is never changed.
            </li>
            <li>
              Describe the change in the question box and choose <L>{ASSISTANT.prepare}</L>. Your request is
              marked <em>{ASSISTANT.proposalRequest}</em>. Nothing is changed yet.
            </li>
            <li>
              The <L>{ASSISTANT.proposalHeading}</L> under the answer lists the records it would change and whether it can
              be applied. Choose <L>{ASSISTANT.reviewProposal}</L> to open the review page. See{" "}
              <See anchor="change-review" />.
            </li>
            <li>
              The review page shows each change exactly: titles, text differences, structured fields, canon status, and
              the saved version each change expects. Records that may need review are listed under{" "}
              <em>{REVIEW.affectedHeading}</em>; they are not changed.
            </li>
            <li>
              If the proposal adds or changes canon, the review summary lists which records and asks you to tick{" "}
              <L>{REVIEW.confirmCanon}</L>.
            </li>
            <li>
              Choose <L>{REVIEW.apply("N")}</L>. That applies exactly the changes shown, as one package. There is no
              further question.
            </li>
            <li>
              The result lists each changed record with its old and new saved version, and the items added to review.
              The proposal under the answer then shows it was applied, and the package appears under{" "}
              <L>{NAV.history}</L>. <L>{REVIEW.backToDiscussion}</L> returns to the proposal in its conversation.
            </li>
          </ol>
          <ul>
            <li>
              Saying yes in the conversation does not apply a proposal. Only <L>{REVIEW.apply("N")}</L> on the review page
              does.
            </li>
            <li>
              The app, not the assistant, sets the package ID, the project, the saved versions expected, and the
              approval. Proposals never unlock protected records and never change manuscript chapters. A proposal that
              touches a protected record shows the problem and cannot be applied.
            </li>
            <li>
              New records start as proposed unless you asked for something else. Promoting a record to approved,
              creating an approved record, or changing an approved record needs the canon tick.
            </li>
            <li>
              If a record changes after the proposal was prepared, the proposal is shown as out of date and cannot be
              applied. Go back to the discussion and choose <L>{ASSISTANT.prepare}</L> again; the new proposal uses the
              current versions.
            </li>
            <li>
              Applying twice changes nothing the second time. If applying fails part-way, nothing is saved.
            </li>
            <li>
              Other records are never rewritten to match. When a record&apos;s structured fields and its text seem to
              disagree, for example an <code>age</code> field that changes while the text still gives the old age, a
              review note is added instead.
            </li>
            <li>
              If the assistant declines, stops at the output limit, or returns something unusable, the answer says
              nothing was prepared. A failed proposal can be retried.
            </li>
            <li>
              <em>Package JSON</em> on a proposal holds the package marked proposed, with <L>{ASSISTANT.copyPackage}</L>.
              Pasted into <L>{NAV.importPackage}</L> it can be previewed, but only a package marked approved can be
              applied there.
            </li>
          </ul>
        </Sub>

        <Sub id="assistant-privacy">
          <p className="warning">{ASSISTANT.privacyNote}</p>
          <p>
            Requests ask OpenAI not to store the response for later retrieval. OpenAI still keeps request data for abuse
            monitoring, normally for up to 30 days, so this is not zero retention. See OpenAI&apos;s data controls for
            current details. The app does not write manuscript or record text to its log.
          </p>
          <p>
            The app has its own limits, set in <code>.env</code>. Each has a default, and the page shows how much is used.
          </p>
          <ul>
            <li>
              <code>ASSISTANT_MAX_INPUT_CHARS</code>: characters per request, including selections and earlier messages,
              or the text sent for proofreading (default 600,000).
            </li>
            <li>
              <code>ASSISTANT_MAX_OUTPUT_TOKENS</code>: longest answer or proofreading result (default 2,000 tokens).
            </li>
            <li>
              <code>ASSISTANT_MAX_REQUESTS_PER_HOUR</code>: requests per hour (questions, change proposals and
              proofreading), across all workspaces (default 30).
            </li>
            <li>
              <code>ASSISTANT_MONTHLY_TOKEN_CAP</code>: tokens per calendar month (UTC), across all workspaces (default
              300,000). A question is refused if its estimated size plus the longest possible answer would pass the cap.
            </li>
            <li>
              <code>ASSISTANT_REQUEST_TIMEOUT_SECONDS</code>: how long to wait for an answer (default 120).
            </li>
          </ul>
          <p>
            <L>{ASSISTANT.usageHeading}</L> on the <L>{NAV.assistant}</L> page adds up the tokens OpenAI reported for
            answers and proofreading, plus estimates for cancelled requests and requests without a report. It is this app&apos;s count, not your OpenAI bill, and the app shows no prices. The
            cap is not a hard spending cap: estimates can be wrong, and other use of the same key is not counted. Budget
            alerts in your OpenAI account are notifications, not hard caps either. Check usage in your OpenAI account.
          </p>
        </Sub>
      </Section>

      <Section id="chatgpt">
        <p className="warning">
          ChatGPT cannot read or update this app. You move information by hand: an export file goes to ChatGPT, and a
          change package comes back.
        </p>
        <ol>
          <li>
            Open the project and choose <L>{NAV.exportContext}</L>.
          </li>
          <li>
            Tick the records relevant to your discussion. Ticking a type name ticks all records of that type.
            Manuscript chapters and scenes start unticked.
          </li>
          <li>
            Leave <L>{EXPORT.includeSchema}</L> ticked. It tells ChatGPT the exact format to use.
          </li>
          <li>
            Choose <L>{EXPORT.generate("N")}</L>.
          </li>
          <li>
            Choose <L>{EXPORT.download}</L> to save the file, or <L>{EXPORT.copy}</L>.
          </li>
          <li>Attach the file to a ChatGPT conversation, or paste the copied text.</li>
          <li>Paste the instruction below into the same message.</li>
          <li>Discuss your ideas. When you are sure, tell ChatGPT plainly which changes you approve.</li>
          <li>Ask ChatGPT to prepare a change package for the approved changes, using the format in the export.</li>
          <li>Save ChatGPT&apos;s answer as a .json file, or copy its text.</li>
          <li>
            In Story Loom, import the package with <L>{NAV.importPackage}</L>. See{" "}
            <See anchor="change-package-import" />.
          </li>
          <li>Review the differences.</li>
          <li>
            Choose <L>{REVIEW.apply("N")}</L> to apply the changes you intended.
          </li>
          <li>
            Open the changed records from the summary, then check <L>{NAV.history}</L>.
          </li>
        </ol>
        <h3>Instruction to give ChatGPT</h3>
        <pre>{CHATGPT_INSTRUCTION}</pre>
        <div>
          <CopyButton text={CHATGPT_INSTRUCTION} label="Copy instruction" />
        </div>

        <Sub id="context-export">
          <p>
            A context export is a snapshot of the records you ticked: their current text, IDs, saved-version numbers,
            canon status, and protection, plus instructions for ChatGPT. It does not stay in step with the app.
          </p>
          <p className="warning">
            After you change records (by editing, importing, or applying a package), export again and give ChatGPT the new
            file. A package built from an old export will be refused.
          </p>
          <p>
            A record whose headings carry status tags also lists them, word for word, and the export tells ChatGPT that
            those markings govern their own sections. See <See anchor="section-status" />.
          </p>
          <p>
            An export is not a backup. It leaves out earlier saved versions and unticked records, and it cannot be
            restored. For safekeeping, see <See anchor="full-backup" />.
          </p>
        </Sub>

        <Sub id="chatgpt-direct">
          <p className="warning">
            ChatGPT is not connected to this app. Choose <L>{SHELL.connections}</L> to see the checks this computer has
            actually made. A local read-only adapter is not a ChatGPT connection, and it cannot save changes.
          </p>
          <p>The page has two parts:</p>
          <ul>
            <li>
              <L>{CONNECTIONS.assistantHeading}</L> is the optional assistant inside Story Loom. See{" "}
              <See anchor="assistant" />.
            </li>
            <li>
              <L>{CONNECTIONS.chatgptHeading}</L> is ChatGPT calling Story Loom. It shows the{" "}
              <L>{CONNECTIONS.localAdapter}</L> and <L>{CONNECTIONS.chatgpt}</L> separately.
            </li>
          </ul>
          <p>The states mean:</p>
          <ul>
            <li>
              <L>{CONNECTIONS.notConfigured}</L>: the setting or grant file for that part is missing or not usable.
            </li>
            <li>
              <L>{CONNECTIONS.localAdapterReady}</L>: the read-only adapter on this computer accepted its grant and listed
              its tools. ChatGPT was not contacted.
            </li>
            <li>
              <L>{CONNECTIONS.connectionNotVerified}</L>: something is set up locally, and no live connection was checked.
            </li>
            <li>
              <L>{CONNECTIONS.disabled}</L>: the adapter is turned off, or its grant is revoked. Calls are refused.
            </li>
          </ul>
          <p>
            Under <L>{CONNECTIONS.grantHeading}</L> on the same page you choose what the adapter may read, without editing
            any file:
          </p>
          <ul>
            <li>
              <L>{CONNECTIONS.grantActive}</L>: untick it to refuse every request. Your project choices are kept for when you
              turn it on again.
            </li>
            <li>
              <L>{CONNECTIONS.grantProjects}</L>: tick each project it may read. Projects that are not ticked cannot be
              listed or read.
            </li>
            <li>
              <L>{CONNECTIONS.grantManuscript}</L>: leave it unticked to allow reference documents only (series bible,
              characters, worldbuilding and so on).
            </li>
          </ul>
          <p>
            Choose <L>{CONNECTIONS.grantSave}</L>. The settings are saved to the grant file shown on the page (normally{" "}
            <code>mcp/grant.json</code>, which is never saved to git). The adapter reads that file on every request, so a
            change applies to the next one. Reading is the only permission it can have; this page cannot give ChatGPT a
            way to save changes. If the file has been edited by hand and cannot be read, the page lists the problems
            and leaves the file alone until you fix or remove it.
          </p>
          <p>
            <Cmd script="mcp:stdio" /> speaks the read-only protocol on this computer. It does not open a network port.
            Running it does not connect ChatGPT, and the Connections page does not treat a running command as a live
            connection. Setting <code>WORDLY_MCP_DISABLED=1</code> in <code>.env</code> turns the adapter off whatever the
            page says.
          </p>
          <p>
            The adapter can list permitted projects, search reference records, read current records, list a
            document&apos;s sections and read one section at a time, and read saved versions and change history. It
            cannot apply updates. Updates from a ChatGPT conversation still come back as
            a change package you review and apply yourself. See <See anchor="change-package-import" />.
          </p>
          <p className="warning">
            Do not make the app reachable from the internet or point a tunnel or forwarding service at it. The app has no
            sign-in. Connecting ChatGPT needs a separate decision after you check your account. The assessment, including
            the account checks and the remaining decisions, is in <code>docs/future-chatgpt-connection.md</code>.
          </p>
        </Sub>
      </Section>

      <Section id="reviewing">
        <Sub id="change-package-import">
          <p>
            A change package is a file containing proposed updates, usually prepared by ChatGPT. Nothing changes until
            you apply it.
          </p>
          <ol>
            <li>
              Open the project and choose <L>{NAV.importPackage}</L>.
            </li>
            <li>Choose the package file, or paste its text into the box.</li>
            <li>
              Choose <L>{PACKAGE_IMPORT.validate}</L>. The app checks the whole package and opens the review screen.
              Nothing is saved yet.
            </li>
            <li>
              Read the changes on the review screen. See <See anchor="change-review" />.
            </li>
            <li>
              If the package lists protected records as overrides, tick <L>{REVIEW.confirmProtected}</L>
            </li>
            <li>
              Choose <L>{REVIEW.apply("N")}</L>.
            </li>
          </ol>
          <p>
            After applying you see <em>{REVIEW.applied}</em> and a summary with links to each changed record.
          </p>
          <p>
            A package is applied only if it says you approved it. One marked as proposed can be reviewed but not
            applied, so ideas cannot become canon by accident.
          </p>
          <p>
            The screen always checks and applies the text you validated. To use different text, choose{" "}
            <L>{PACKAGE_IMPORT.changeText}</L> (or <L>{REVIEW.backToPackageText}</L>), edit it, and validate again. When
            the package&apos;s source names a conversation from this project&apos;s <L>{NAV.assistant}</L>, the screen
            links to it and offers <L>{REVIEW.backToDiscussion}</L> instead.
          </p>
        </Sub>

        <Sub id="change-review">
          <p>
            The review screen is used for imported packages and for assistant proposals. It shows exactly what applying
            would do, checked against the current records. The package is applied as a whole: every change is saved, or
            none is. Choosing a record only changes which comparison you see; it never leaves a change out.
          </p>
          <p>
            At the top are the package&apos;s summary, its ID and scope, where it came from, and its state:{" "}
            <em>{REVIEW.stateReady}</em>, <em>{REVIEW.stateStale}</em>, <em>{REVIEW.stateNotApproved}</em>, or the number
            of problems. Below are three areas side by side. In a narrower window the list and summary sit beside the
            comparison, then everything stacks in one column.
          </p>
          <ul>
            <li>
              <L>{REVIEW.recordsHeading}</L> lists each record with its type and what changes, for example{" "}
              <em>Text</em>, <em>2 fields</em>, or <em>New record</em>, and marks it <em>{REVIEW.badgeManuscript}</em>,{" "}
              <em>{REVIEW.badgeStale}</em>, or <em>{REVIEW.badgeProblem}</em> where that applies. Choose one to see its
              changes. With a record
              selected, the Up and Down arrow keys, Home and End move through the list. <L>{REVIEW.previous}</L> and{" "}
              <L>{REVIEW.next}</L> do the same.
            </li>
            <li>
              The comparison shows <L>{REVIEW.detailsHeading}</L> (title, canon status, superseded-by, and structured
              fields) separately from the <L>{REVIEW.textHeading}</L>. Each detail shows a box labelled{" "}
              <em>{REVIEW.removed}</em> with the old value and a box labelled <em>{REVIEW.added}</em> with the new one.
            </li>
            <li>
              In a wide comparison the text appears in two columns: <em>{REVIEW.current("N")}</em> and{" "}
              <em>{REVIEW.afterApplying}</em>. When it is narrow the text appears once, with changes marked in place.{" "}
              <del className="diff-sample">Removed text is struck through</del> and{" "}
              <ins className="diff-sample">added text is underlined</ins>; screen readers announce them as Removed and
              Added. Line breaks and spacing are kept.
            </li>
            <li>
              Long unchanged stretches are folded into a line such as <em>{REVIEW.unchangedLines(12)}</em>. Choose it to
              show the text.
            </li>
            <li>
              A new record says <em>{REVIEW.newRecordBefore}</em> and shows the text it will have.{" "}
              <em>{REVIEW.emptyText}</em> marks a record that has no text now; <em>{REVIEW.allTextRemoved}</em> marks a
              change that empties it.
            </li>
          </ul>
          <p>
            <L>{REVIEW.summaryHeading}</L> on the right covers the whole package:
          </p>
          <ul>
            <li>How many records are updated and how many are created.</li>
            <li>
              <em>{REVIEW.manuscriptUnchanged}</em> appears only when no change touches a chapter or scene. Otherwise it
              names the manuscript records that change. Chapters that only mention a changed name are counted, not
              changed.
            </li>
            <li>
              <L>{REVIEW.protectionHeading}</L>: protected records the package changes, and whether each is listed as an
              override. A package cannot give itself permission: an override needs your tick on{" "}
              <L>{REVIEW.confirmProtected}</L>, and a protected record that is not listed cannot be changed.
            </li>
            <li>
              <L>{REVIEW.revisionsHeading}</L>: the saved version each change expects and the record&apos;s current
              version. <em>{REVIEW.revisionsVerified}</em> means they all match. The screen checks again when you come
              back to the window, every 30 seconds while it is visible, and when you choose <L>{REVIEW.checkAgain}</L>.
            </li>
            <li>
              <L>{REVIEW.affectedHeading}</L>: records that mention a changed record&apos;s title, name, or aliases, plus
              records the package lists for follow-up. They are not changed. When you apply, they are added to{" "}
              <L>{HISTORY.openReviewItems}</L>.
            </li>
          </ul>
          <p>
            <L>{REVIEW.apply("N")}</L> is available only when the package is ready and every required tick is given. It
            shows <em>{REVIEW.applying}</em> while it works, and pressing it again does nothing until the result is
            back.
          </p>
          <h3>When something is wrong</h3>
          <ul>
            <li>
              If the check finds a problem, the state shows how many and the problems are listed. There is no apply
              button. No part of the package is saved. Yellow warnings do not stop the package.
            </li>
            <li>
              If applying is refused, you see <em>{REVIEW.rejected}</em> with the reasons, and the screen checks the
              records again.
            </li>
            <li>
              If the app cannot confirm the result, for example because the connection dropped, you see that either every
              change was saved or none was, and the screen checks again to find out.
            </li>
          </ul>
        </Sub>
        <dl>
          <dt>Already applied</dt>
          <dd>
            Validating the same package again shows <em>{REVIEW.stateAlreadyApplied}</em> and the earlier result. If it
            was applied in another tab while the screen was open, applying shows <em>{REVIEW.alreadyApplied}</em> This is
            safe; nothing is changed twice.
          </dd>
          <dt>Out of date</dt>
          <dd>
            <em>{REVIEW.stateStale}</em> means a record was saved again after the package was prepared. If that happens
            while the screen is open, it also says <em>{REVIEW.becameStale}</em> The package cannot be applied, and the
            app never updates its expected versions for you. The record shows a <code>STALE_REVISION</code> problem
            naming the version the package expected. For an imported package, export the context again, give ChatGPT the
            new file, and ask for a new package. For an assistant proposal, go back to the discussion and prepare a new
            proposal. Do not edit the numbers by hand; the package was written against the older text.
          </dd>
          <dt>Package ID already used</dt>
          <dd>
            Every package has an ID. The app uses it to recognise packages it has already applied. A different package
            with a used ID is refused (<code>PACKAGE_ID_CONFLICT</code>). Ask ChatGPT for a new package ID.
          </dd>
        </dl>

        <Sub id="review-items">
          <p>
            <L>{NAV.history}</L> shows <L>{HISTORY.openReviewItems}</L>: records that might need follow-up because a
            related record changed. The app never updates related records itself.
          </p>
          <ol>
            <li>Open the record from the list.</li>
            <li>Decide whether it needs a change, and edit it if so.</li>
            <li>
              Back on <L>{NAV.history}</L>, choose <L>{HISTORY.resolve}</L>.
            </li>
          </ol>
          <p>
            <L>{HISTORY.resolve}</L> only removes the item from the list. It does not change the record. Resolved items are
            no longer shown; the resolution is noted in the <L>{HISTORY.auditLog}</L>.
          </p>
          <p>
            The same page lists <L>{HISTORY.appliedPackages}</L> and the <L>{HISTORY.auditLog}</L> of every change.
          </p>
        </Sub>
      </Section>

      <Section id="trash">
        <p>
          Nothing is deleted in one step. You first move a document, chapter, scene, project or workspace to the Trash,
          where it waits, hidden, until you restore it or delete it permanently.
        </p>
        <Sub id="move-to-trash">
          <ul>
            <li>
              <strong>A reference document, scene note, chapter or scene:</strong> open it. At the bottom of the page (on
              the writing page, at the bottom of the record details below the editor) find <L>{TRASH.sectionHeading}</L>{" "}
              and choose <L>{TRASH.moveRecord}</L>.
            </li>
            <li>
              <strong>A project:</strong> on the home page, choose the actions button (three dots) on that manuscript,
              then <L>{TRASH.moveProject}</L>.
            </li>
            <li>
              <strong>A workspace:</strong> on the home page, choose the actions button on that workspace, then{" "}
              <L>{TRASH.moveWorkspace}</L>.
            </li>
          </ul>
          <p>
            The app asks first. Choose the button that names the item, for example{" "}
            <L>{TRASH.confirmMove("Chapter 3")}</L>, or <L>{TRASH.cancel}</L>.
          </p>
          <ul>
            <li>
              A chapter takes its scenes and all their notes with it; a scene takes its notes. The confirmation lists
              them. They come back together when you restore it.
            </li>
            <li>
              If anything being moved is protected (chapters and scenes are, by default), tick{" "}
              <L>{TRASH.unlockProtected}</L> first.
            </li>
            <li>
              A project or workspace takes everything in it. Its records keep their own state, so a document that was
              already in the Trash stays there when the project comes back.
            </li>
          </ul>
          <p>
            Anything in the Trash disappears from the home page, the navigation, lists, search, word counts, PDF and
            context exports, the assistant, linked references, open review items and the ChatGPT adapter. Change packages
            and imports cannot change it or use it as a parent. Nothing is removed: its saved versions, images, links and
            history are kept, and it is still included in backups.
          </p>
        </Sub>
        <Sub id="trash-page">
          <p>
            Open <L>{SHELL.settings}</L> at the bottom of the left navigation, then choose <L>{SHELL.trash}</L>. The page lists
            workspaces, projects, and documents, chapters and scenes in the Trash, with when each was moved.
          </p>
          <ul>
            <li>
              <L>{TRASH.restore}</L> puts it back where it was, unchanged. A scene whose chapter is also in the Trash
              cannot come back on its own: restore the chapter first. The same goes for a project in a workspace in the
              Trash.
            </li>
            <li>
              <L>{TRASH.downloadBackup}</L> beside a workspace downloads a backup file of it, as on the{" "}
              <L>{SHELL.backups}</L> page.
            </li>
            <li>
              <L>{TRASH.deletePermanently}</L> asks you to confirm, then removes the item and everything inside it from the
              database: its saved versions, images, links, imported files, review items and proofreading records.
            </li>
            <li>
              <L>{TRASH.emptyTrash}</L> does the same for everything on the page at once.
            </li>
          </ul>
          <p>
            Before deleting anything permanently, the app writes a full backup to a new folder under <code>backups/</code>{" "}
            in the Story Loom folder, named with the date and <code>before-permanent-delete</code>. It holds a copy of
            the database file and one backup file per workspace, including everything in the Trash. If the backup cannot
            be written, nothing is deleted. When deletion finishes, the page names the folder. To get something back, restore
            its workspace from that folder on the <L>{SHELL.backups}</L> page (see <See anchor="restore" />).
          </p>
          <p>
            A document cannot be deleted permanently while another record is marked superseded by it. The page says which
            record; change that record&apos;s status first.
          </p>
        </Sub>
      </Section>

      <Section id="backup">
        <Sub id="full-backup">
          <p>A backup is a complete copy of a workspace that you can restore later.</p>
          <ol>
            <li>
              Open <L>{SHELL.settings}</L> at the bottom of the left navigation, then choose <L>{SHELL.backups}</L>.
            </li>
            <li>
              Under <L>{BACKUP.downloadHeading}</L>, choose the workspace name.
            </li>
            <li>
              Your browser downloads a file ending in <code>.wordly-backup.json</code>.
            </li>
          </ol>
          <p>
            It holds everything in that workspace: projects, records, every saved version and where it came from, canon
            status, protection, applied change packages, the audit log, open review items, the original imported files,
            images attached to documents, and the project and workspace dictionaries. Each file covers one workspace.
            Anything in the Trash is included and is still in the Trash after a restore; a restored workspace itself
            always starts outside the Trash. A workspace in the Trash is not listed here; download its backup from the{" "}
            <L>{SHELL.trash}</L> page.
          </p>
          <details>
            <summary>Backing up every workspace at once</summary>
            <p>
              Run <Cmd script="db:backup" />. It only reads your data. It writes a folder under <code>backups/</code>{" "}
              in the Story Loom folder with a copy of the database file and one backup file per workspace.
            </p>
          </details>
          <p>Make a backup before importing many files, before applying a large package, and at the end of a work session.</p>
          <p className="warning">
            A backup on this computer will not help if the computer is lost or broken. Copy backup files to another place
            you control, such as an external drive.
          </p>
          <p>
            A backup is different from a context export. A backup is for safekeeping and can be restored. A context
            export is a snapshot of selected records for ChatGPT and cannot be restored.
          </p>
        </Sub>

        <Sub id="backup-mirror">
          <p>
            On <L>{SHELL.backups}</L>, <L>{BACKUP.mirrorHeading}</L> can copy each <strong>full</strong> backup into
            another folder after it is written under <code>backups/</code>. That folder can live inside Dropbox, OneDrive,
            or any path you choose. The repository includes <code>docs/backup-sync.md</code> with the same workflow for
            terminal use.
          </p>
          <p>{BACKUP.mirrorWarning}</p>
          <ul>
            <li>
              Mirroring applies to <Cmd script="db:backup" />, pre-migrate backups, and backups before permanent delete.
              It does not apply to workspace JSON downloads from this page.
            </li>
            <li>
              Check a mirrored folder with <code>pnpm db:verify-backup</code> and the timestamped subfolder path before
              you rely on it for a restore.
            </li>
            <li>
              <code>WORDLY_BACKUP_MIRROR_DIR</code> in <code>.env</code> overrides the path saved in the app.
            </li>
          </ul>
        </Sub>

        <Sub id="restore">
          <p>Restoring adds a copy of the backup as a new workspace. It never overwrites your current work.</p>
          <ol>
            <li>
              Open <L>{SHELL.settings}</L> at the bottom of the left navigation, then choose <L>{SHELL.backups}</L>.
            </li>
            <li>
              Under <L>{BACKUP.restoreHeading}</L>, choose the backup file.
            </li>
            <li>The app checks the whole file and shows what it contains. Nothing is saved yet.</li>
            <li>Check or change the name for the restored workspace.</li>
            <li>
              Choose <L>{BACKUP.restore}</L>.
            </li>
          </ol>
          <p>
            The restored workspace appears on the home page beside your existing ones. Its records get new IDs, so export
            context again from the restored copy before using ChatGPT with it.
          </p>
          <details>
            <summary>Checking a backup from the terminal</summary>
            <p>
              <Cmd script="db:restore" args="<file> --dry-run" /> checks a backup and summarises it without changing
              anything. <Cmd script="db:restore" args="<file> --new-database <path>" /> restores it into a separate new
              database file, keeping the original IDs.
            </p>
          </details>
        </Sub>
      </Section>

      <Section id="troubleshooting">
        <dl>
          <dt>The app will not open</dt>
          <dd>
            If the browser cannot connect, the app is not running. Run <Cmd script="dev" /> in the Story Loom folder,
            wait until it is ready, then open the address the terminal shows (normally <a href={APP_URL}>{APP_URL}</a>).
            If the terminal says port 2112 is in use, something else is using that port. Often it is the app
            itself, still running in another terminal; use that copy, or stop it with <kbd>Ctrl</kbd>+<kbd>C</kbd> there
            and start again, rather than keeping two copies running. If an error mentions the database, run{" "}
            <Cmd script="db:info" /> to see which file is used and check <code>.env</code>. Do not delete the database.
          </dd>

          <dt>A file will not import</dt>
          <dd>
            Read the message beside the file. Only <code>.md</code> and <code>.markdown</code> files that are not empty
            and are under 5 MB can be imported. Every file needs a type, canon status, protection, and action. Only
            reference types are allowed. A replacement must keep the record&apos;s type. See{" "}
            <See anchor="importing" />.
          </dd>

          <dt>A possible duplicate appears</dt>
          <dd>
            Open the linked record and compare. Then choose <L>{MARKDOWN_IMPORT.createNew}</L>,{" "}
            <L>{MARKDOWN_IMPORT.replacePrefix}</L>, or <L>{MARKDOWN_IMPORT.skip}</L>. See <See anchor="duplicates" />.
          </dd>

          <dt>An update is based on an older saved version</dt>
          <dd>
            The record was saved after you started (in another tab, by an import, or by a package). On a record page,
            copy your typing, reload the page, paste your changes into the newest version, and save. For a change
            package, export the context again and ask ChatGPT for a new package.
          </dd>

          <dt>A package was already applied</dt>
          <dd>
            Nothing more is needed; it will not be applied twice. If you meant to make new changes, ask ChatGPT for a new
            package with a new package ID.
          </dd>

          <dt>A record is protected</dt>
          <dd>
            On the record page, tick <L>{RECORD.unlockProtected}</L> and save again. For imports and packages, tick the
            confirmation box before applying. A package can only change a protected record if it lists that record as
            allowed, so ask ChatGPT for that only when you mean it. See <See anchor="protection" />.
          </dd>

          <dt>A replacement left a structured field unchanged</dt>
          <dd>
            This is expected. Replacing a record from a Markdown file changes only its title, text, and canon status.
            Edit the field in <L>{RECORD.editHeading}</L> on the record page and save.
          </dd>

          <dt>An expected related record was not flagged</dt>
          <dd>
            The app only looks for related records when a change package is applied, not when you edit or import. It
            finds exact matches of the changed record&apos;s title, <code>name</code>, or <code>aliases</code> (three or
            more characters). Nicknames that are not listed as aliases and pronouns are missed. Add aliases to the
            record&apos;s structured fields, ask ChatGPT to list related records in the package, and check related records
            yourself.
          </dd>

          <dt>Spelling mistakes are not underlined</dt>
          <dd>
            Look at <L>{SPELLING.checker}</L>. With <L>{SPELL_CHECKERS[0].label}</L>, the box beside it says{" "}
            <em>{SPELLING.loading}</em> until the word list has loaded; underlines appear a moment after you stop typing.
            If it says the checker could not start, reload the page; if that keeps happening, the word list files may be
            missing, so stop the app, run <code>pnpm install</code>, and start it again. With{" "}
            <L>{SPELL_CHECKERS[1].label}</L>, checking is done by your browser: check that spell check is turned on in
            its settings and that the English you chose in <L>{WRITING.spellingLanguage}</L> is installed there. Some
            browsers only underline words after you click into the text box. See <See anchor="spelling" />.
          </dd>

          <dt>A name is underlined even though it is in the dictionary</dt>
          <dd>
            Compare the spelling and capitals letter by letter with the entry on the <L>{NAV.dictionary}</L> page. With{" "}
            <L>{DICTIONARY.matchCase}</L> ticked, &ldquo;ALDRETH&rdquo; is not the same as &ldquo;Aldreth&rdquo;. A
            project word is not accepted in other projects; move it to the workspace dictionary with{" "}
            <L>{DICTIONARY.edit}</L> if the whole series uses it. The browser&apos;s checker never uses your dictionary.
            See <See anchor="dictionary" />.
          </dd>

          <dt>A backup will not restore</dt>
          <dd>
            You see <em>{BACKUP.cannotRestore}</em> Your existing work is unchanged. Make sure the file ends in{" "}
            <code>.wordly-backup.json</code> and is not a context export. The file must be exactly as downloaded; any edit
            makes the check fail. Try another backup, or run <Cmd script="db:restore" args="<file> --dry-run" /> for a
            detailed report.
          </dd>

          <dt>The assistant says it is not set up</dt>
          <dd>
            The page lists what is missing. Check the <code>WORDLY_OPENAI_API_KEY</code> and <code>OPENAI_MODEL</code>{" "}
            lines in <code>.env</code>, then restart the app. A key under the older name <code>OPENAI_API_KEY</code> is not
            used: rename that line to <code>WORDLY_OPENAI_API_KEY</code>. Changes to <code>.env</code> are read only when the app starts. See{" "}
            <See anchor="assistant-setup" />.
          </dd>

          <dt>An assistant answer failed</dt>
          <dd>
            Read the reason under the answer. A rejected key (401) or missing model (404) means the <code>.env</code>{" "}
            settings need fixing, followed by a restart. A rate limit or quota message (429) comes from OpenAI: wait, or
            check usage and billing in your OpenAI account. For connection or timeout errors, check the internet
            connection and choose <L>{ASSISTANT.retry}</L>.
          </dd>

          <dt>A change proposal cannot be applied</dt>
          <dd>
            Choose <L>{ASSISTANT.reviewProposal}</L> and read the problems on the review page. <em>{REVIEW.stateStale}</em>{" "}
            means a record changed after the proposal was prepared: go back to the discussion and prepare a new proposal.
            A protected record must be changed by hand, or unprotected first. A canon change needs{" "}
            <L>{REVIEW.confirmCanon}</L> ticked. See <See anchor="change-review" />.
          </dd>

          <dt>The assistant refuses a question</dt>
          <dd>
            If it is too large, untick records or earlier messages, or use a shorter passage; the message lists each
            item&apos;s size. If the hourly limit or the monthly cap is reached, wait, or raise the limit in{" "}
            <code>.env</code> and restart. See <See anchor="assistant-privacy" />.
          </dd>

          <dt>The proofreading buttons are unavailable</dt>
          <dd>
            If the box says the assistant is not set up, see <See anchor="assistant-setup" />. If you have unsaved
            changes, save first. <L>{PROOFREAD.proofreadSelection}</L> needs text selected in the text box. If the text is
            over the request limit, select a shorter part; nothing is cut automatically.
          </dd>

          <dt>A proofreading suggestion cannot be accepted</dt>
          <dd>
            If it is marked <em>{PROOFREAD.stale}</em>, the text there changed after proofreading: save and proofread
            again. On a protected record, tick <L>{RECORD.unlockProtected}</L> first. If proofreading was refused because
            the record was saved elsewhere, reload the page. See <See anchor="proofreading" />.
          </dd>
        </dl>
      </Section>

      <Section id="limitations">
        <ul>
          <li>
            ChatGPT cannot reach this app (see <See anchor="chatgpt-direct" />). The local read-only adapter does not
            save changes and is not a ChatGPT connection. There is no cloud sync and no accounts. The app runs on this
            computer only. The optional assistant sends what you select to OpenAI, and nothing else.
          </li>
          <li>
            The assistant changes records only through a change proposal you apply, and only reference records it was
            given. Assistant conversations and proposals are not included in workspace backups; applied changes are.
          </li>
          <li>
            Field and text disagreements are found only for simple values (numbers and short text) in records a
            proposal changes.
          </li>
          <li>
            Change packages and the assistant cannot rename a workspace or manuscript, and they cannot move anything
            to the Trash or delete it; only you can, in the app.
          </li>
          <li>
            Deleting permanently removes the item&apos;s whole history from the database, including its entries in{" "}
            <L>{NAV.history}</L> when a whole project or workspace goes. Only the backup made just before keeps it.
          </li>
          <li>
            Saving still happens only when you choose Save. While you type, this browser keeps a local copy of unsaved
            title, text, and structured fields for the open record. That copy is not a revision and is not in a backup.
            After a reload, Restore local draft or Discard offers that copy when it differs from the saved record.
            Restoring an earlier saved version only helps when its title or text (or structured fields, if you tick that
            box) differs from the current saved version.
          </li>
          <li>
            Chapter files can be imported as chapters (see <See anchor="import-chapters" />), but scenes cannot, and
            chapters and scenes are exported as PDF, DOCX, or EPUB from <L>{NAV.exportPdf}</L>. Selected references can
            also download as DOCX, EPUB, or a Markdown zip. A chapter imported later goes after the existing ones until
            you move it.
          </li>
          <li>
            A chapter that still has scenes cannot
            become a scene, and only two scenes in the same chapter and draft can be merged. Split, merge, and convert
            need the protection tick. Split also needs saved text with words on both sides of the cursor.
          </li>
          <li>
            Chapters and scenes cannot have images. Images cannot be cropped, resized or renamed in the app. PDFs include
            PNG and JPEG images only. Manuscript PDF trim, margins, headers, contents, and which chapters to include are
            set on the compile profile.
          </li>
          <li>
            Formatting buttons exist only for chapters and scenes, and there is no underline. Reference pages show common
            Markdown only: headings written with <code>#</code>, lists, tables, block quotes, links, emphasis and code.
            Headings underlined with <code>===</code> or <code>---</code>, and code marked only by indenting, are not
            recognised as headings or code.
          </li>
          <li>
            A series reference can be read in a sibling book and edited only in the book that owns it.{" "}
            <L>{SHELL.world}</L> categories are the document types. There are no separate categories for places, magic
            or other subjects. Optional outlines add headings inside the document you already have; they do not change
            its type. The reference inspector has Overview, Sections, Images, Relationships, and Established in when
            the record supports it. <L>{INFOBOX.heading}</L> at the top of a reference page summarizes kind fields,
            aliases, accepted established facts, relationships, map presence, and the first manuscript appearance from
            name matches; pending or dismissed facts are omitted. Open questions still come from an{" "}
            <L>{INFOBOX.openQuestions}</L> heading in the text, not a separate tab. Maps can be browsed, zoomed, and marked with points, routes, areas, and labels. Freehand drawing
            is not available. Marker positions are not travel times. <L>{WORLD.mapMeasure}</L> and{" "}
            <L>{WORLD.mapRouteLength}</L> estimate distance from the scale bar you set and label that estimate. Maps use author-defined{" "}
            <L>{WORLD.mapLayers}</L>, an optional labelled <L>{WORLD.mapScale}</L> bar, and a{" "}
            <L>{WORLD.mapGeography}</L> list from <em>part_of</em> links. A marker can list chapters and scenes assigned
            to its place. That list is not mentions, linked references, or planned events, and it does not invent a
            story date. The story timeline can leave an event&apos;s time unknown, can use structured in-world dates from{" "}
            <See anchor="world-calendar" />, and can order events without following the manuscript. A planned event stays
            marked. <L>{WORLD.showOnMap}</L> is offered only when a linked place has a marker. A separate{" "}
            <See anchor="relationship-views" /> page graphs place and record relationships only (not mentions).{" "}
            <See anchor="world-names" /> suggests names but never saves them until you add a dictionary entry or create a
            dossier.
          </li>
          <li>
            Closing the tab warns when the editor has unsaved changes. The browser&apos;s Back button does not. A local
            copy may still be offered the next time you open that record in this browser.
          </li>
          <li>
            In one chapter or scene, find and replace works on that record&apos;s text only. Across the manuscript, use{" "}
            <L>{MANUSCRIPT_REPLACE.heading}</L> (saved versions only; a regular expression is optional and refused when it is unsafe).
          </li>
          <li>
            <L>{PROOFREAD.heading}</L> checks spelling, grammar and punctuation only, in one record&apos;s saved text at a
            time. <L>{STYLE_CHECK.heading}</L> and <L>{CONTINUITY.nav}</L> are separate and do not change the manuscript.
            Suggestions are not kept after you leave the page.
          </li>
          <li>
            Spelling is checked in US or UK English only. The Story Loom checker and your dictionary apply to a record&apos;s
            text box; titles and <L>{RECORD.newRecordHeading}</L> use the browser&apos;s checker. There is no grammar
            checking while you type.
          </li>
          <li>
            Dictionary entries are single words or exact multi-word phrases. &ldquo;{SPELLING.ignoreOnce}&rdquo; lasts until
            the page is reloaded.
          </li>
          <li>
            <L>{WORLD.searchReferences}</L> on World filters titles in the column; press <kbd>Enter</kbd> to search saved
            text in World documents only. <L>{PROJECT_SEARCH.heading}</L> (<See anchor="project-search" />) searches a wider
            set across the project. The manuscript column filters chapters and scenes by title, and the{" "}
            <L>{WRITE.references}</L> tab filters reference records by title or type. The local read-only adapter can
            search reference records its grant allows.
          </li>
          <li>Canon status applies to a whole record, not to parts of it.</li>
          <li>Related records are found only by exact names, and only when a change package is applied.</li>
          <li>Resolved review items are not shown in the list.</li>
          <li>Removing protection has no confirmation step.</li>
          <li>In the app, each backup covers one workspace.</li>
        </ul>
      </Section>
    </div>
  );
}
