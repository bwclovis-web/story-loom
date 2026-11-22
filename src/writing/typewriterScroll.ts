import type { EditorSurface } from "@/components/writing/EditorSurface";

type ScrollableEditor = Pick<EditorSurface, "value" | "selectionStart" | "clientHeight" | "scrollTop">;

/** Scroll so the caret sits near `ratio` of the viewport height (0–1). */
export function typewriterScrollTop(editor: ScrollableEditor, lineHeightPx: number, ratio = 0.38): number {
  if (!Number.isFinite(lineHeightPx) || lineHeightPx <= 0) return editor.scrollTop;
  const before = editor.value.slice(0, editor.selectionStart);
  const lineIndex = before.split("\n").length - 1;
  const caretY = lineIndex * lineHeightPx;
  const target = caretY - editor.clientHeight * ratio;
  return Math.max(0, target);
}

export function applyTypewriterScroll(editor: EditorSurface | HTMLTextAreaElement, ratio = 0.38): void {
  let lineHeight = 28;
  if (typeof HTMLTextAreaElement !== "undefined" && editor instanceof HTMLTextAreaElement) {
    const parsed = parseFloat(getComputedStyle(editor).lineHeight);
    if (Number.isFinite(parsed) && parsed > 0) lineHeight = parsed;
  } else if ("containsElement" in editor) {
    const active = typeof document !== "undefined" ? document.activeElement : null;
    if (active instanceof HTMLElement && editor.containsElement?.(active)) {
      const parsed = parseFloat(getComputedStyle(active).lineHeight);
      if (Number.isFinite(parsed) && parsed > 0) lineHeight = parsed;
    }
  }
  const next = typewriterScrollTop(editor, lineHeight, ratio);
  if (Math.abs(next - editor.scrollTop) > 1) editor.scrollTop = next;
}
