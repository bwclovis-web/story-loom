"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { Image as ImageIcon, Trash2 } from "lucide-react";
import { ConfirmAction, type ConfirmResult } from "@/components/ConfirmAction";
import { MoreIcon } from "@/components/shell/icons";
import { Button } from "@/components/ui/Button";
import { HOME, SHELL, TRASH } from "@/ui/labels";

type TrashAction = (prev: ConfirmResult, formData: FormData) => Promise<ConfirmResult>;
type CoverResult = { ok: true } | { ok: false; message: string };
type SetCoverAction = (formData: FormData) => Promise<CoverResult>;
type ClearCoverAction = () => Promise<CoverResult>;

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
        icon={<Trash2 strokeWidth={1.75} />}
        className="library-menu-action"
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

export function ManuscriptActions({
  title,
  action,
  hasCover,
  setCover,
  clearCover,
}: {
  title: string;
  action: TrashAction;
  hasCover: boolean;
  setCover: SetCoverAction;
  clearCover: ClearCoverAction;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  return (
    <>
      <ActionsMenu label={HOME.manuscriptActions(title)}>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="library-menu-action"
          icon={<ImageIcon strokeWidth={1.75} />}
          onClick={() => dialogRef.current?.showModal()}
        >
          {HOME.changeCover}
        </Button>
        <ConfirmAction
          action={action}
          label={TRASH.moveProject}
          confirmLabel={TRASH.confirmMove(title)}
          pendingLabel={TRASH.moving}
          icon={<Trash2 strokeWidth={1.75} />}
          className="library-menu-action"
          details={
            <p className="small">
              Everything in it moves too. You can restore it from the {TRASH.heading} page.
            </p>
          }
          small
        />
      </ActionsMenu>
      <CoverDialog title={title} hasCover={hasCover} setCover={setCover} clearCover={clearCover} dialogRef={dialogRef} />
    </>
  );
}

function CoverDialog({
  title,
  hasCover,
  setCover,
  clearCover,
  dialogRef,
}: {
  title: string;
  hasCover: boolean;
  setCover: SetCoverAction;
  clearCover: ClearCoverAction;
  dialogRef: RefObject<HTMLDialogElement | null>;
}) {
  const titleId = useId();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function close() {
    dialogRef.current?.close();
  }

  async function save(formData: FormData) {
    setPending(true);
    setMessage(null);
    const result = await setCover(formData);
    setPending(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    close();
  }

  async function clear() {
    setPending(true);
    setMessage(null);
    const result = await clearCover();
    setPending(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    close();
  }

  return (
    <dialog ref={dialogRef} className="library-dialog" aria-labelledby={titleId} onClose={() => setMessage(null)}>
      <form action={save}>
        <h2 id={titleId}>{HOME.coverHeading}</h2>
        <p className="small">{title}</p>
        <label>
          {HOME.coverFile}
          <input name="cover" type="file" accept="image/png,image/jpeg,image/gif,image/webp" required disabled={pending} />
        </label>
        <p className="small">{HOME.coverHint}</p>
        {message ? (
          <p className="small" role="alert">
            {message}
          </p>
        ) : null}
        <div className="row">
          <Button type="submit" disabled={pending}>
            {HOME.saveCover}
          </Button>
          {hasCover ? (
            <Button type="button" variant="secondary" disabled={pending} onClick={clear}>
              {HOME.useDrawnCover}
            </Button>
          ) : null}
          <Button type="button" variant="secondary" onClick={close} disabled={pending}>
            {HOME.cancel}
          </Button>
        </div>
      </form>
    </dialog>
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
