"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { helpPopoverClasses } from "./helpPopoverVariants";

/** Keep the open panel beside its icon, including narrow windows. */
function placeHelpPopover(panel: HTMLElement, trigger: HTMLElement) {
  const margin = 12;
  const gap = 6;
  const width = Math.min(352, window.innerWidth - margin * 2);
  const triggerRect = trigger.getBoundingClientRect();
  const left = Math.min(Math.max(margin, triggerRect.left), window.innerWidth - width - margin);
  panel.style.width = `${width}px`;
  panel.style.left = `${left}px`;
  panel.style.top = `${triggerRect.bottom + gap}px`;
  const panelRect = panel.getBoundingClientRect();
  if (panelRect.bottom > window.innerHeight - margin) {
    panel.style.top = `${Math.max(margin, triggerRect.top - panelRect.height - gap)}px`;
  }
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 26 26" width="34" height="34" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 7.15v4.15" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="4.65" r="0.75" fill="currentColor" />
    </svg>
  );
}

/**
 * Info icon that sits on the same line as the nearby text. Hover, focus, or
 * tap opens the explanation. Escape closes it and returns focus to the icon.
 * Clicking elsewhere closes it. The panel is text only.
 */
export function HelpPopover({ label, children }: { label: string; children: ReactNode }) {
  const panelId = `help-popover-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const anchor = `--${panelId}`;
  const root = useRef<HTMLSpanElement>(null);
  const pinned = useRef(false);
  const closedByEscape = useRef(false);
  const closeTimer = useRef<number | null>(null);

  useEffect(() => {
    const rootElement = root.current;
    const panel = document.getElementById(panelId);
    if (!rootElement || !panel) return;
    const place = () => {
      if (CSS.supports("anchor-name", "--a")) return;
      const trigger = rootElement.querySelector("button");
      if (trigger && panel.matches(":popover-open")) placeHelpPopover(panel, trigger);
    };
    const onToggle = (event: Event) => {
      const trigger = rootElement.querySelector("button");
      const state = "newState" in event ? String(event.newState) : "";
      if (state === "open") {
        place();
        trigger?.setAttribute("aria-expanded", "true");
        return;
      }
      pinned.current = false;
      trigger?.setAttribute("aria-expanded", "false");
      if (state === "closed" && closedByEscape.current && trigger) {
        closedByEscape.current = false;
        trigger.focus();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !panel.matches(":popover-open")) return;
      closedByEscape.current = true;
      panel.hidePopover();
    };
    panel.addEventListener("toggle", onToggle);
    document.addEventListener("keydown", onKey);
    return () => {
      panel.removeEventListener("toggle", onToggle);
      document.removeEventListener("keydown", onKey);
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    };
  }, [panelId]);

  const show = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    const panel = document.getElementById(panelId);
    const trigger = root.current?.querySelector("button");
    if (!panel || !trigger) return;
    if (!panel.matches(":popover-open")) panel.showPopover();
    if (!CSS.supports("anchor-name", "--a")) placeHelpPopover(panel, trigger);
  };

  const scheduleHide = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      if (pinned.current) return;
      const panel = document.getElementById(panelId);
      const rootElement = root.current;
      if (!panel || !rootElement || !panel.matches(":popover-open")) return;
      if (rootElement.matches(":hover") || panel.matches(":hover")) return;
      if (rootElement.contains(document.activeElement)) return;
      panel.hidePopover();
    }, 140);
  };

  return (
    <span
      ref={root}
      className={helpPopoverClasses.root}
      onPointerEnter={show}
      onPointerLeave={scheduleHide}
      onKeyDownCapture={(event) => {
        if (event.key === "Escape") closedByEscape.current = true;
      }}
    >
      <button
        type="button"
        className={helpPopoverClasses.trigger}
        aria-controls={panelId}
        aria-expanded="false"
        aria-label={label}
        style={{ anchorName: anchor }}
        onFocus={show}
        onBlur={scheduleHide}
        onClick={() => {
          const panel = document.getElementById(panelId);
          if (!panel) return;
          if (pinned.current && panel.matches(":popover-open")) {
            pinned.current = false;
            panel.hidePopover();
            return;
          }
          pinned.current = true;
          show();
        }}
      >
        <InfoIcon />
      </button>
      <span
        id={panelId}
        popover="auto"
        className={helpPopoverClasses.panel}
        onPointerEnter={show}
        onPointerLeave={scheduleHide}
        style={{ positionAnchor: anchor, positionArea: "block-end span-inline-end", inset: "auto", margin: 0 }}
      >
        {children}
      </span>
    </span>
  );
}
