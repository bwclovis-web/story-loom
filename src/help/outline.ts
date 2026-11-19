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
  { id: "quick-start", title: "Quick start" },
  { id: "getting-started", title: "Getting started" },
  {
    id: "optional-features",
    title: "Optional features (skippable)",
    children: [
      { id: "optional-upgrade", title: "Project upgrades" },
      { id: "optional-pins", title: "Reference pins" },
      { id: "optional-boards", title: "World Boards" },
      { id: "optional-maps", title: "World maps" },
      { id: "optional-rewrites", title: "Author rewrites" },
    ],
  },
  { id: "navigation", title: "Finding your way around" },
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
      { id: "import-chapters", title: "Importing chapters from files" },
      { id: "read-book", title: "Reading the whole book" },
      { id: "tidy-text", title: "Tidying a chapter" },
      { id: "text-appearance", title: "Fonts and text size" },
      { id: "write-page", title: "The writing page" },
      { id: "scene-context", title: "References, notes, source and proofreading" },
      { id: "panels-focus", title: "Panels and focus mode" },
    ],
  },
  {
    id: "plan",
    title: "Plan and Weave",
    children: [
      { id: "plan-weave", title: "Weave" },
      { id: "weave-build-from-draft", title: "Build grid from draft" },
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
      { id: "place-relations", title: "Place relationships" },
      { id: "world-nav", title: "Finding references" },
      { id: "reference-page", title: "Reading a reference" },
      { id: "reference-context", title: "Context beside a reference" },
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
      { id: "cross-reference-check", title: "Checking every cross-reference" },
      { id: "new-versions", title: "Importing a new version of a file" },
      { id: "long-documents", title: "Long documents, one section at a time" },
      { id: "load-from-file", title: "Loading a chapter from a file" },
    ],
  },
  { id: "pdf-export", title: "Exporting PDFs" },
  {
    id: "writing-tools",
    title: "Writing tools",
    children: [
      { id: "spelling", title: "Spelling" },
      { id: "dictionary", title: "Project dictionary" },
      { id: "word-counts", title: "Word counts" },
      { id: "find-replace", title: "Find and replace" },
      { id: "proofreading", title: "AI proofreading (optional)" },
      { id: "formatting", title: "Formatting, undo and redo" },
    ],
  },
  {
    id: "assistant",
    title: "Assistant (optional)",
    children: [
      { id: "assistant-setup", title: "Assistant setup" },
      { id: "assistant-context", title: "Choosing what to send" },
      { id: "assistant-answers", title: "Reading answers" },
      { id: "assistant-proposals", title: "Change proposals" },
      { id: "assistant-privacy", title: "Privacy, usage and limits" },
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
export const HELP_SCRIPTS = ["dev", "db:setup", "db:backup", "db:info", "db:restore", "mcp:stdio"] as const;
export type HelpScript = (typeof HELP_SCRIPTS)[number];

/** App routes the help describes. Verified by tests/unit/help.test.ts. */
export const HELP_ROUTES = [
  "/",
  "/help",
  "/connections",
  "/trash",
  "/backup",
  "/backup/[workspaceId]",
  "/projects/[projectId]",
  "/projects/[projectId]/write",
  "/projects/[projectId]/plan",
  "/projects/[projectId]/plan/weave",
  "/projects/[projectId]/plan/weave/[gridId]",
  "/projects/[projectId]/plan/weave/build",
  "/projects/[projectId]/plan/weave/build/[runId]",
  "/projects/[projectId]/plan/weave/templates",
  "/projects/[projectId]/world",
  "/projects/[projectId]/world/boards",
  "/projects/[projectId]/world/boards/[boardId]",
  "/projects/[projectId]/world/maps",
  "/projects/[projectId]/world/maps/[mapId]",
  "/projects/[projectId]/records/[recordId]",
  "/projects/[projectId]/import",
  "/projects/[projectId]/import-markdown",
  "/projects/[projectId]/export",
  "/projects/[projectId]/export-pdf",
  "/projects/[projectId]/pdf",
  "/projects/[projectId]/history",
  "/projects/[projectId]/assistant",
  "/projects/[projectId]/dictionary",
  "/projects/[projectId]/dictionary/export",
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
