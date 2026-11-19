import type { ReactNode } from "react";
import { cn } from "@/ui/cn";

/** Title row (+ optional lead and trailing actions) used on World / Plan list pages. */
export function PageHeader({
  title,
  lead,
  actions,
  className,
  leadClassName,
}: {
  title: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
  className?: string;
  leadClassName?: string;
}) {
  return (
    <>
      <div className={cn("page-head", className)}>
        <h1>{title}</h1>
        {actions}
      </div>
      {lead != null ? <p className={cn("page-lead", leadClassName)}>{lead}</p> : null}
    </>
  );
}
