"use client";

import { useEffect, type RefObject } from "react";
import { applyTypewriterScroll } from "@/writing/typewriterScroll";

/** In focus mode, keeps the insertion point partway down the visible area while typing. */
export function useTypewriterScroll(textareaRef: RefObject<HTMLTextAreaElement | null>, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const ta = textareaRef.current;
    if (!ta) return;
    const sync = () => applyTypewriterScroll(ta);
    sync();
    ta.addEventListener("input", sync);
    ta.addEventListener("keyup", sync);
    ta.addEventListener("click", sync);
    ta.addEventListener("select", sync);
    return () => {
      ta.removeEventListener("input", sync);
      ta.removeEventListener("keyup", sync);
      ta.removeEventListener("click", sync);
      ta.removeEventListener("select", sync);
    };
  }, [enabled, textareaRef]);
}