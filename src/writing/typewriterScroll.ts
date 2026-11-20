/** Scroll so the caret sits near `ratio` of the textarea viewport height (0–1). */
export function typewriterScrollTop(
  textarea: Pick<HTMLTextAreaElement, "value" | "selectionStart" | "clientHeight" | "scrollTop"> & {
    scrollTop: number;
  },
  lineHeightPx: number,
  ratio = 0.38,
): number {
  if (!Number.isFinite(lineHeightPx) || lineHeightPx <= 0) return textarea.scrollTop;
  const before = textarea.value.slice(0, textarea.selectionStart);
  const lineIndex = before.split("\n").length - 1;
  const caretY = lineIndex * lineHeightPx;
  const target = caretY - textarea.clientHeight * ratio;
  return Math.max(0, target);
}

export function applyTypewriterScroll(textarea: HTMLTextAreaElement, ratio = 0.38): void {
  const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight);
  const next = typewriterScrollTop(textarea, lineHeight, ratio);
  if (Math.abs(next - textarea.scrollTop) > 1) textarea.scrollTop = next;
}