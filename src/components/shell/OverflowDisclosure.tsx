"use client";

import { useState, type ReactNode, type SyntheticEvent } from "react";

/** Collapsible overflow for secondary create/maintain controls. */
export function OverflowDisclosure({
  summary,
  children,
  className = "",
  summaryClassName,
  icon,
  defaultOpen = false,
  id,
}: {
  summary: string;
  children: ReactNode;
  className?: string;
  /** Classes for the summary. Use `buttonVariants` when it should look like a Button. */
  summaryClassName?: string;
  /** Decorative icon before the summary label. */
  icon?: ReactNode;
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
      <summary className={summaryClassName}>
        {icon ? (
          <span className="icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        {summary}
      </summary>
      <div className="overflow-disclosure-body">{children}</div>
    </details>
  );
}
