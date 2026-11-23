"use client";

import { Button } from "@/components/ui/Atoms/Button";
import {
  isWorldProfileGlossedLines,
  parseGlossedLinesText,
  type WorldProfileFieldValue,
  type WorldProfileGlossedLine,
} from "@/domain/worldProfile";
import { WORLD_PROFILE } from "@/ui/labels";
import type { WorldProfileGlossedConfig } from "@/world/worldProfileRegistry";

function glossedRows(value: WorldProfileFieldValue): WorldProfileGlossedLine[] {
  if (isWorldProfileGlossedLines(value)) {
    return value.map((item) => ({
      line: item.line,
      gloss: item.gloss,
      ...(item.recordId ? { recordId: item.recordId } : {}),
    }));
  }
  if (typeof value === "string" && value.trim()) return parseGlossedLinesText(value);
  return [];
}

function rowWith(row: WorldProfileGlossedLine, partial: Partial<WorldProfileGlossedLine>): WorldProfileGlossedLine {
  const next: WorldProfileGlossedLine = {
    line: partial.line ?? row.line,
    gloss: partial.gloss ?? row.gloss,
  };
  const recordId = (partial.recordId ?? row.recordId)?.trim() ?? "";
  if (recordId) next.recordId = recordId;
  return next;
}

export function GlossedLinesEditor({
  value,
  disabled,
  onChange,
  config,
}: {
  value: WorldProfileFieldValue;
  disabled: boolean;
  onChange: (next: WorldProfileFieldValue) => void;
  config?: WorldProfileGlossedConfig;
}) {
  const rows = glossedRows(value);
  const lineLabel = config?.lineLabel ?? WORLD_PROFILE.exampleLine;
  const glossLabel = config?.glossLabel ?? WORLD_PROFILE.exampleGloss;
  const addLabel = config?.addLabel ?? WORLD_PROFILE.addExampleLine;
  const removeLabel = config?.removeLabel ?? WORLD_PROFILE.removeExampleLine;
  const moveUpLabel = config?.moveUpLabel ?? WORLD_PROFILE.moveExampleUp;
  const moveDownLabel = config?.moveDownLabel ?? WORLD_PROFILE.moveExampleDown;
  const write = (next: WorldProfileGlossedLine[]) => {
    onChange(next.length ? next : null);
  };
  const update = (index: number, partial: Partial<WorldProfileGlossedLine>) => {
    write(rows.map((row, i) => (i === index ? rowWith(row, partial) : row)));
  };
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item!);
    write(next);
  };

  return (
    <div className="stack" style={{ gap: "0.5rem" }}>
      {rows.map((row, index) => (
        <div key={index} className="stack" style={{ gap: "0.35rem" }}>
          <label className="small">
            {lineLabel}
            <input
              type="text"
              value={row.line}
              disabled={disabled}
              onChange={(event) => update(index, { line: event.target.value })}
            />
          </label>
          <label className="small">
            {glossLabel}
            <input
              type="text"
              value={row.gloss}
              disabled={disabled}
              onChange={(event) => update(index, { gloss: event.target.value })}
            />
          </label>
          {config?.recordLabel ? (
            <label className="small">
              {config.recordLabel}
              <input
                type="text"
                value={row.recordId ?? ""}
                disabled={disabled}
                placeholder="rec_..."
                onChange={(event) => update(index, { recordId: event.target.value })}
              />
            </label>
          ) : null}
          <div className="row" style={{ flexWrap: "wrap", gap: "0.35rem" }}>
            <Button type="button" variant="secondary" size="sm" disabled={disabled || index === 0} onClick={() => move(index, -1)}>
              {moveUpLabel}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={disabled || index === rows.length - 1}
              onClick={() => move(index, 1)}
            >
              {moveDownLabel}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={disabled}
              onClick={() => write(rows.filter((_, i) => i !== index))}
            >
              {removeLabel}
            </Button>
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={disabled}
        onClick={() => write([...rows, { line: "", gloss: "" }])}
      >
        {addLabel}
      </Button>
    </div>
  );
}
