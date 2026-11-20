/** Writing-page layout. Only navigation, the context panel, and manuscript width change. */
export const WRITE_MODES = ["desk", "focus", "companion"] as const;

export type WriteMode = (typeof WRITE_MODES)[number];

export const DEFAULT_WRITE_MODE: WriteMode = "desk";

export function parseWriteMode(value: unknown): WriteMode {
  return value === "desk" || value === "focus" || value === "companion" ? value : DEFAULT_WRITE_MODE;
}
