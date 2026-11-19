"use client";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { PanelRightIcon } from "@/components/shell/icons";
import { useLayout } from "@/components/shell/LayoutContext";
import { PanelResizer } from "@/components/shell/PanelResizer";
import { IconButton } from "@/components/ui/IconButton";
import { WRITE } from "@/ui/labels";

/** At this viewport width and above the context panel sits beside the page; below it opens over the page. */
export const CONTEXT_RAIL_WIDE_QUERY = "(min-width: 1200px)";

export function useWideViewport(query = CONTEXT_RAIL_WIDE_QUERY): boolean {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setWide(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return wide;
}

export interface ContextRailApi {
  wide: boolean;
  /** True when the rail should be shown (respects focusMode / forceHidden). */
  visible: boolean;
  toggle: () => void;
  close: () => void;
  toggleRef: RefObject<HTMLButtonElement | null>;
}

/**
 * Collapse / overlay state for the shared context rail. Uses the `wordly-layout`
 * cookie (`contextHidden`, `contextWidth`) so Write and World stay in sync.
 */
export function useContextRail(options?: { forceHidden?: boolean }): ContextRailApi {
  const wide = useWideViewport();
  const { layout, updateLayout, focusMode } = useLayout();
  const [overlayOpen, setOverlayOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const forceHidden = Boolean(options?.forceHidden) || focusMode;

  const visible = !forceHidden && (wide ? !layout.contextHidden : overlayOpen);

  const toggle = () => {
    if (wide) updateLayout({ contextHidden: !layout.contextHidden });
    else setOverlayOpen((open) => !open);
  };

  const close = () => {
    if (wide) {
      if (!layout.contextHidden) updateLayout({ contextHidden: true });
    } else {
      setOverlayOpen(false);
      toggleRef.current?.focus();
    }
  };

  return { wide, visible, toggle, close, toggleRef };
}

/** Icon button that shows or hides the context rail. */
export function ContextRailToggle({
  rail,
  controls,
  showLabel = WRITE.showContext,
  hideLabel = WRITE.hideContext,
}: {
  rail: ContextRailApi;
  /** id of the rail aside */
  controls?: string;
  showLabel?: string;
  hideLabel?: string;
}) {
  const label = rail.visible ? hideLabel : showLabel;
  return (
    <IconButton
      ref={rail.toggleRef}
      tip="tip"
      className="context-toggle"
      aria-label={label}
      aria-expanded={rail.visible}
      aria-controls={controls}
      onClick={rail.toggle}
    >
      <PanelRightIcon />
    </IconButton>
  );
}

/**
 * Aside chrome shared by Write and World: sticky width beside the page on wide
 * screens, overlay + backdrop on narrow, Escape closes overlay, focus returns
 * to the toggle.
 */
export function ContextRail({
  id,
  labelledBy,
  rail,
  children,
  className = "",
  /** Focus the selected tab (or first focusable) when the overlay opens. */
  focusOnOverlayOpen,
}: {
  id: string;
  labelledBy: string;
  rail: ContextRailApi;
  children: ReactNode;
  className?: string;
  focusOnOverlayOpen?: boolean;
}) {
  const contextRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!rail.wide && rail.visible && focusOnOverlayOpen) {
      const tab = contextRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      (tab ?? contextRef.current?.querySelector<HTMLElement>("button, a, input, [tabindex]:not([tabindex='-1'])"))?.focus();
    }
  }, [rail.wide, rail.visible, focusOnOverlayOpen]);

  return (
    <>
      {rail.wide ? (
        <PanelResizer
          panel="contextWidth"
          controls={id}
          label={WRITE.resizeContext}
          // Keep the handle mounted so the rail can animate width without a layout jump.
          hidden={!rail.visible}
        />
      ) : (
        <div
          className="context-backdrop"
          data-open={rail.visible ? "" : undefined}
          aria-hidden="true"
          onClick={rail.close}
        />
      )}
      <aside
        ref={contextRef}
        id={id}
        className={`write-context ${rail.wide ? "inline" : "overlay"}${className ? ` ${className}` : ""}`}
        aria-labelledby={labelledBy}
        data-open={rail.visible ? "" : undefined}
        aria-hidden={!rail.visible}
        inert={!rail.visible ? true : undefined}
      >
        {children}
      </aside>
    </>
  );
}
