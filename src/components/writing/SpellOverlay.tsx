"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import type { SpellFlag } from "@/spelling/dictionary";

/*
 * Draws spelling underlines over a textarea, which cannot style parts of its
 * own text. A copy of the text in the same font, padding and width sits on top
 * with transparent letters, so only the underlines show; it ignores the mouse
 * and follows the textarea's scrolling.
 */

const COPIED = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "fontVariant",
  "lineHeight",
  "letterSpacing",
  "wordSpacing",
  "tabSize",
  "textIndent",
  "textTransform",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "direction",
] as const;

function measure(ta: HTMLTextAreaElement): CSSProperties {
  const cs = getComputedStyle(ta);
  const style: Record<string, string | number> = {};
  for (const key of COPIED) style[key] = cs[key];
  return {
    ...style,
    top: ta.offsetTop + ta.clientTop,
    left: ta.offsetLeft + ta.clientLeft,
    width: ta.clientWidth,
    height: ta.clientHeight,
  };
}

function segments(text: string, flags: readonly SpellFlag[], current: SpellFlag | null): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  let n = 0;
  for (const f of flags) {
    if (f.start < at || f.end > text.length) continue;
    if (f.start > at) out.push(text.slice(at, f.start));
    const isCurrent = current !== null && current.start === f.start && current.end === f.end;
    // Keyed by order, not offset: typing shifts offsets, and offset keys would rebuild every later underline.
    out.push(
      <mark key={n++} className={isCurrent ? "spell-flag current" : "spell-flag"}>
        {text.slice(f.start, f.end)}
      </mark>,
    );
    at = f.end;
  }
  // A trailing newline needs something after it to take up a line, as it does in the textarea.
  out.push(text.slice(at) + "\n\u00a0");
  return out;
}

/** Memoised: the editor re-renders on every keystroke, but the overlay only needs to when its deferred props change. */
export const SpellOverlay = memo(function SpellOverlay({
  textareaRef,
  text,
  flags,
  current,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  text: string;
  flags: readonly SpellFlag[];
  current: SpellFlag | null;
}) {
  const overlayRef = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const update = () => setBox(measure(ta));
    const sync = () => {
      if (overlayRef.current) overlayRef.current.scrollTop = ta.scrollTop;
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(ta);
    ta.addEventListener("scroll", sync);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      ta.removeEventListener("scroll", sync);
      window.removeEventListener("resize", update);
    };
  }, [textareaRef]);

  // Reading scrollTop right after a commit forces a layout of the whole text; waiting a frame shares the browser's own.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta && overlayRef.current) overlayRef.current.scrollTop = ta.scrollTop;
    });
    return () => cancelAnimationFrame(frame);
  }, [textareaRef, text, flags, box]);

  if (!box) return null;
  return (
    <span ref={overlayRef} className="spell-overlay" style={box} aria-hidden="true">
      {segments(text, flags, current)}
    </span>
  );
});
