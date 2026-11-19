"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ConfirmAction, type ConfirmResult } from "@/components/ConfirmAction";
import { MoreIcon } from "@/components/shell/icons";
import { HOME, SHELL, TRASH } from "@/ui/labels";

type TrashAction = (prev: ConfirmResult, formData: FormData) => Promise<ConfirmResult>;

export function WorkspaceActions({
  name,
  projectCount,
  action,
}: {
  name: string;
  projectCount: number;
  action: TrashAction;
}) {
  const details =
    projectCount === 0
      ? "It has no manuscripts."
      : projectCount === 1
        ? "Its manuscript and everything in it move too."
        : `Its ${SHELL.projects(projectCount)} and everything in them move too.`;
  return (
    <ActionsMenu label={HOME.workspaceActions(name)}>
      <ConfirmAction
        action={action}
        label={TRASH.moveWorkspace}
        confirmLabel={TRASH.confirmMove(name)}
        pendingLabel={TRASH.moving}
        details={
          <p className="small">
            {details} You can restore it from the {TRASH.heading} page.
          </p>
        }
        small
      />
    </ActionsMenu>
  );
}

export function ManuscriptActions({ title, action }: { title: string; action: TrashAction }) {
  return (
    <ActionsMenu label={HOME.manuscriptActions(title)}>
      <ConfirmAction
        action={action}
        label={TRASH.moveProject}
        confirmLabel={TRASH.confirmMove(title)}
        pendingLabel={TRASH.moving}
        details={
          <p className="small">
            Everything in it moves too. You can restore it from the {TRASH.heading} page.
          </p>
        }
        small
      />
    </ActionsMenu>
  );
}

function ActionsMenu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      event.preventDefault();
      setOpen(false);
      button.current?.focus();
    }
  }

  return (
    <div className="library-menu" ref={wrapper} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className="library-menu-button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={menuId}
        aria-haspopup="true"
        onClick={() => setOpen((value) => !value)}
      >
        <MoreIcon />
      </button>
      <div id={menuId} className="library-menu-popover" role="group" aria-label={label} hidden={!open}>
        {children}
      </div>
    </div>
  );
}
