"use client";

import { useId, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { WORLD } from "@/ui/labels";

/** Opens the new-reference form. The control is a real Button, not a disclosure summary. */
export function NewReferenceButton({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="world-new-reference">
      <Button
        type="button"
        icon={<Plus strokeWidth={1.75} />}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {WORLD.newReference}
      </Button>
      {open ? (
        <div id={panelId} className="world-new-reference-form panel">
          {children}
        </div>
      ) : null}
    </div>
  );
}
