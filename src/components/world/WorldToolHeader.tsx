import type { ReactNode } from "react";
import { Breadcrumbs, type BreadcrumbItem } from "@/components/ui/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { WORLD } from "@/ui/labels";

/**
 * Tool-page chrome: the shared breadcrumb trail, then the existing page header.
 * Nested pages outside World can keep using `Breadcrumbs` on their own.
 */
export function WorldToolHeader({
  items,
  title,
  lead,
  actions,
  help,
}: {
  items: BreadcrumbItem[];
  title: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
  help?: ReactNode;
}) {
  return (
    <header className="world-tool-header">
      <Breadcrumbs label={WORLD.breadcrumb} items={items} />
      <PageHeader title={title} lead={lead} actions={actions} />
      {help}
    </header>
  );
}
