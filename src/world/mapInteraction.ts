/**
 * Map pointer and drawing decisions. Geometry stays in fractions of the image.
 * Finishing a drawing opens the form. Only an explicit save writes it.
 */

import {
  addShapePoint,
  cancelShape,
  normalizeShape,
  startShape,
  type NormPoint,
  type ShapeDraft,
} from "@/world/mapGeometry";
import { clampMapPan, type MapViewState } from "@/world/mapMarkers";

export const MAP_TOOLS = ["select", "point", "route", "area", "label"] as const;

export type MapTool = (typeof MAP_TOOLS)[number];

export type MapMode = "browse" | "edit";

export type DrawPhase = "drawing" | "review";

/** Pointer movement below this does not count as a drag. */
export const DRAG_THRESHOLD_PX = 5;

export interface DrawSession {
  draft: ShapeDraft;
  phase: DrawPhase;
}

/** Edit always starts on Select. A drawing tool is not restored from another map or session. */
export function toolOnEnterEdit(): MapTool {
  return "select";
}

export function sessionForTool(tool: MapTool): DrawSession | null {
  if (tool === "route" || tool === "area" || tool === "label") {
    return { draft: startShape(tool), phase: "drawing" };
  }
  return null;
}

/** One pin, then Select, unless the author explicitly keeps placing pins. */
export function nextToolAfterPin(keepPlacing: boolean): MapTool {
  return keepPlacing ? "point" : "select";
}

export function dragExceeded(dx: number, dy: number, threshold = DRAG_THRESHOLD_PX): boolean {
  return dx * dx + dy * dy >= threshold * threshold;
}

export type MapGesture = "select" | "pan" | "move" | "draw" | "ignore";

/**
 * Browse can select and pan. It cannot move a marker.
 * A short press selects. A drag moves only in Edit with Select active.
 */
export function gestureForPointer(input: {
  mode: MapMode;
  tool: MapTool;
  phase: DrawPhase | null;
  onMarker: boolean;
  exceeded: boolean;
}): MapGesture {
  if (input.mode === "browse") return input.onMarker ? "select" : "pan";
  if (input.onMarker) {
    if (input.tool === "select" && input.exceeded) return "move";
    return "select";
  }
  const drawing =
    input.tool === "point" ||
    ((input.tool === "route" || input.tool === "area" || input.tool === "label") && input.phase === "drawing");
  if (drawing) return input.exceeded ? "ignore" : "draw";
  if (input.tool === "select") return "pan";
  return "ignore";
}

/** Adds a vertex while drawing. A label's first point moves the draft to review. Review clicks do not add vertices. */
export function appendDraftPoint(draft: ShapeDraft, phase: DrawPhase, point: NormPoint): DrawSession {
  if (phase !== "drawing") return { draft, phase };
  const next = addShapePoint(draft, point);
  if (draft.kind === "label" && next.points.length === 1) return { draft: next, phase: "review" };
  return { draft: next, phase: "drawing" };
}

/** Enter finishes a valid drawing. It does not write. */
export function finishDrawing(draft: ShapeDraft): { persist: false; ok: true } | { persist: false; ok: false; message: string } {
  const normalized = normalizeShape(draft.kind, draft.points);
  if (!normalized.ok) return { persist: false, ok: false, message: normalized.message };
  return { persist: false, ok: true };
}

/** Escape drops the unsaved drawing. Saved points come back. Nothing is written. */
export function cancelDrawing(draft: ShapeDraft): { wrote: false; restored: NormPoint[] | null } {
  return cancelShape(draft);
}

/** A refused save keeps the draft the author was editing. */
export function keepDraftAfterFailure<T>(draft: T): T {
  return draft;
}

export type LayerNotice =
  | { kind: "empty"; visible: number; total: number }
  | { kind: "hidden"; visible: number; total: number }
  | { kind: "no-match"; visible: number; total: number }
  | { kind: "shown"; visible: number; total: number };

export function layerNotice(input: {
  total: number;
  visible: number;
  listed: number;
  searching: boolean;
}): LayerNotice {
  const counts = { visible: input.visible, total: input.total };
  if (input.total === 0) return { kind: "empty", ...counts };
  if (input.visible === 0) return { kind: "hidden", ...counts };
  if (input.searching && input.listed === 0) return { kind: "no-match", ...counts };
  return { kind: "shown", ...counts };
}

export function fitMapView(): MapViewState {
  return { zoom: 1, x: 0, y: 0 };
}

/** Shift the current pan so a point already on screen moves by delta pixels. Zoom stays. */
export function centerPointPan(view: MapViewState, deltaX: number, deltaY: number): MapViewState {
  return {
    zoom: view.zoom,
    x: clampMapPan(view.x + deltaX),
    y: clampMapPan(view.y + deltaY),
  };
}
