import { z } from "zod";

/*
 * Structured output for Weave "Build grid from draft".
 * The model proposes threads, chapter/scene summaries, optional scene-purpose
 * fields, optional scene-boundary suggestions (review only — never splits
 * manuscript), and beats with exact source passages. Trusted server code
 * assigns Weave IDs and never writes Record.body from this draft.
 */

export const WEAVE_BUILD_SCHEMA_NAME = "wordly_weave_build_from_draft";

export const MAX_WEAVE_BUILD_THREADS = 24;
export const MAX_WEAVE_BUILD_ROWS = 80;
export const MAX_WEAVE_BUILD_BEATS = 200;
export const MAX_WEAVE_BUILD_BOUNDARIES = 40;

const nullableString = (description: string) => ({ type: ["string", "null"], description });

export const WEAVE_BUILD_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "threads", "rows", "beats"],
  properties: {
    summary: {
      type: "string",
      description: "One or two sentences describing the proposed plot-grid plan. No manuscript prose.",
    },
    threads: {
      type: "array",
      description: "Story-thread columns. Prefer few durable threads.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "title"],
        properties: {
          key: { type: "string", description: "Stable suggestion key, e.g. thread-main-mystery." },
          title: { type: "string", description: "Short thread title." },
        },
      },
    },
    rows: {
      type: "array",
      description: "One entry per existing chapter or scene in the source list. Use chapter rows when there are no scenes.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "manuscriptRecordId", "summary", "purposeGoal", "purposeChange", "purposeForward", "proposedBoundaries"],
        properties: {
          key: { type: "string", description: "Stable suggestion key, e.g. row-ch01." },
          manuscriptRecordId: {
            type: "string",
            description: "Exact id of a chapter or scene from the source material list.",
          },
          summary: { type: "string", description: "Concise planning summary. Not manuscript prose." },
          purposeGoal: nullableString("What the POV character wants in this beat of the chapter/scene, or null."),
          purposeChange: nullableString("What changes by the end of this chapter/scene, or null."),
          purposeForward: nullableString("What this chapter/scene forces next, or null."),
          proposedBoundaries: {
            type: "array",
            description:
              "Optional suggested scene splits for review only. Never rewrite or split the manuscript. Empty when not needed.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["key", "title", "excerpt"],
              properties: {
                key: { type: "string" },
                title: { type: "string", description: "Suggested scene title for review." },
                excerpt: {
                  type: "string",
                  description: "Exact short passage copied from the source that marks the suggested boundary.",
                },
              },
            },
          },
        },
      },
    },
    beats: {
      type: "array",
      description: "Plot beats linked to existing manuscript rows and threads.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "title", "body", "threadKey", "manuscriptRecordId", "decision", "sourceExcerpt"],
        properties: {
          key: { type: "string", description: "Stable suggestion key, e.g. beat-clue-changes-hands." },
          title: { type: "string" },
          body: { type: "string", description: "Short planning note. Not manuscript prose." },
          threadKey: { type: "string", description: "Must match a threads[].key." },
          manuscriptRecordId: {
            type: "string",
            description: "Exact id of a chapter or scene from the source material list.",
          },
          decision: {
            type: "string",
            enum: ["", "keep", "cut", "move", "combine", "rebuild"],
            description: "Optional Weave decision, or empty string.",
          },
          sourceExcerpt: {
            type: "string",
            description: "Exact short passage copied from that manuscript record supporting this beat.",
          },
        },
      },
    },
  },
};

const boundarySchema = z
  .object({
    key: z.string().min(1).max(80),
    title: z.string().max(200),
    excerpt: z.string().max(2000),
  })
  .strict();

const threadSchema = z
  .object({
    key: z.string().min(1).max(80),
    title: z.string().min(1).max(120),
  })
  .strict();

const rowSchema = z
  .object({
    key: z.string().min(1).max(80),
    manuscriptRecordId: z.string().min(1).max(100),
    summary: z.string().max(2000),
    purposeGoal: z.string().max(500).nullable(),
    purposeChange: z.string().max(500).nullable(),
    purposeForward: z.string().max(500).nullable(),
    proposedBoundaries: z.array(boundarySchema).max(MAX_WEAVE_BUILD_BOUNDARIES),
  })
  .strict();

const beatSchema = z
  .object({
    key: z.string().min(1).max(80),
    title: z.string().min(1).max(200),
    body: z.string().max(4000),
    threadKey: z.string().min(1).max(80),
    manuscriptRecordId: z.string().min(1).max(100),
    decision: z.enum(["", "keep", "cut", "move", "combine", "rebuild"]),
    sourceExcerpt: z.string().min(1).max(2000),
  })
  .strict();

export const weaveBuildDraftSchema = z
  .object({
    summary: z.string().max(2000),
    threads: z.array(threadSchema).max(MAX_WEAVE_BUILD_THREADS),
    rows: z.array(rowSchema).max(MAX_WEAVE_BUILD_ROWS),
    beats: z.array(beatSchema).max(MAX_WEAVE_BUILD_BEATS),
  })
  .strict();

export type WeaveBuildDraft = z.infer<typeof weaveBuildDraftSchema>;

export type WeaveBuildParseResult =
  | { ok: true; draft: WeaveBuildDraft }
  | { ok: false; problems: string[] };

export function parseWeaveBuildOutput(text: string): WeaveBuildParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, problems: ["The response was not valid JSON."] };
  }
  const parsed = weaveBuildDraftSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.slice(0, 12).map((i) => `${i.path.length ? i.path.join(".") : "response"}: ${i.message}`),
    };
  }
  return { ok: true, draft: parsed.data };
}

type DraftBeat = WeaveBuildDraft["beats"][number];
type DraftRow = WeaveBuildDraft["rows"][number];
type DraftBoundary = DraftRow["proposedBoundaries"][number];

/** Attach verified source passage offsets after locating excerpts in sent text. */
export interface WeaveBuildProposalBeat extends DraftBeat {
  sourcePassage: {
    recordId: string;
    revisionNumber: number;
    start: number;
    end: number;
    excerpt: string;
  } | null;
}

export interface WeaveBuildProposalRow extends DraftRow {
  proposedBoundaries: Array<
    DraftBoundary & {
      start: number | null;
      end: number | null;
    }
  >;
}

export interface WeaveBuildProposal {
  summary: string;
  threads: WeaveBuildDraft["threads"];
  rows: WeaveBuildProposalRow[];
  beats: WeaveBuildProposalBeat[];
}
