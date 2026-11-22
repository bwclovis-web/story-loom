import { describe, expect, it } from "vitest";
import { editShape, startShape } from "@/world/mapGeometry";
import {
  appendDraftPoint,
  cancelDrawing,
  centerPointPan,
  dragExceeded,
  finishDrawing,
  fitMapView,
  gestureForPointer,
  keepDraftAfterFailure,
  layerNotice,
  nextToolAfterPin,
  sessionForTool,
  toolOnEnterEdit,
} from "@/world/mapInteraction";

describe("map interaction", () => {
  it("keeps browse from moving a marker and starts edit on Select", () => {
    expect(toolOnEnterEdit()).toBe("select");
    expect(sessionForTool("route")?.phase).toBe("drawing");
    expect(sessionForTool("select")).toBeNull();
    expect(
      gestureForPointer({ mode: "browse", tool: "select", phase: null, onMarker: true, exceeded: true }),
    ).toBe("select");
    expect(
      gestureForPointer({ mode: "browse", tool: "point", phase: null, onMarker: false, exceeded: true }),
    ).toBe("pan");
    expect(
      gestureForPointer({ mode: "edit", tool: "select", phase: null, onMarker: true, exceeded: false }),
    ).toBe("select");
    expect(
      gestureForPointer({ mode: "edit", tool: "select", phase: null, onMarker: true, exceeded: true }),
    ).toBe("move");
  });

  it("places one pin unless the author keeps placing, and a drag below the threshold does not move", () => {
    expect(nextToolAfterPin(false)).toBe("select");
    expect(nextToolAfterPin(true)).toBe("point");
    expect(dragExceeded(2, 2)).toBe(false);
    expect(dragExceeded(5, 0)).toBe(true);
    expect(
      gestureForPointer({ mode: "edit", tool: "point", phase: null, onMarker: false, exceeded: true }),
    ).toBe("ignore");
    expect(
      gestureForPointer({ mode: "edit", tool: "route", phase: "review", onMarker: false, exceeded: false }),
    ).toBe("ignore");
  });

  it("finishes a drawing without writing and cancels back to the saved points", () => {
    const first = appendDraftPoint(startShape("route"), "drawing", { x: 0.1, y: 0.2 });
    const drawing = appendDraftPoint(first.draft, "drawing", { x: 0.4, y: 0.5 });
    const finished = finishDrawing(drawing.draft);
    expect(finished).toEqual({ persist: false, ok: true });
    expect(finishDrawing(startShape("route"))).toMatchObject({ persist: false, ok: false });
    const label = appendDraftPoint(startShape("label"), "drawing", { x: 0.2, y: 0.3 });
    expect(label.phase).toBe("review");
    expect(appendDraftPoint(label.draft, "review", { x: 0.9, y: 0.9 }).draft.points).toEqual(label.draft.points);

    const saved = editShape("area", "wpn_quay", [
      { x: 0.1, y: 0.1 },
      { x: 0.4, y: 0.1 },
      { x: 0.2, y: 0.4 },
    ]);
    const canceled = cancelDrawing(appendDraftPoint(saved, "drawing", { x: 0.1, y: 0.4 }).draft);
    expect(canceled.wrote).toBe(false);
    expect(canceled.restored).toEqual(saved.committed);
  });

  it("keeps a draft after a failed save and tells empty, hidden, and unmatched markers apart", () => {
    const started = appendDraftPoint(startShape("route"), "drawing", { x: 0.2, y: 0.2 });
    const draft = appendDraftPoint(started.draft, "drawing", { x: 0.6, y: 0.4 }).draft;
    expect(keepDraftAfterFailure(draft)).toBe(draft);
    expect(keepDraftAfterFailure(draft).points).toHaveLength(2);
    expect(layerNotice({ total: 0, visible: 0, listed: 0, searching: false }).kind).toBe("empty");
    expect(layerNotice({ total: 4, visible: 0, listed: 0, searching: false }).kind).toBe("hidden");
    expect(layerNotice({ total: 4, visible: 2, listed: 0, searching: true }).kind).toBe("no-match");
    expect(layerNotice({ total: 4, visible: 2, listed: 2, searching: false })).toMatchObject({
      kind: "shown",
      visible: 2,
      total: 4,
    });
  });

  it("fits the map and centers a selection without changing the zoom", () => {
    expect(fitMapView()).toEqual({ zoom: 1, x: 0, y: 0 });
    expect(centerPointPan({ zoom: 2, x: 10, y: -4 }, 30, -12)).toEqual({ zoom: 2, x: 40, y: -16 });
  });
});
