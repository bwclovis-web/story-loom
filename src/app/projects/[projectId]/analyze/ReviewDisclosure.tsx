"use client";

import { useRef, type ReactNode } from "react";

/**
 * Extra review explanation. The summary is the accessible name. It opens with
 * a click, tap, or keyboard, and Escape closes it and returns focus there.
 * The body is text only, so it has no nested controls.
 */
export function ReviewDisclosure({ summary, children }: { summary: string; children: ReactNode }) {
  const details = useRef<HTMLDetailsElement>(null);
  return (
    <details
      ref={details}
      className="review-help"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !details.current?.open) return;
        event.preventDefault();
        event.stopPropagation();
        details.current.open = false;
        details.current.querySelector("summary")?.focus();
      }}
    >
      <summary>{summary}</summary>
      <div className="review-help-body">{children}</div>
    </details>
  );
}
