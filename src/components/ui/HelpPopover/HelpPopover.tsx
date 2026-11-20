"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { helpPopoverClasses } from "./helpPopoverVariants";

/** Keep the open panel beside its button, including narrow windows. */
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

/**
 * Short explanation beside a label. The button is the accessible name.
 * Click, tap, Enter, or Space opens it. Escape closes it and returns focus
 * to that button. Clicking elsewhere closes it without moving focus.
 * The panel is text only.
 */
export function HelpPopover({ label, children }: { label: string; children: ReactNode }) {
  const panelId = `help-popover-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const anchor = `--${panelId}`;
  const root = useRef<HTMLSpanElement>(null);
  const closedByEscape = useRef(false);

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
        return;
      }
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
    };
  }, [panelId]);

  return (
    <span
      ref={root}
      className={helpPopoverClasses.root}
      onKeyDownCapture={(event) => {
        if (event.key === "Escape") closedByEscape.current = true;
      }}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={helpPopoverClasses.trigger}
        popoverTarget={panelId}
        aria-controls={panelId}
        aria-label={label}
        style={{ anchorName: anchor }}
      >
        Explain
      </Button>
      <div
        id={panelId}
        popover="auto"
        className={helpPopoverClasses.panel}
        style={{ positionAnchor: anchor, positionArea: "block-end span-inline-end", inset: "auto", margin: 0 }}
      >
        {children}
      </div>
    </span>
  );
}
