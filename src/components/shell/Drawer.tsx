"use client";

import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { IconButton } from "@/components/ui/IconButton";
import { CloseIcon } from "./icons";

/** Viewport width below which the side columns become drawers; matches globals.css. */
export const NARROW_QUERY = "(max-width: 759px)";

/**
 * A modal side drawer for narrow screens. showModal() makes the rest of the
 * page inert and moves focus into the drawer; Escape closes it. Focus goes back
 * to whatever opened it.
 */
export function Drawer({
  id,
  label,
  closeLabel,
  open,
  onClose,
  dark = false,
  children,
}: {
  id: string;
  label: string;
  closeLabel: string;
  open: boolean;
  onClose: () => void;
  dark?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleClose = () => {
      onCloseRef.current();
      const target = returnTo.current;
      returnTo.current = null;
      if (target?.isConnected) target.focus();
    };
    dialog.addEventListener("close", handleClose);
    const wide = window.matchMedia(NARROW_QUERY);
    const handleResize = () => {
      if (!wide.matches && dialog.open) dialog.close();
    };
    wide.addEventListener("change", handleResize);
    return () => {
      dialog.removeEventListener("close", handleClose);
      wide.removeEventListener("change", handleResize);
    };
  }, []);

  function handleClick(event: MouseEvent<HTMLDialogElement>) {
    // The dialog element itself is only hit on the backdrop; links close it after navigating.
    const target = event.target as Element;
    if (target === event.currentTarget || target.closest("a[href]")) ref.current?.close();
  }

  return (
    <dialog ref={ref} id={id} aria-label={label} className={dark ? "drawer dark" : "drawer"} onClick={handleClick}>
      <div className="drawer-inner">
        <IconButton
          tip="end"
          className="drawer-close"
          aria-label={closeLabel}
          onClick={() => ref.current?.close()}
        >
          <CloseIcon />
        </IconButton>
        {children}
      </div>
    </dialog>
  );
}
