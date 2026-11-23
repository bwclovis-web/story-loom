/**
 * Opt-in project scaffolds chosen at manuscript create time.
 * Keys are request-time only (not a schema column). Invented copy only.
 */

export const PROJECT_TEMPLATE_IDS = [
  "novel",
  "series",
  "fantasy",
  "science_fiction",
  "mystery",
  "romance",
  "screenplay",
] as const;

export type ProjectTemplateId = (typeof PROJECT_TEMPLATE_IDS)[number];

export function isProjectTemplateId(value: string): value is ProjectTemplateId {
  return (PROJECT_TEMPLATE_IDS as readonly string[]).includes(value);
}

/** Default when the form omits a template. */
export const DEFAULT_PROJECT_TEMPLATE: ProjectTemplateId = "novel";

/** Weave starter used by genre templates that open a plot grid. */
export function weavePresetForTemplate(id: ProjectTemplateId): string | null {
  if (id === "mystery") return "mystery";
  if (id === "romance") return "romance";
  if (id === "fantasy" || id === "science_fiction") return "heros-journey";
  if (id === "screenplay") return "three-act";
  return null;
}
