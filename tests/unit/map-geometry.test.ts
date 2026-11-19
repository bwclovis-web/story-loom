import { describe, expect, it } from "vitest";
import {
  addShapePoint,
  cancelShape,
  editShape,
  layoutPercent,
  normalizeShape,
  pixelOnImage,
  startShape,
  undoShapePoint,
} from "@/world/mapGeometry";

describe("map geometry", () => {
  it("keeps a route in the order points were added", () => {
    const shape = normalizeShape("route", [
      { x: 0.1, y: 0.2 },
      { x: 0.4, y: 0.8 },
      { x: 0.9, y: 0.3 },
    ]);
    expect(shape.ok).toBe(true);
    if (!shape.ok) return;
    expect(shape.points.map((point) => point.x)).toEqual([0.1, 0.4, 0.9]);
    expect(shape).not.toHaveProperty("distance");
    expect(shape).not.toHaveProperty("travelTime");
  });

  it("closes an area without storing the first point twice", () => {
    const shape = normalizeShape("area", [
      { x: 0.2, y: 0.2 },
      { x: 0.6, y: 0.2 },
      { x: 0.4, y: 0.7 },
      { x: 0.2, y: 0.2 },
    ]);
    expect(shape.ok).toBe(true);
    if (!shape.ok) return;
    expect(shape.points).toHaveLength(3);
    expect(shape.points[0]).toEqual({ x: 0.2, y: 0.2 });
    expect(normalizeShape("area", [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }]).ok).toBe(false);
    expect(normalizeShape("route", [{ x: 0.1, y: 0.1 }]).ok).toBe(false);
  });

  it("undoes and cancels a drawing without writing", () => {
    const started = addShapePoint(addShapePoint(startShape("route"), { x: 0.2, y: 0.3 }), { x: 0.5, y: 0.6 });
    const undone = undoShapePoint(started);
    expect(undone.points).toEqual([{ x: 0.2, y: 0.3 }]);
    const editing = editShape("area", "wpn_quay", [
      { x: 0.1, y: 0.1 },
      { x: 0.4, y: 0.1 },
      { x: 0.4, y: 0.4 },
    ]);
    const changed = addShapePoint(editing, { x: 0.1, y: 0.4 });
    const canceled = cancelShape(changed);
    expect(canceled.wrote).toBe(false);
    expect(canceled.restored).toEqual(editing.committed);
    expect(editing.committed).toHaveLength(3);
  });

  it("keeps the same fractions when the image pixel size changes", () => {
    const point = { x: 0.25, y: 0.5 };
    expect(layoutPercent(point)).toEqual({ left: "25%", top: "50%" });
    expect(pixelOnImage(point, 40, 20)).toEqual({ x: 10, y: 10 });
    expect(pixelOnImage(point, 400, 80)).toEqual({ x: 100, y: 40 });
    expect(point).toEqual({ x: 0.25, y: 0.5 });
  });
});
