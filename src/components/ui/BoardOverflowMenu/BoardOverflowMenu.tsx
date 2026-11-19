import type { ReactNode } from "react";
import { cn } from "@/ui/cn";
import { SHELL } from "@/ui/labels";

/** Shared “more actions” disclosure used by Weave / Board / Map toolbars. */
export function BoardOverflowMenu({
  children,
  summary = SHELL.moreActions,
  summaryLabel,
  className,
}: {
  children: ReactNode;
  summary?: string;
  /** Accessible name when the visible summary text differs (e.g. Weave overflow). */
  summaryLabel?: string;
  className?: string;
}) {
  return (
    <details className={cn("board-overflow", className)}>
      <summary aria-label={summaryLabel ?? summary}>{summary}</summary>
      <div className="board-overflow-body">{children}</div>
    </details>
  );
}
