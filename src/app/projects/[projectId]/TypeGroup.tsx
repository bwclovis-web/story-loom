"use client";

import { useState, type ReactNode, type SyntheticEvent } from "react";

/** A record-type table that starts open and stays as the author left it. */
export function TypeGroup({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="panel type-group">
      <details open={open} onToggle={(e: SyntheticEvent<HTMLDetailsElement>) => setOpen(e.currentTarget.open)}>
        <summary>
          <h2>{title}</h2>
        </summary>
        <div className="type-group-body">{children}</div>
      </details>
    </section>
  );
}
