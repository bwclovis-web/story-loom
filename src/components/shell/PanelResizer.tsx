"use client";

import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { useLayout } from "./LayoutContext";
import { clampWidth, CONTEXT_WIDTH, SECONDARY_WIDTH } from "./preferences";

const STEP = 16;
const BIG_STEP = 64;

/**
 * A focusable vertical separator that resizes the panel beside it. Drag it,
 * or focus it and use the arrow keys (Shift for bigger steps), Home and End.
 * The width is saved in this browser when the drag or key press ends.
 */
export function PanelResizer({
  panel,
  controls,
  label,
}: {
  /** Which width it changes: the manuscript/project column on the left, or the context panel on the right. */
  panel: "secondaryWidth" | "contextWidth";
  controls: string;
  label: string;
}) {
  const { layout, updateLayout, previewWidth } = useLayout();
  const limits = panel === "secondaryWidth" ? SECONDARY_WIDTH : CONTEXT_WIDTH;
  // Dragging right widens a left panel and narrows a right one.
  const direction = panel === "secondaryWidth" ? 1 : -1;
  const drag = useRef<{ startX: number; startWidth: number; width: number } | null>(null);
  const value = layout[panel];

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: value, width: value };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    d.width = clampWidth(d.startWidth + (event.clientX - d.startX) * direction, limits);
    previewWidth(panel, d.width);
  };
  const endDrag = () => {
    const d = drag.current;
    drag.current = null;
    if (d && d.width !== value) updateLayout({ [panel]: d.width });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? BIG_STEP : STEP;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = value + step * direction;
    else if (event.key === "ArrowLeft") next = value - step * direction;
    else if (event.key === "Home") next = limits.min;
    else if (event.key === "End") next = limits.max;
    if (next === null) return;
    event.preventDefault();
    updateLayout({ [panel]: clampWidth(next, limits) });
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-controls={controls}
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      aria-valuenow={value}
      aria-valuetext={`${value} pixels`}
      tabIndex={0}
      className={`panel-resizer ${panel === "secondaryWidth" ? "resizer-left" : "resizer-right"}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onKeyDown={onKeyDown}
    />
  );
}
