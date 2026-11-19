/*
 * Read-only project search/read tools for discussion turns. The model may call
 * these to gather evidence before answering. They never write records.
 */

import type { ProviderTool } from "./provider";

export const ASSISTANT_TOOL_NAMES = [
  "search_project",
  "read_passage",
  "list_sections",
  "resolve_name",
  "list_accepted_facts",
  "search_planning",
  "list_earlier_scenes",
  "events_at_place",
  "event_reveals",
  "events_before_scene",
  "chapter_event_sequence",
] as const;

export type AssistantToolName = (typeof ASSISTANT_TOOL_NAMES)[number];

export type RetrievalScope = "chapter" | "book" | "series";

const scopeEnum = { type: "string", enum: ["chapter", "book", "series"] } as const;

/** OpenAI function-tool definitions (strict JSON Schema). */
export const ASSISTANT_TOOLS: ProviderTool[] = [
  {
    name: "search_project",
    description:
      "Search manuscript prose, reference records (title, aliases, sections, body), accepted facts, and planning notes within the chosen scope. Returns short excerpts and IDs only. Call read_passage or list_sections for full text. For story events, scene locations, and map markers, use events_at_place, event_reveals, events_before_scene, or chapter_event_sequence.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query", "scope", "includeManuscript", "includeReferences", "includeFacts", "includePlanning"],
      properties: {
        query: { type: "string", description: "Words to find." },
        scope: { ...scopeEnum, description: "chapter = open chapter tree; book = this project; series = sibling books when assigned." },
        includeManuscript: { type: "boolean" },
        includeReferences: { type: "boolean" },
        includeFacts: { type: "boolean" },
        includePlanning: { type: "boolean" },
      },
    },
  },
  {
    name: "read_passage",
    description:
      "Read a record or a bounded passage/section at a known revision. Use after search_project or resolve_name. Refuses excluded records. Nothing is shortened when returned; oversized reads are refused with sizes.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["recordId", "revision", "sectionId", "start", "end"],
      properties: {
        recordId: { type: "string" },
        revision: { type: "integer", description: "Expected current revision; refuse if stale." },
        sectionId: { type: ["string", "null"], description: "Heading id from list_sections, or null." },
        start: { type: ["integer", "null"], description: "Passage start offset, or null for whole/section." },
        end: { type: ["integer", "null"], description: "Passage end offset, or null." },
      },
    },
  },
  {
    name: "list_sections",
    description: "List headings of a long reference (or manuscript) with sizes and status tags. Use before reading one section.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["recordId"],
      properties: { recordId: { type: "string" } },
    },
  },
  {
    name: "resolve_name",
    description:
      "Resolve a character or place name/alias to reference records. When several records match, returns ambiguous: true and asks the author to clarify — do not guess.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["name", "scope"],
      properties: {
        name: { type: "string" },
        scope: scopeEnum,
      },
    },
  },
  {
    name: "list_accepted_facts",
    description: "List accepted established facts for a subject reference record, with evidence kinds (planned / zero_draft / author_rewrite) clearly labeled.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["subjectRecordId"],
      properties: { subjectRecordId: { type: "string" } },
    },
  },
  {
    name: "search_planning",
    description:
      "Search Weave planning material (grid titles, threads, beat titles/notes). Results are future plans unless labeled otherwise — never treat as settled manuscript canon.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query", "scope"],
      properties: {
        query: { type: "string" },
        scope: scopeEnum,
      },
    },
  },
  {
    name: "list_earlier_scenes",
    description:
      "List scenes that appear before the open scene in manuscript book order. Book order is not story chronology. For what is established earlier in story time, call events_before_scene. Optional draftId limits to one manuscript draft.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["beforeRecordId", "draftId"],
      properties: {
        beforeRecordId: { type: "string", description: "Current chapter or scene id." },
        draftId: { type: ["string", "null"] },
      },
    },
  },
  {
    name: "events_at_place",
    description:
      "List story events linked to a place, in explicit chronology, plus scene locations and map markers for that place. Scene locations are settings, not events. Unknown time and unresolved pairs are labeled. A revealing scene is not character knowledge.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["locationRecordId"],
      properties: { locationRecordId: { type: "string" } },
    },
  },
  {
    name: "event_reveals",
    description:
      "List the chapters and scenes that reveal one story event, with its places, map markers, pinned passages, and constraint neighbors. Revelation is when the reader learns the event. It does not mean every character knows it.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["eventId"],
      properties: { eventId: { type: "string" } },
    },
  },
  {
    name: "events_before_scene",
    description:
      "List events constrained to occur before the events this scene (or chapter) reveals. Uses earlier/later constraints only, never manuscript order. Reports unknown time and events with no constraint. Does not infer character knowledge.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["manuscriptRecordId"],
      properties: { manuscriptRecordId: { type: "string", description: "Chapter or scene id." } },
    },
  },
  {
    name: "chapter_event_sequence",
    description:
      "Compare events revealed in a chapter with the recorded earlier/later constraints. conflictsWithRecordedSequence is true only for a cycle. readerOrderDifferences are flashbacks, not contradictions by themselves. Reports unresolved pairs and unknown time.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["manuscriptRecordId"],
      properties: { manuscriptRecordId: { type: "string", description: "Chapter or scene id. A scene uses its chapter." } },
    },
  },
];

export function isAssistantToolName(name: string): name is AssistantToolName {
  return (ASSISTANT_TOOL_NAMES as readonly string[]).includes(name);
}
