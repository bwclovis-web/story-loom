import type { ReactNode } from "react";
import { cn } from "@/ui/cn";

/** Quiet empty-list copy. Prefer this over ad-hoc `<p className="muted">`. */
export function EmptyState({
  children,
  className,
  as: Tag = "p",
}: {
  children: ReactNode;
  className?: string;
  as?: "p" | "div" | "li";
}) {
  return <Tag className={cn("muted", className)}>{children}</Tag>;
}
