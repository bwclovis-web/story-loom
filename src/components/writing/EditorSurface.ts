import type { TextEdit } from "@/writing/findReplace";

/**
 * Shared editing surface for manuscript prose. CodeMirror and (legacy) textarea
 * both satisfy this shape so format, find/replace, proofread, and spell panels
 * keep working against exact UTF-16 offsets on a `\n`-normalized document.
 */
export interface EditorSurface {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  setSelectionRange(start: number, end: number, direction?: "forward" | "backward" | "none"): void;
  focus(options?: FocusOptions): void;
  blur?(): void;
  scrollTop: number;
  readonly clientHeight: number;
  readonly clientWidth: number;
  /**
   * Apply a ranged edit. CodeMirror returns "native" (joins history).
   * Textareas may return "direct" when execCommand fails.
   */
  applyEdit?(edit: TextEdit): "native" | "direct";
  /** Optional native undo/redo when the surface supports them (CodeMirror history). */
  undo?(): boolean;
  redo?(): boolean;
  /** True when this surface is the document's active editor element. */
  containsElement?(el: EventTarget | null): boolean;
  /**
   * Replace the chapter body and the nested scene bodies shown in locked ranges.
   * Used after structure edits so the nest at each break matches book order.
   */
  setComposedChapter?(chapter: string, scenes: readonly { body: string }[]): void;
}

export function isEditorSurface(value: unknown): value is EditorSurface {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as EditorSurface).value === "string" &&
    typeof (value as EditorSurface).selectionStart === "number" &&
    typeof (value as EditorSurface).setSelectionRange === "function" &&
    typeof (value as EditorSurface).focus === "function"
  );
}
