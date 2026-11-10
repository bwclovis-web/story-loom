import { applyEdit, type TextEdit } from "@/writing/findReplace";

/**
 * Applies an edit to a textarea as if the author typed it, so the browser's
 * own undo (Ctrl+Z) and redo restore it. `execCommand("insertText")` is the
 * only way to join the native undo history. Where a browser refuses it, the
 * text is changed directly and the caller must offer its own undo.
 */
export function applyTextareaEdit(textarea: HTMLTextAreaElement, edit: TextEdit): "native" | "direct" {
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

export function selectRange(textarea: HTMLTextAreaElement, start: number, end: number) {
  textarea.focus();
  textarea.setSelectionRange(start, end);
}
