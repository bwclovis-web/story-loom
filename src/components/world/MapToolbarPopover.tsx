"use client";

import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import { cn } from "@/ui/cn";

type PanelAlign = "start" | "end";

/** Toolbar popover for map layers, markers, etc. Panel is portaled so it is not clipped by the canvas. */
export function MapToolbarPopover({
  label,
  className,
  bodyClassName,
  align = "start",
  children,
}: {
  label: string;
  className?: string;
  bodyClassName?: string;
  align?: PanelAlign;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => setMounted(true), []);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const margin = 6;
    const maxHeight = Math.min(window.innerHeight * 0.55, 416);
    const maxWidth = Math.min(352, window.innerWidth - 16);
    if (align === "end") {
      const right = Math.max(8, window.innerWidth - rect.right);
      setPanelStyle({
        position: "fixed",
        top: rect.bottom + margin,
        right,
        left: "auto",
        maxWidth,
        maxHeight,
      });
      return;
    }
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - maxWidth - 8);
    setPanelStyle({
      position: "fixed",
      top: rect.bottom + margin,
      left,
      right: "auto",
      maxWidth,
      maxHeight,
    });
  }, [align]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const panel =
    open && mounted ? (
      <div
        ref={panelRef}
        id={panelId}
        className={cn("map-toolbar-popover-body", bodyClassName)}
        style={panelStyle}
        role="dialog"
        aria-label={label}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
          }
        }}
      >
        {children}
      </div>
    ) : null;

  return (
    <div className={cn("map-toolbar-popover", open && "is-open", className)} ref={triggerRef}>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="map-toolbar-popover-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <span>{label}</span>
        <ChevronDown className="map-toolbar-popover-chevron" strokeWidth={2} aria-hidden="true" />
      </Button>
      {mounted && panel ? createPortal(panel, document.body) : null}
    </div>
  );
}