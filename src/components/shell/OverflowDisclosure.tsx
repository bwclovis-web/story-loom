"use client";

import { useState, type ReactNode, type SyntheticEvent } from "react";

/** Collapsible overflow for secondary create/maintain controls. */
export function OverflowDisclosure({
  summary,
  children,
  className = "",
  defaultOpen = false,
  id,
}: {
  summary: string;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
  id?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      id={id}
      className={`overflow-disclosure ${className}`.trim()}
      open={open}
      onToggle={(e: SyntheticEvent<HTMLDetailsElement>) => setOpen(e.currentTarget.open)}
    >
      <summary>{summary}</summary>
      <div className="overflow-disclosure-body">{children}</div>
    </details>
  );
}
