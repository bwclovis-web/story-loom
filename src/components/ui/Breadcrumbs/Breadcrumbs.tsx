import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/ui/cn";

export type BreadcrumbItem = {
  label: ReactNode;
  href?: string;
  current?: boolean;
  /** Client navigation (e.g. map trail) when href alone is not enough. */
  onSelect?: () => void;
};

/**
 * Compact trail above a page title. Use this on nested pages (World tools,
 * Weave grids, reference records) instead of a one-off breadcrumb list.
 * The last item may omit href and set `current`.
 */
export function Breadcrumbs({
  label,
  items,
  className,
}: {
  label: string;
  items: BreadcrumbItem[];
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn("breadcrumbs", className)}>
      <ol>
        {items.map((item, index) => {
          const current = item.current || (!item.href && index === items.length - 1);
          return (
            <li key={index}>
              {item.onSelect && !current ? (
                <button type="button" className="breadcrumb-link" onClick={item.onSelect}>
                  {item.label}
                </button>
              ) : item.href && !current ? (
                <Link href={item.href}>{item.label}</Link>
              ) : (
                <span aria-current={current ? "page" : undefined}>{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
