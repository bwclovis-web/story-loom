import type { RecordType } from "@/domain/recordTypes";
import type { ReferenceTemplateKey } from "@/world/referenceTemplates";

/** Record lists reached from the global navigation. Every record type belongs to exactly one. */
export const RECORD_GROUPS = {
  write: ["manuscript_chapter", "manuscript_scene", "scene_note"],
  plan: ["chapter_outline", "story_architecture"],
  world: [
    "character_dossier",
    "worldbuilding",
    "rules_glossary",
    "research_note",
    "canon_decision",
    "continuity_note",
    "reference_note",
  ],
} as const satisfies Record<string, readonly RecordType[]>;

export type RecordGroup = keyof typeof RECORD_GROUPS;
export const RECORD_GROUP_IDS = Object.keys(RECORD_GROUPS) as RecordGroup[];

export function groupOfType(type: RecordType): RecordGroup {
  for (const group of RECORD_GROUP_IDS) {
    if ((RECORD_GROUPS[group] as readonly RecordType[]).includes(type)) return group;
  }
  throw new Error(`Record type ${type} has no navigation group`);
}

export type GlobalNavId = RecordGroup | "assistant" | "backups" | "connections" | "trash" | "help";

/** Shown in the project selector. Counts come from the database; nothing here is estimated. */
export interface ProjectSummary {
  id: string;
  title: string;
  workspaceId: string;
  workspaceName: string;
  recordCount: number;
  chapterCount: number;
  manuscriptWords: number;
}

/** Record ID and type, no text: enough to place a record page under Write, Plan or World. */
export interface RecordNavEntry {
  id: string;
  title: string;
  type: RecordType;
  parentRecordId: string | null;
  /** Book order (see src/domain/bookOrder.ts); null until the author moves something. */
  position: number | null;
  /** ISO time; orders records that have no position. */
  createdAt: string;
  /** Manuscript draft when drafts exist; null for legacy or non-draft records. */
  draftId?: string | null;
  /** Worldbuilding only: `fields.kind` when it matches a built-in kind key. */
  worldKind?: ReferenceTemplateKey | null;
  /** Worldbuilding only: author-defined `fields.kind` when not a built-in key. */
  customKind?: string | null;
}

const PROJECT_PATH = /^\/projects\/([^/]+)(?:\/(.*))?$/;

/** Weave landing: `/plan` and the older `/plan/weave` index. Nested grid, template, and build routes are not the landing. */
export function isWeaveLibraryPath(rest: readonly string[]): boolean {
  if (rest.length === 1 && rest[0] === "plan") return true;
  return rest.length === 2 && rest[0] === "plan" && rest[1] === "weave";
}

/** Write, Weave, World, and Assistant landings. Nested tools and records are not included. */
export function isProjectLandingPath(rest: readonly string[]): boolean {
  if (rest.length === 1 && (rest[0] === "write" || rest[0] === "world" || rest[0] === "assistant")) return true;
  if (rest.length === 2 && rest[0] === "world" && rest[1] === "new") return true;
  return isWeaveLibraryPath(rest);
}

export function parseProjectPath(pathname: string): { projectId: string; rest: string[] } | null {
  const match = PROJECT_PATH.exec(pathname);
  if (!match) return null;
  return {
    projectId: decodeURIComponent(match[1]),
    rest: (match[2] ?? "").split("/").filter(Boolean).map(decodeURIComponent),
  };
}

/** The record group a project page belongs to, or null for project-wide pages such as history. */
export function groupForProjectPath(rest: readonly string[], recordType: (id: string) => RecordType | undefined): RecordGroup | null {
  const [first, second] = rest;
  if (first === "world" || first === "continuity") return "world";
  if (first && (RECORD_GROUP_IDS as string[]).includes(first) && rest.length === 1) return first as RecordGroup;
  if ((first === "read" || first === "import-chapters") && rest.length === 1) return "write";
  if (first === "records" && second) {
    const type = recordType(second);
    return type ? groupOfType(type) : null;
  }
  return null;
}

export function activeGlobalItem(pathname: string, recordType: (id: string) => RecordType | undefined): GlobalNavId | null {
  if (pathname === "/backup" || pathname.startsWith("/backup/")) return "backups";
  if (pathname === "/connections" || pathname.startsWith("/connections/")) return "connections";
  if (pathname === "/trash" || pathname.startsWith("/trash/")) return "trash";
  if (pathname === "/help" || pathname.startsWith("/help/")) return "help";
  if (pathname === "/") return "write";
  const project = parseProjectPath(pathname);
  if (!project) return null;
  if (project.rest[0] === "assistant") return "assistant";
  return groupForProjectPath(project.rest, recordType);
}
