import { z } from "zod";

/*
 * What the model returns for a proofreading request (Structured Outputs,
 * strict mode). The model only quotes text: `original` with a little
 * surrounding context. It never supplies offsets, record IDs or revisions;
 * the server locates each quote in the exact text it sent (see anchors.ts).
 */

export const PROOFREAD_SCHEMA_NAME = "wordly_proofread";

export const PROOFREAD_CATEGORIES = ["spelling", "grammar", "punctuation"] as const;
export type ProofreadCategory = (typeof PROOFREAD_CATEGORIES)[number];

export const MAX_PROOFREAD_SUGGESTIONS = 500;

export const PROOFREAD_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["suggestions"],
  properties: {
    suggestions: {
      type: "array",
      description: "One entry per correction, in the order they appear in the text. Empty if nothing needs correcting.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "before", "original", "after", "replacement", "explanation"],
        properties: {
          category: { type: "string", enum: [...PROOFREAD_CATEGORIES] },
          before: {
            type: "string",
            description: "Up to 40 characters copied exactly from immediately before original. Empty only at the start of the text.",
          },
          original: { type: "string", description: "The exact text to correct, copied character for character. A word or short phrase." },
          after: {
            type: "string",
            description: "Up to 40 characters copied exactly from immediately after original. Empty only at the end of the text.",
          },
          replacement: { type: "string", description: "The corrected text that replaces original." },
          explanation: { type: "string", description: "One short sentence saying what is wrong." },
        },
      },
    },
  },
};

const draftSuggestion = z
  .object({
    category: z.enum(PROOFREAD_CATEGORIES),
    before: z.string(),
    original: z.string(),
    after: z.string(),
    replacement: z.string(),
    explanation: z.string(),
  })
  .strict();

const proofreadDraftSchema = z.object({ suggestions: z.array(draftSuggestion).max(MAX_PROOFREAD_SUGGESTIONS) }).strict();

export type DraftSuggestion = z.infer<typeof draftSuggestion>;

export type ProofreadParseResult = { ok: true; suggestions: DraftSuggestion[] } | { ok: false; problems: string[] };

export function parseProofreadOutput(text: string): ProofreadParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, problems: ["The response was not valid JSON."] };
  }
  const parsed = proofreadDraftSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.slice(0, 10).map((i) => `${i.path.length ? i.path.join(".") : "response"}: ${i.message}`),
    };
  }
  return { ok: true, suggestions: parsed.data.suggestions };
}
