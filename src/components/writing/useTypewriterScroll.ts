"use client";

import { useEffect, type RefObject } from "react";
import type { EditorSurface } from "@/components/writing/EditorSurface";
import { applyTypewriterScroll } from "@/writing/typewriterScroll";

/** In focus mode, keeps the insertion point partway down the visible area while typing. */
export function useTypewriterScroll(
  editorRef: RefObject<EditorSurface | HTMLTextAreaElement | null>,
  enabled: boolean,
  /** Bump when text or selection changes so CM surfaces re-sync without DOM input events. */
  syncKey?: string | number,
): void {
  useEffect(() => {
    if (!enabled) return;
    const editor = editorRef.current;
    if (!editor) return;
    applyTypewriterScroll(editor);

    if (typeof HTMLTextAreaElement !== "undefined" && editor instanceof HTMLTextAreaElement) {
      const sync = () => applyTypewriterScroll(editor);
      editor.addEventListener("input", sync);
      editor.addEventListener("keyup", sync);
      editor.addEventListener("click", sync);
      editor.addEventListener("select", sync);
      return () => {
        editor.removeEventListener("input", sync);
        editor.removeEventListener("keyup", sync);
        editor.removeEventListener("click", sync);
        editor.removeEventListener("select", sync);
      };
    }
    return undefined;
  }, [enabled, editorRef, syncKey]);
}
