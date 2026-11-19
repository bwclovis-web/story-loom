"use client";

import type { ReactNode } from "react";
import { ChevronRightIcon } from "./icons";

/** A project-column heading that shows or hides the list under it. */
export function CollapsibleNavSection({
  sectionKey,
  collapsed,
  onToggle,
  headingId,
  heading,
  count,
  forceOpen = false,
  children,
}: {
  sectionKey: string;
  collapsed: ReadonlySet<string>;
  onToggle: (key: string) => void;
  headingId: string;
  heading: string;
  count?: number;
  /** Keep the list visible, for example while a search is showing matches. */
  forceOpen?: boolean;
  children: ReactNode;
}) {
  const open = forceOpen || !collapsed.has(sectionKey);
  const bodyId = `${headingId}-body`;
  return (
    <div className="nav-section">
      <button
        type="button"
        className="nav-section-toggle"
        id={headingId}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => {
          if (!forceOpen) onToggle(sectionKey);
        }}
      >
        <ChevronRightIcon />
        <span className="nav-section-label">{heading}</span>
        {count !== undefined ? <span className="nav-count">{count}</span> : null}
      </button>
      <div id={bodyId} hidden={!open}>
        {children}
      </div>
    </div>
  );
}
