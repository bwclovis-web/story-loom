"use client";

import {
  cloneElement,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { useDismissible } from "@/hooks/useDismissible";
import { useFocusTrap, type FocusableTarget } from "@/hooks/useFocusTrap";
import { cn } from "@/ui/cn";
import { menuPopoverPanelVariants, menuPopoverVariants, type MenuPopoverVariantProps } from "./menuPopoverVariants";

type TriggerProps = {
  ref?: Ref<HTMLElement>;
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
  "aria-haspopup"?: "menu" | "dialog" | "true";
  onClick?: (event: ReactMouseEvent<HTMLElement>) => void;
};

function mergeRefs<T>(...refs: (Ref<T> | undefined)[]): Ref<T> {
  return (node: T) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === "function") ref(node);
      else (ref as { current: T | null }).current = node;
    }
  };
}

export type MenuPopoverProps = MenuPopoverVariantProps & {
  /** Accessible name for the panel. */
  label: string;
  /** Controlled open state. Omit for uncontrolled. */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  menuClassName?: string;
  /** Override the generated panel id (for aria-controls). */
  menuId?: string;
  /** Panel role. Default `menu`. Use `group` for tool palettes. */
  role?: "menu" | "group" | "dialog";
  /**
   * Close when activating a descendant (click). Default true for `role="menu"`,
   * false for `group` / `dialog` so form controls stay open.
   */
  closeOnSelect?: boolean;
  /** Panel element type. Use `ul` when children are `li` items. */
  as?: "div" | "ul";
  /** Trigger control. Receives expanded / controls / haspopup / click wiring. */
  trigger: ReactElement<TriggerProps>;
  children: ReactNode;
  /** Prefer this target when restoring focus after dismiss (DOM node or EditorSurface). */
  restoreFocusRef?: RefObject<FocusableTarget | null>;
};

/**
 * Popover menu with focus trap, outside-click dismiss, and Escape to close.
 * Reuses the existing `.menu-wrap` / `.tool-menu` styles.
 */
export function MenuPopover({
  label,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  align = "end",
  className,
  menuClassName,
  menuId: menuIdProp,
  role = "menu",
  closeOnSelect,
  as = "div",
  trigger,
  children,
  restoreFocusRef,
}: MenuPopoverProps) {
  const reactId = useId();
  const menuId = menuIdProp ?? `menu-popover-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : uncontrolledOpen;

  const setOpen = (next: boolean) => {
    if (!controlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLElement>(null);

  const shouldCloseOnSelect = closeOnSelect ?? role === "menu";

  useDismissible({
    active: open,
    onDismiss: () => setOpen(false),
    refs: [rootRef],
    // Escape is handled by the focus trap so restore-focus runs in one place.
    escape: false,
  });

  useFocusTrap(panelRef, {
    active: open,
    onEscape: () => setOpen(false),
    restoreFocus: true,
    restoreFocusTo: restoreFocusRef ?? triggerRef,
  });

  const triggerNode = cloneElement(trigger, {
    // React 19: ref is a normal prop on the element, not element.ref.
    ref: mergeRefs(triggerRef, trigger.props.ref),
    "aria-expanded": open,
    "aria-controls": menuId,
    "aria-haspopup": role === "dialog" ? "dialog" : "menu",
    onClick: (event: ReactMouseEvent<HTMLElement>) => {
      trigger.props.onClick?.(event);
      if (event.defaultPrevented) return;
      setOpen(!open);
    },
  });

  const panelClassName = cn(menuPopoverPanelVariants({ align }), menuClassName);
  const onPanelClick = shouldCloseOnSelect
    ? (event: ReactMouseEvent<HTMLElement>) => {
        const target = event.target as HTMLElement | null;
        if (!target) return;
        if (target.closest("a[href], button:not([disabled])")) setOpen(false);
      }
    : undefined;
  const onPanelKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={cn(menuPopoverVariants({ align }), className)}>
      {triggerNode}
      {as === "ul" ? (
        <ul
          ref={panelRef as RefObject<HTMLUListElement>}
          id={menuId}
          className={panelClassName}
          role={role}
          aria-label={label}
          hidden={!open}
          tabIndex={open ? -1 : undefined}
          onClick={onPanelClick}
          onKeyDown={onPanelKeyDown}
        >
          {children}
        </ul>
      ) : (
        <div
          ref={panelRef as RefObject<HTMLDivElement>}
          id={menuId}
          className={panelClassName}
          role={role}
          aria-label={label}
          hidden={!open}
          tabIndex={open ? -1 : undefined}
          onClick={onPanelClick}
          onKeyDown={onPanelKeyDown}
        >
          {children}
        </div>
      )}
    </div>
  );
}
