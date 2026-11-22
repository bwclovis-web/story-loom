import { applyEdit, type TextEdit } from "@/writing/findReplace";
import type { EditorSurface } from "./EditorSurface";

/**
 * Applies an edit as an author keystroke so undo restores it.
 * CodeMirror surfaces use history transactions; textarea falls back to
 * execCommand, then setRangeText when the browser refuses native undo.
 */
export function applyTextareaEdit(surface: EditorSurface | HTMLTextAreaElement, edit: TextEdit): "native" | "direct" {
  if (isTextArea(surface)) return applyToTextarea(surface, edit);
  if (surface.applyEdit) return surface.applyEdit(edit);
  const before = surface.value;
  const expected = applyEdit(before, edit);
  surface.focus();
  surface.value = expected;
  surface.setSelectionRange(edit.start + edit.text.length, edit.start + edit.text.length);
  return surface.value === expected ? "native" : "direct";
}

function isTextArea(value: EditorSurface | HTMLTextAreaElement): value is HTMLTextAreaElement {
  return typeof HTMLTextAreaElement !== "undefined" && value instanceof HTMLTextAreaElement;
}

function applyToTextarea(textarea: HTMLTextAreaElement, edit: TextEdit): "native" | "direct" {
  const before = textarea.value;
  const expected = applyEdit(before, edit);
  textarea.focus();
  textarea.setSelectionRange(edit.start, edit.end);
  try {
    if (edit.text === "") document.execCommand("delete", false);
    else document.execCommand("insertText", false, edit.text);
  } catch {
    // Fall through to the direct edit below.
  }
  if (textarea.value === expected) return "native";
  if (textarea.value !== before) textarea.value = before;
  textarea.setRangeText(edit.text, edit.start, edit.end, "end");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  return "direct";
}

export function selectRange(surface: EditorSurface | HTMLTextAreaElement, start: number, end: number) {
  surface.focus();
  surface.setSelectionRange(start, end);
}

/** Scroll so the current selection is near the middle of the viewport. */
export function scrollTextareaToSelection(
  surface: EditorSurface | HTMLTextAreaElement,
  centerRatio = 0.35,
): void {
  const start = surface.selectionStart;
  const value = surface.value;
  let lineHeight = 28;
  if (isTextArea(surface)) {
    const parsed = parseFloat(getComputedStyle(surface).lineHeight);
    if (Number.isFinite(parsed) && parsed > 0) lineHeight = parsed;
  } else {
    const active = typeof document !== "undefined" ? document.activeElement : null;
    if (active instanceof HTMLElement && surface.containsElement?.(active)) {
      const parsed = parseFloat(getComputedStyle(active).lineHeight);
      if (Number.isFinite(parsed) && parsed > 0) lineHeight = parsed;
    }
  }
  const lineIndex = value.slice(0, start).split("\n").length - 1;
  const caretY = lineIndex * lineHeight;
  surface.scrollTop = Math.max(0, caretY - surface.clientHeight * centerRatio);
}
