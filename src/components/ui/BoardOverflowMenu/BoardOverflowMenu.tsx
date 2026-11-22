import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/ui/cn";
import { SHELL } from "@/ui/labels";

/** Shared “more actions” disclosure used by Weave / Board / Map toolbars. */
export function BoardOverflowMenu({
  children,
  summary = SHELL.moreActions,
  summaryLabel,
  showChevron = false,
  className,
}: {
  children: ReactNode;
  summary?: string;
  /** Accessible name when the visible summary text differs (e.g. Weave overflow). */
  summaryLabel?: string;
  showChevron?: boolean;
  className?: string;
}) {
  return (
    <details className={cn("board-overflow", className)}>
      <summary aria-label={summaryLabel ?? summary}>
        <span className="board-overflow-summary-text">{summary}</span>
        {showChevron ? <ChevronDown className="board-overflow-chevron" strokeWidth={2} aria-hidden="true" /> : null}
      </summary>
      <div className="board-overflow-body">{children}</div>
    </details>
  );
}
