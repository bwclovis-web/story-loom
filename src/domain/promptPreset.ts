export const PROMPT_PRESET_SURFACES = ["selection", "chat", "beat"] as const;
export type PromptPresetSurface = (typeof PROMPT_PRESET_SURFACES)[number];

export const PROMPT_PRESET_TITLE_MAX = 120;
export const PROMPT_PRESET_INSTRUCTION_MAX = 4_000;

export function isPromptPresetSurface(value: string): value is PromptPresetSurface {
  return (PROMPT_PRESET_SURFACES as readonly string[]).includes(value);
}

/** Appended to the model instructions for one assistant request. */
export function formatAuthorInstructionLens(instructionText: string): string {
  const trimmed = instructionText.trim();
  if (!trimmed) return "";
  return `\n\nAuthor instruction (for this request only):\n${trimmed}`;
}