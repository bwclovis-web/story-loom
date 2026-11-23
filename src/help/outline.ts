import type { AuthorityStatus } from "@/domain/statuses";

/*
 * Structure of the "How to use" page. Section text lives in HelpContent.tsx;
 * contextual hints elsewhere in the app link to these anchors.
 */

export interface HelpSection {
  id: string;
  title: string;
  children?: ReadonlyArray<{ id: string; title: string }>;
}

export const HELP_SECTIONS = [
  {
    id: "quick-start",
    title: "Quick start",
    children: [{ id: "whats-new", title: "What's new" }],
  },
  {
    id: "getting-started",
    title: "Getting started",
    children: [
      { id: "project-templates", title: "Project templates" },
      { id: "guided-tasks", title: "Guided tasks" },
      { id: "sample-manuscript", title: "Example manuscript" },
    ],
  },
  {
    id: "optional-features",
    title: "Optional features (skippable)",
    children: [
      { id: "optional-upgrade", title: "Project upgrades" },
      { id: "optional-pins", title: "Reference pins" },
      { id: "optional-boards", title: "World Boards" },
      { id: "optional-maps", title: "World maps" },
      { id: "optional-calendar", title: "In-world calendar" },
      { id: "optional-relationships", title: "Relationships and graph" },
      { id: "optional-names", title: "Name generator" },
      { id: "optional-rewrites", title: "Author rewrites" },
    ],
  },
  { id: "navigation", title: "Finding your way around" },
  {
    id: "settings",
    title: "Settings",
    children: [
      { id: "settings-ai", title: "Your AI key and endpoint" },
      { id: "settings-library", title: "Library and backup folders" },
    ],
  },
  {
    id: "workspaces",
    title: "Workspaces and projects",
    children: [{ id: "upgrade-project", title: "Upgrade this project" }],
  },
  {
    id: "importing",
    title: "Importing reference files",
    children: [
      { id: "canon-status", title: "Canon status" },
      { id: "duplicates", title: "Possible duplicates" },
    ],
  },
  {
    id: "editing",
    title: "Reading and editing",
    children: [
      { id: "saved-versions", title: "Earlier saved versions" },
      { id: "protection", title: "Protection" },
    ],
  },
  {
    id: "write",
    title: "Writing chapters and scenes",
    children: [
      { id: "manuscript-panel", title: "Chapters and scenes" },
      { id: "author-rewrite", title: "Author rewrite" },
      { id: "book-order", title: "Changing the book order" },
      { id: "manuscript-search", title: "Searching the manuscript" },
      { id: "manuscript-replace", title: "Replace across the manuscript" },
      { id: "manuscript-style-check", title: "Local style check and insights" },
      { id: "writing-goals", title: "Writing goals and progress" },
      { id: "manuscript-annotations", title: "Synopsis and margin comments" },
      { id: "manuscript-outliner", title: "Outliner" },
      { id: "smart-collections", title: "Smart collections (manuscript)" },
      { id: "project-search", title: "Search the whole project" },
      { id: "import-chapters", title: "Importing chapters from files" },
      { id: "import-scrivener", title: "Importing a Scrivener project" },
      { id: "import-docx-review", title: "Reviewing an editor Word file" },
      { id: "read-book", title: "Reading the whole book" },
      { id: "tidy-text", title: "Tidying a chapter" },
      { id: "text-appearance", title: "Fonts and text size" },
      { id: "write-page", title: "The writing page" },
      { id: "live-markdown", title: "Live Markdown and Scrivenings" },
      { id: "scene-context", title: "References, notes, source and proofreading" },
      { id: "panels-focus", title: "Desk, focus, and companion" },
      { id: "draft-comparison", title: "Side-by-side drafts" },
      { id: "local-recovery", title: "Unsaved local copy" },
      { id: "named-snapshots", title: "Named snapshots and read aloud" },
    ],
  },
  {
    id: "plan",
    title: "Plan and Weave",
    children: [
      { id: "plan-weave", title: "Weave" },
      { id: "weave-build-from-draft", title: "Build grid from draft" },
      { id: "analyze-chapter", title: "Analyze chapter" },
      { id: "weave-setup-payoff", title: "Setup and payoff" },
      { id: "weave-templates", title: "Beat templates" },
    ],
  },
  {
    id: "world",
    title: "World references",
    children: [
      { id: "world-boards", title: "Boards" },
      { id: "established-in", title: "Established in" },
      { id: "world-maps", title: "Maps" },
      { id: "scene-locations", title: "Scene locations" },
      { id: "world-calendar", title: "In-world calendar" },
      { id: "story-events", title: "Story timeline" },
      { id: "place-relations", title: "Place relationships" },
      { id: "record-relations", title: "Record relationships" },
      { id: "character-development", title: "Character profile" },
      { id: "character-dossier-upgrade", title: "Upgrade dossier to Living Profile" },
      { id: "world-profile", title: "Living World Profile" },
      { id: "world-profile-upgrade", title: "Upgrade World Markdown to Living Profile" },
      { id: "relationship-views", title: "Relationship graph and trees" },
      { id: "world-nav", title: "Finding references" },
      { id: "world-taxonomy", title: "World Hub categories" },
      { id: "world-collections", title: "Saved World collections" },
      { id: "world-organize", title: "Organize references" },
      { id: "world-kinds", title: "Worldbuilding kinds" },
      { id: "world-series", title: "Series references" },
      { id: "world-continuity", title: "Story Health" },
      { id: "world-names", title: "Name generator" },
      { id: "reference-page", title: "Reading a reference (incl. At a glance)" },
      { id: "reference-context", title: "Context beside a reference" },
      { id: "mentioned-by", title: "Mentioned by" },
      { id: "reference-outlines", title: "Original outlines" },
      { id: "images", title: "Images in references" },
    ],
  },
  {
    id: "series-documents",
    title: "Series bibles and linked documents",
    children: [
      { id: "section-status", title: "Status tags in headings" },
      { id: "cross-references", title: "Cross-references and IDs" },
      { id: "names-in-manuscript", title: "Characters and places in chapters" },
      { id: "record-rename", title: "Rename everywhere" },
      { id: "cross-reference-check", title: "Checking every cross-reference" },
      { id: "new-versions", title: "Importing a new version of a file" },
      { id: "long-documents", title: "Long documents, one section at a time" },
      { id: "load-from-file", title: "Loading a chapter from a file" },
    ],
  },
  { id: "pdf-export", title: "Exporting PDFs, DOCX, and EPUB" },
  {
    id: "writing-tools",
    title: "Writing tools",
    children: [
      { id: "spelling", title: "Spelling" },
      { id: "dictionary", title: "Project dictionary" },
      { id: "word-counts", title: "Word counts" },
      { id: "find-replace", title: "Find and replace" },
      { id: "proofreading", title: "AI proofreading (optional)" },
      { id: "selection-assist", title: "AI writing assist on a selection (optional)" },
      { id: "formatting", title: "Formatting, undo and redo" },
    ],
  },
  {
    id: "assistant",
    title: "Assistant (optional)",
    children: [
      { id: "assistant-setup", title: "Assistant setup" },
      { id: "assistant-context", title: "Choosing what to send" },
      { id: "assistant-payload", title: "Exact payload inspector" },
      { id: "assistant-answers", title: "Reading answers" },
      { id: "assistant-proposals", title: "Change proposals" },
      { id: "assistant-privacy", title: "Privacy, usage and limits" },
      { id: "assistant-prompt-presets", title: "Instruction presets" },
    ],
  },
  {
    id: "chatgpt",
    title: "Working with ChatGPT",
    children: [
      { id: "context-export", title: "Context export" },
      { id: "chatgpt-direct", title: "Direct connection" },
    ],
  },
  {
    id: "reviewing",
    title: "Reviewing and applying updates",
    children: [
      { id: "change-package-import", title: "Importing a change package" },
      { id: "change-review", title: "The review screen" },
      { id: "review-items", title: "Open review items" },
    ],
  },
  {
    id: "trash",
    title: "Deleting and the Trash",
    children: [
      { id: "move-to-trash", title: "Moving to the Trash" },
      { id: "trash-page", title: "Restoring and deleting permanently" },
    ],
  },
  {
    id: "backup",
    title: "Backup and restore",
    children: [
      { id: "full-backup", title: "Full backup" },
      { id: "backup-mirror", title: "Backup mirror folder" },
      { id: "rolling-backup", title: "Rolling mirror backups" },
      { id: "sync-bundle", title: "Sync bundles" },
      { id: "restore", title: "Restore" },
    ],
  },
  { id: "troubleshooting", title: "Troubleshooting" },
  { id: "limitations", title: "Current limitations" },
] as const satisfies readonly HelpSection[];

