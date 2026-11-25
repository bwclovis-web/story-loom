"use client";

import { ChevronDown } from "lucide-react";
import { useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { useDismissible } from "@/hooks/useDismissible";
import { useFocusTrap } from "@/hooks/useFocusTrap";
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
  summary?: ReactNode;
  /** Accessible name when the visible summary text differs (e.g. Weave overflow). */
  summaryLabel?: string;
  showChevron?: boolean;
  className?: string;
}) {
  const accessible =
    summaryLabel ?? (typeof summary === "string" ? summary : SHELL.moreActions);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDetailsElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLElement>(null);

  useDismissible({
    active: open,
    onDismiss: () => setOpen(false),
    refs: [rootRef],
    escape: false,
  });

  useFocusTrap(bodyRef, {
    active: open,
    onEscape: () => setOpen(false),
    restoreFocus: true,
    restoreFocusTo: summaryRef,
  });

  const onToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    setOpen(event.currentTarget.open);
  };

  return (
    <details ref={rootRef} className={cn("board-overflow", className)} open={open} onToggle={onToggle}>
      <summary ref={summaryRef} aria-label={accessible}>
        <span className="board-overflow-summary-text">{summary}</span>
        {showChevron ? <ChevronDown className="board-overflow-chevron" strokeWidth={2} aria-hidden="true" /> : null}
      </summary>
      <div ref={bodyRef} className="board-overflow-body" tabIndex={open ? -1 : undefined}>
        {children}
      </div>
    </details>
  );
}
