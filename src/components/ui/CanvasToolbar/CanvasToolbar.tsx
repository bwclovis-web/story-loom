import type { ReactNode } from "react";
import { cn } from "@/ui/cn";

/** Shared board / weave / map action bar shell. */
export function CanvasToolbar({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("board-toolbar board-toolbar-compact", className)} role="toolbar" aria-label={label}>
      {children}
    </div>
  );
}

/** Cluster inside a canvas toolbar (optional grow / actions placement). */
export function CanvasToolbarGroup({
  children,
  grow = false,
  actions = false,
  className,
}: {
  children: ReactNode;
  grow?: boolean;
  actions?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "board-toolbar-group",
        grow && "board-toolbar-grow",
        actions && "board-toolbar-actions",
        className,
      )}
    >
      {children}
    </div>
  );
}
