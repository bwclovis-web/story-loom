"use client";

import { useEffect, useRef, type RefObject } from "react";

export type UseDismissibleOptions = {
  active: boolean;
  onDismiss: () => void;
  /** Clicks inside any of these roots do not dismiss. */
  refs: RefObject<HTMLElement | null>[];
  /** Also dismiss on Escape. Default true. Set false when Escape is handled by `useFocusTrap`. */
  escape?: boolean;
  /** Listen for pointerdown (default) so menus close before the next click target runs. */
  event?: "pointerdown" | "mousedown";
};

/**
 * Dismisses an open layer when the user clicks outside its roots or presses Escape.
 */
export function useDismissible({
  active,
  onDismiss,
  refs,
  escape = true,
  event = "pointerdown",
}: UseDismissibleOptions) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const refsRef = useRef(refs);
  refsRef.current = refs;

  useEffect(() => {
    if (!active) return;

    const isInside = (target: EventTarget | null) => {
      if (!(target instanceof Node)) return false;
      return refsRef.current.some((ref) => ref.current?.contains(target));
    };

    const onPointer = (e: Event) => {
      if (isInside(e.target)) return;
      onDismissRef.current();
    };

    const onKey = (e: KeyboardEvent) => {
      if (!escape || e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onDismissRef.current();
    };

    // Defer so the same click that opened the layer does not immediately close it.
    const timer = window.setTimeout(() => {
      document.addEventListener(event, onPointer);
      if (escape) document.addEventListener("keydown", onKey, true);
    }, 0);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener(event, onPointer);
      if (escape) document.removeEventListener("keydown", onKey, true);
    };
  }, [active, escape, event]);
}
