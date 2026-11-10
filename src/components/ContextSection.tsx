"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * A collapsible section of a page's context panel. Open beside the document;
 * starts closed when the panel has moved below it on a narrow screen. The
 * author's own toggling is never overridden.
 */
export function ContextSection({
  title,
  count,
  className,
  children,
}: {
  title: string;
  count?: number;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const grid = ref.current?.closest(".with-context");
    if (grid && getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length < 2) setOpen(false);
  }, []);

  return (
    <section className={className ? `context-section ${className}` : "context-section"} aria-labelledby={id}>
      <details ref={ref} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>
          <h2 id={id} className="context-section-title">
            {title}
            {count !== undefined ? <span className="nav-count"> ({count})</span> : null}
          </h2>
        </summary>
        <div className="context-section-body">{children}</div>
      </details>
    </section>
  );
}
