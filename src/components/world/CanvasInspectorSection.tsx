import type { ReactNode } from "react";

/** Collapsible inspector block for map and board context rails. */
export function CanvasInspectorSection({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="canvas-inspector-section" open={defaultOpen}>
      <summary>{title}</summary>
      <div className="canvas-inspector-section-body">{children}</div>
    </details>
  );
}