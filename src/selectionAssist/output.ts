import { z } from "zod";

export const SELECTION_ASSIST_SCHEMA_NAME = "wordly_selection_assist";

export const SELECTION_ASSIST_ACTIONS = ["rewrite", "expand", "describe"] as const;
export type SelectionAssistAction = (typeof SELECTION_ASSIST_ACTIONS)[number];

export const SELECTION_ASSIST_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["replacement", "note"],
  properties: {
    replacement: {
      type: "string",
      description: "The full replacement for the selected passage only, with Markdown preserved.",
    },
    note: {
      type: "string",
      description: "One short sentence explaining what you did.",
    },
  },
};

const parsed = z.object({
  replacement: z.string(),
  note: z.string().max(2_000),
});

export function parseSelectionAssistOutput(text: string): { ok: true; replacement: string; note: string } | { ok: false; problems: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, problems: ["The response was not valid JSON."] };
  }
  const result = parsed.safeParse(raw);
  if (!result.success) {
    return { ok: false, problems: result.error.issues.map((i) => i.message) };
  }
  if (!result.data.replacement.trim() && !result.data.note.trim()) {
    return { ok: false, problems: ["The response was empty."] };
  }
  return { ok: true, replacement: result.data.replacement, note: result.data.note };
}

export const SELECTION_ASSIST_SCHEMA_CHARS = JSON.stringify(SELECTION_ASSIST_OUTPUT_JSON_SCHEMA).length;