/**
 * Map geometry is stored as fractions of the image (0–1), same as pin anchors.
 * A route is an ordered path. An area is a closed boundary: the last point
 * joins the first, and that closing point is not stored twice. A label is
 * text at one point. Nothing here measures length, distance, or travel time.
 */

export const MARKER_KINDS = ["point", "route", "area", "label"] as const;

export type MarkerKind = (typeof MARKER_KINDS)[number];

export const MAX_SHAPE_POINTS = 64;

export interface NormPoint {
  x: number;
  y: number;
}

export function isMarkerKind(value: unknown): value is MarkerKind {
  return typeof value === "string" && (MARKER_KINDS as readonly string[]).includes(value);
}

export function clampNorm(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

/** CSS position. Independent of the image's pixel size. */
export function layoutPercent(point: NormPoint): { left: string; top: string } {
  return { left: `${clampNorm(point.x) * 100}%`, top: `${clampNorm(point.y) * 100}%` };
}

/**
 * Where a stored fraction lands on the image's current pixel size.
 * The stored point is unchanged when width or height changes.
 */
export function pixelOnImage(point: NormPoint, width: number, height: number): { x: number; y: number } {
  return { x: clampNorm(point.x) * width, y: clampNorm(point.y) * height };
}

export function parseStoredPoints(raw: string | null | undefined): NormPoint[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const points: NormPoint[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const x = (item as { x?: unknown }).x;
      const y = (item as { y?: unknown }).y;
      if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      points.push({ x: clampNorm(x), y: clampNorm(y) });
    }
    return points;
  } catch {
    return [];
  }
}

export function serializePoints(points: readonly NormPoint[]): string {
  return JSON.stringify(points.map((point) => ({ x: point.x, y: point.y })));
}

export function normalizeShape(
  kind: MarkerKind,
  raw: readonly { x: number; y: number }[] | null | undefined,
): { ok: true; points: NormPoint[] } | { ok: false; message: string } {
  if (!Array.isArray(raw)) return { ok: false, message: "That shape has no points." };
  if (raw.length > MAX_SHAPE_POINTS) {
    return { ok: false, message: `A shape can have at most ${MAX_SHAPE_POINTS} points.` };
  }
  const points: NormPoint[] = [];
  for (const point of raw) {
    if (!point || typeof point.x !== "number" || typeof point.y !== "number" || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return { ok: false, message: "Each point needs a position on the image." };
    }
    points.push({ x: clampNorm(point.x), y: clampNorm(point.y) });
  }
  if (kind === "area" && points.length >= 2) {
    const first = points[0]!;
    const last = points[points.length - 1]!;
    if (first.x === last.x && first.y === last.y) points.pop();
  }
  if (kind === "point" || kind === "label") {
    if (points.length !== 1) {
      return {
        ok: false,
        message: kind === "label" ? "A label needs one position on the image." : "A point marker needs one position.",
      };
    }
  } else if (kind === "route") {
    if (points.length < 2) return { ok: false, message: "A route needs at least two points, in order." };
  } else if (points.length < 3) {
    return { ok: false, message: "An area needs at least three corners. The boundary closes back to the first." };
  }
  return { ok: true, points };
}

export interface ShapeDraft {
  kind: "route" | "area" | "label";
  points: NormPoint[];
  /** Points last saved on the marker. Null while drawing a new shape. */
  committed: NormPoint[] | null;
  pinId: string | null;
}

export function startShape(kind: ShapeDraft["kind"]): ShapeDraft {
  return { kind, points: [], committed: null, pinId: null };
}

export function editShape(kind: ShapeDraft["kind"], pinId: string, points: readonly NormPoint[]): ShapeDraft {
  const copy = points.map((point) => ({ x: point.x, y: point.y }));
  return { kind, points: copy, committed: copy.map((point) => ({ x: point.x, y: point.y })), pinId };
}

export function addShapePoint(draft: ShapeDraft, point: NormPoint): ShapeDraft {
  const next = { x: clampNorm(point.x), y: clampNorm(point.y) };
  if (draft.kind === "label") return { ...draft, points: [next] };
  if (draft.points.length >= MAX_SHAPE_POINTS) return draft;
  return { ...draft, points: [...draft.points, next] };
}

export function undoShapePoint(draft: ShapeDraft): ShapeDraft {
  return { ...draft, points: draft.points.slice(0, -1) };
}

export function replaceShapePoint(draft: ShapeDraft, index: number, point: NormPoint): ShapeDraft {
  if (index < 0 || index >= draft.points.length) return draft;
  const points = draft.points.map((item, itemIndex) =>
    itemIndex === index ? { x: clampNorm(point.x), y: clampNorm(point.y) } : item,
  );
  return { ...draft, points };
}

export function removeShapePoint(draft: ShapeDraft, index: number): ShapeDraft {
  if (index < 0 || index >= draft.points.length) return draft;
  return { ...draft, points: draft.points.filter((_, itemIndex) => itemIndex !== index) };
}

export function reorderShapePoint(draft: ShapeDraft, index: number, direction: -1 | 1): ShapeDraft {
  const target = index + direction;
  if (index < 0 || target < 0 || index >= draft.points.length || target >= draft.points.length) return draft;
  const points = draft.points.map((point) => ({ x: point.x, y: point.y }));
  const current = points[index]!;
  points[index] = points[target]!;
  points[target] = current;
  return { ...draft, points };
}

/** Drops the unsaved draft. Does not write. Editing an existing shape restores its saved points. */
export function cancelShape(draft: ShapeDraft): { wrote: false; restored: NormPoint[] | null } {
  return {
    wrote: false,
    restored: draft.committed ? draft.committed.map((point) => ({ x: point.x, y: point.y })) : null,
  };
}

export function shapeReady(draft: ShapeDraft): boolean {
  return normalizeShape(draft.kind, draft.points).ok;
}
