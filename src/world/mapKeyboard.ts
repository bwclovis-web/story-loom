/**
 * Map lists handle arrows and Enter for the list itself and its options.
 * A link, field, or other button keeps the browser's own key behavior.
 */
export interface KeyTarget {
  closest(selector: string): KeyTarget | null;
}

const FIELD = "a, input, select, textarea, [contenteditable='true']";

const TYPING = "input, textarea, select, [contenteditable='true']";

/** Drawing keys stay out of fields so typing and editor shortcuts keep working. */
export function mapDrawingHandlesKey(target: EventTarget | KeyTarget | null): boolean {
  if (target == null || !("closest" in target) || typeof target.closest !== "function") return true;
  return target.closest(TYPING) == null;
}

export function mapListHandlesKey(target: EventTarget | KeyTarget | null, currentTarget: EventTarget | KeyTarget | null): boolean {
  if (target == null || target === currentTarget) return true;
  if (!("closest" in target) || typeof target.closest !== "function") return true;
  const field = target.closest(FIELD);
  if (field && field !== currentTarget) return false;
  const button = target.closest("button");
  if (button && button !== currentTarget && !button.closest("[role='option']")) return false;
  return true;
}
