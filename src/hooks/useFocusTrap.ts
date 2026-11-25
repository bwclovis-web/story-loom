"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** Anything with `.focus()` — DOM elements or wrappers like `EditorSurface`. */
export type FocusableTarget = { focus(options?: FocusOptions): void };

function isInDocument(node: Node): boolean {
  return document.contains(node);
}

/** Focus a restore target; skip detached DOM nodes; allow non-Node focusables. */
export function focusRestoreTarget(target: FocusableTarget | null | undefined): void {
  if (!target) return;
  // preventScroll: CodeMirror's contentDOM is document-tall; focusing it otherwise
  // scrolls the outer write column to the top of the chapter.
  if (target instanceof Node) {
    if (isInDocument(target)) (target as HTMLElement).focus({ preventScroll: true });
    return;
  }
  target.focus({ preventScroll: true });
}

/** Focusable descendants that are visible and not inside a nested `[hidden]` subtree. */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
    if (el.closest("[hidden]")) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    const style = window.getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return false;
    return true;
  });
}

export type UseFocusTrapOptions = {
  /** When true, Tab cycles inside the container and focus is moved in on activate. */
  active: boolean;
  /** Called when Escape is pressed while the trap is active. */
  onEscape?: (event: KeyboardEvent) => void;
  /** Restore focus to the previously focused element (or `restoreFocusTo`) when deactivating. Default true. */
  restoreFocus?: boolean;
  /**
   * Preferred restore target when the trap deactivates.
   * Accepts DOM elements or non-Node focusables (e.g. CodeMirror `EditorSurface`).
   */
  restoreFocusTo?: RefObject<FocusableTarget | null>;
  /** Preferred first focus target when the trap activates. Falls back to the first focusable. */
  initialFocusRef?: RefObject<HTMLElement | null>;
};

/**
 * Traps keyboard focus inside `containerRef` while `active` is true.
 * Tab / Shift+Tab cycle; Escape calls `onEscape` when provided.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  {
    active,
    onEscape,
    restoreFocus = true,
    restoreFocusTo,
    initialFocusRef,
  }: UseFocusTrapOptions,
) {
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const activeEl = document.activeElement;
    previouslyFocused.current = activeEl instanceof HTMLElement ? activeEl : null;

    const focusInitial = () => {
      const preferred = initialFocusRef?.current;
      if (preferred && container.contains(preferred)) {
        preferred.focus();
        return;
      }
      const focusable = getFocusableElements(container);
      (focusable[0] ?? container).focus();
    };

    // Defer so the panel is painted / not still `hidden` when we query.
    const frame = window.requestAnimationFrame(focusInitial);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!onEscapeRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        onEscapeRef.current(event);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = getFocusableElements(container);
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;
      if (event.shiftKey) {
        const outside =
          !(current instanceof Node) || current === first || !container.contains(current);
        if (outside) {
          event.preventDefault();
          last.focus();
        }
        return;
      }
      if (current === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown, true);
      if (!restoreFocus) return;
      focusRestoreTarget(restoreFocusTo?.current ?? previouslyFocused.current);
    };
  }, [active, containerRef, initialFocusRef, restoreFocus, restoreFocusTo]);
}
