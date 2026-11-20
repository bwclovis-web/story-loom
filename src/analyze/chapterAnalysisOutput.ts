import { z } from "zod";

export const ANALYSIS_KINDS = [
  "character_presence",
  "location",
  "event",
  "reader_revelation",
  "character_learning",
  "plot_beat",
  "reference_evidence",
  "chronology",
] as const;

export type AnalysisKind = (typeof ANALYSIS_KINDS)[number];

export const CHAPTER_ANALYSIS_SCHEMA_NAME = "wordly_chapter_analysis";

export const CHAPTER_ANALYSIS_OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["suggestions"],
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "kind",
          "excerpt",
          "title",
          "note",
          "uncertain",
          "uncertainty",
          "explicitOrder",
          "earlierTitle",
          "laterTitle",
          "occurrence",
        ],
        properties: {
          kind: { type: "string", enum: [...ANALYSIS_KINDS] },
          excerpt: { type: "string" },
          title: { type: "string" },
          note: { type: "string" },
          uncertain: { type: "boolean" },
          uncertainty: { type: "string" },
          explicitOrder: { type: "boolean" },
          earlierTitle: { type: "string" },
          laterTitle: { type: "string" },
          occurrence: { type: "integer", minimum: 1 },
        },
      },
    },
  },
} as const;

const draftSuggestion = z
  .object({
    kind: z.enum(ANALYSIS_KINDS),
    excerpt: z.string(),
    title: z.string(),
    note: z.string(),
    uncertain: z.boolean(),
    uncertainty: z.string(),
    explicitOrder: z.boolean(),
    earlierTitle: z.string(),
    laterTitle: z.string(),
    occurrence: z.number().int().min(1),
  })
  .strict();

const draftSchema = z.object({ suggestions: z.array(draftSuggestion) }).strict();

export type AnalysisDraftSuggestion = z.infer<typeof draftSuggestion>;

export interface AnalysisPassage {
  start: number;
  end: number;
  excerpt: string;
}

export interface AnalysisCandidate {
  id: string;
  title: string;
  kind: "record" | "fact" | "event" | "beat";
  evidenceCount: number;
  /** Record currentRevision, event revision, or updated-at milliseconds. Absent on older proposals. */
  revision?: number;
}

export interface AnalysisSuggestion {
  key: string;
  kind: AnalysisKind;
  title: string;
  note: string;
  uncertain: boolean;
  uncertainty: string;
  passage: AnalysisPassage | null;
  /** The quotation was found at these offsets. This is not a judgment that the interpretation is right. Older proposals may omit it. */
  passageVerified?: boolean;
  /** False when the suggestion must not be applied. Older proposals may omit passageVerified and use this alone. */
  quoteValid: boolean;
  blockedReason?: string;
  /** Server-written limit on what this category means. Not a model confidence score. Older proposals may omit it. */
  boundary?: string;
  explicitOrder: boolean;
  earlierTitle: string;
  laterTitle: string;
  dependsOnKeys: string[];
  match: {
    status: "unique" | "ambiguous" | "none" | "invalid_quote";
    candidates: AnalysisCandidate[];
  };
}

export interface AnalysisProposal {
  chapterRecordId: string;
  chapterTitle: string;
  pinnedRevision: number;
  suggestions: AnalysisSuggestion[];
}

export type AnalysisAction = "pending" | "reuse" | "edit" | "create" | "skip";

export interface AnalysisDecision {
  action: AnalysisAction;
  targetId?: string;
  title?: string;
  note?: string;
}

export type AnalysisDecisions = Record<string, AnalysisDecision>;

export const ANALYSIS_ASSESSMENTS = ["correct", "needs_editing", "unsupported", "duplicate"] as const;
export type AnalysisAssessment = (typeof ANALYSIS_ASSESSMENTS)[number];
export type AnalysisAssessments = Record<string, AnalysisAssessment>;

export function parseChapterAnalysisOutput(
  text: string,
): { ok: true; suggestions: AnalysisDraftSuggestion[] } | { ok: false; problems: string[] } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, problems: ["Response was not JSON."] };
  }
  const parsed = draftSchema.safeParse(value);
  if (!parsed.success) return { ok: false, problems: parsed.error.issues.map((issue) => issue.message) };
  return { ok: true, suggestions: parsed.data.suggestions };
}
