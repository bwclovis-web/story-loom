"use client";

import { useState, type ReactNode, type SyntheticEvent } from "react";

/** Collapsible overflow for secondary create/maintain controls. */
export function OverflowDisclosure({
  summary,
  children,
  className = "",
  defaultOpen = false,
}: {
  summary: string;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className={`overflow-disclosure ${className}`.trim()}
      open={open}
      onToggle={(e: SyntheticEvent<HTMLDetailsElement>) => setOpen(e.currentTarget.open)}
    >
      <summary>{summary}</summary>
      <div className="overflow-disclosure-body">{children}</div>
    </details>
  );
}
