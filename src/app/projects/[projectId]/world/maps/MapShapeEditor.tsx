"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { WORLD } from "@/ui/labels";
import {
  addShapePoint,
  removeShapePoint,
  reorderShapePoint,
  replaceShapePoint,
  shapeReady,
  undoShapePoint,
  type ShapeDraft,
} from "@/world/mapGeometry";

const HINT = {
  route: WORLD.drawRouteHint,
  area: WORLD.drawAreaHint,
  label: WORLD.drawLabelHint,
} as const;

/** Vertex list for a route, area, or label. Shown only while that shape is being drawn or edited. */
export function MapShapeEditor({
  draft,
  pending,
  onChange,
  onCancel,
  onSave,
  onDelete,
  saveLabel = WORLD.drawSave,
}: {
  draft: ShapeDraft;
  pending: boolean;
  onChange: (draft: ShapeDraft) => void;
  onCancel: () => void;
  onSave: () => void;
  onDelete: (() => void) | null;
  saveLabel?: string;
}) {
  const [xPercent, setXPercent] = useState("50");
  const [yPercent, setYPercent] = useState("50");
  const ready = shapeReady(draft);

  return (
    <fieldset className="map-shape-editor">
      <legend className="sr-only">{HINT[draft.kind]}</legend>
      <p className="small muted">{WORLD.geometryNote}</p>
      <form
          className="row"
          style={{ gap: "0.35rem", flexWrap: "wrap" }}
          onSubmit={(event) => {
            event.preventDefault();
            const x = Number(xPercent);
            const y = Number(yPercent);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return;
            onChange(addShapePoint(draft, { x: x / 100, y: y / 100 }));
          }}
        >
          <label>
            {WORLD.drawPointX}
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={xPercent}
              onChange={(event) => setXPercent(event.target.value)}
            />
          </label>
          <label>
            {WORLD.drawPointY}
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={yPercent}
              onChange={(event) => setYPercent(event.target.value)}
            />
          </label>
          <Button type="submit" size="sm" variant="secondary">
            {WORLD.drawAddPoint}
          </Button>
        </form>
      <ol>
        {draft.points.map((point, index) => (
          <li key={index}>
            <span className="small">
              {index + 1}
            </span>
            <label>
              <span className="sr-only">
                {WORLD.drawPointX} {index + 1}
              </span>
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                aria-label={`${WORLD.drawPointX} ${index + 1}`}
                value={Math.round(point.x * 1000) / 10}
                onChange={(event) => {
                  const x = Number(event.target.value);
                  if (!Number.isFinite(x)) return;
                  onChange(replaceShapePoint(draft, index, { x: x / 100, y: point.y }));
                }}
              />
            </label>
            <label>
              <span className="sr-only">
                {WORLD.drawPointY} {index + 1}
              </span>
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                aria-label={`${WORLD.drawPointY} ${index + 1}`}
                value={Math.round(point.y * 1000) / 10}
                onChange={(event) => {
                  const y = Number(event.target.value);
                  if (!Number.isFinite(y)) return;
                  onChange(replaceShapePoint(draft, index, { x: point.x, y: y / 100 }));
                }}
              />
            </label>
            {draft.kind !== "label" ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={index === 0}
                  onClick={() => onChange(reorderShapePoint(draft, index, -1))}
                >
                  {WORLD.drawMoveEarlier}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={index === draft.points.length - 1}
                  onClick={() => onChange(reorderShapePoint(draft, index, 1))}
                >
                  {WORLD.drawMoveLater}
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => onChange(removeShapePoint(draft, index))}>
                  {WORLD.drawRemovePoint}
                </Button>
              </>
            ) : null}
          </li>
        ))}
      </ol>
      <div className="row" style={{ gap: "0.35rem", flexWrap: "wrap" }}>
        <Button type="button" size="sm" variant="secondary" disabled={draft.points.length === 0} onClick={() => onChange(undoShapePoint(draft))}>
          {WORLD.drawUndo}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onCancel}>
          {WORLD.drawCancel}
        </Button>
        <Button type="button" size="sm" disabled={pending || !ready} onClick={onSave}>
          {saveLabel}
        </Button>
        {onDelete ? (
          <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={onDelete}>
            {WORLD.deleteShape}
          </Button>
        ) : null}
      </div>
    </fieldset>
  );
}