type SectionEntry = (typeof HELP_SECTIONS)[number];
type ChildEntry = SectionEntry extends infer S ? (S extends { children: readonly (infer C)[] } ? C : never) : never;
export type HelpAnchor = SectionEntry["id"] | (ChildEntry extends { id: infer I } ? I : never);

export const HELP_PATH = "/help";

export function helpHref(anchor: HelpAnchor): string {
  return `${HELP_PATH}#${anchor}`;
}

/** package.json scripts the help tells authors to run. Verified by tests/unit/help.test.ts. */
export const HELP_SCRIPTS = [
  "dev",
  "desktop:dev",
  "db:setup",
  "db:backup",
  "db:info",
  "db:restore",
  "mcp:stdio",
] as const;
export type HelpScript = (typeof HELP_SCRIPTS)[number];

/** App routes the help describes. Verified by tests/unit/help.test.ts. */
export const HELP_ROUTES = [
  "/",
  "/help",
  "/settings",
  "/connections",
  "/trash",
  "/backup",
  "/backup/[workspaceId]",
  "/backup/sync-bundle/[workspaceId]",
  "/projects/[projectId]",
  "/projects/[projectId]/write",
  "/projects/[projectId]/write/scrivenings",
  "/projects/[projectId]/write/goals",
  "/projects/[projectId]/write/collections",
  "/projects/[projectId]/write/replace",
  "/projects/[projectId]/write/style",
  "/projects/[projectId]/read",
  "/projects/[projectId]/import-chapters",
  "/projects/[projectId]/import-scrivener",
  "/projects/[projectId]/import-docx-review",
  "/projects/[projectId]/plan",
  "/projects/[projectId]/plan/weave",
  "/projects/[projectId]/plan/weave/[gridId]",
  "/projects/[projectId]/plan/weave/build",
  "/projects/[projectId]/plan/weave/build/[runId]",
  "/projects/[projectId]/analyze",
  "/projects/[projectId]/analyze/[runId]",
  "/projects/[projectId]/plan/weave/templates",
  "/projects/[projectId]/world",
  "/projects/[projectId]/world/new",
  "/projects/[projectId]/world/organize",
  "/projects/[projectId]/continuity",
  "/projects/[projectId]/world/boards",
  "/projects/[projectId]/world/boards/[boardId]",
  "/projects/[projectId]/world/maps",
  "/projects/[projectId]/world/maps/[mapId]",
  "/projects/[projectId]/world/calendar",
  "/projects/[projectId]/world/events",
  "/projects/[projectId]/world/relationships",
  "/projects/[projectId]/world/development",
  "/projects/[projectId]/world/names",
  "/projects/[projectId]/records/[recordId]",
  "/projects/[projectId]/records/[recordId]/world-upgrade",
  "/projects/[projectId]/import",
  "/projects/[projectId]/import-markdown",
  "/projects/[projectId]/export",
  "/projects/[projectId]/export-pdf",
  "/projects/[projectId]/docx",
  "/projects/[projectId]/epub",
  "/projects/[projectId]/pdf",
  "/projects/[projectId]/markdown",
  "/projects/[projectId]/wiki",
  "/projects/[projectId]/history",
  "/projects/[projectId]/assistant",
  "/projects/[projectId]/dictionary",
  "/projects/[projectId]/dictionary/export",
  "/projects/[projectId]/search",
  "/projects/[projectId]/cross-references",
  "/projects/[projectId]/upgrade",
] as const;

export const APP_URL = "http://127.0.0.1:2112";

export const STATUS_DESCRIPTIONS: Record<AuthorityStatus, string> = {
  draft: "Working material. Not settled.",
  proposed: "An idea under consideration. Not yet canon.",
  approved: "Canon: an established fact about the story.",
  superseded: "Replaced by a newer decision. Kept for the record.",
  unresolved: "An open question that still needs a decision.",
};
