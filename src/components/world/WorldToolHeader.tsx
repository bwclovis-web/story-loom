import type { ReactNode } from "react";
import { ProjectPageHeader } from "@/components/library/ProjectPageHeader";
import type { BreadcrumbItem } from "@/components/ui/Breadcrumbs";

/**
 * World tool pages use the shared project header. The title changes.
 * `items` is the breadcrumb trail for this nested page.
 */
export async function WorldToolHeader({
  projectId,
  items,
  title,
  lead,
  actions,
  help,
  gettingStarted,
}: {
  projectId: string;
  items: BreadcrumbItem[];
  title: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
  help?: ReactNode;
  gettingStarted?: ReactNode;
}) {
  return (
    <header className="world-tool-header">
      <ProjectPageHeader
        projectId={projectId}
        title={title}
        description={typeof lead === "string" ? lead : undefined}
        crumbs={items}
        actions={actions}
        gettingStarted={gettingStarted}
      />
      {lead != null && typeof lead !== "string" ? lead : null}
      {help}
    </header>
  );
}
