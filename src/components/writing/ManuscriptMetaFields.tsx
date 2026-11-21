"use client";

import { useMemo } from "react";
import { SCENE_META } from "@/ui/labels";
import {
  MANUSCRIPT_SCENE_STATUSES,
  readManuscriptMeta,
  withManuscriptMeta,
  type ManuscriptMeta,
  type ManuscriptSceneStatus,
} from "@/writing/manuscriptStructure";

const STATUS_LABEL: Record<ManuscriptSceneStatus, string> = {
  outline: SCENE_META.outline,
  rough: SCENE_META.rough,
  revised: SCENE_META.revised,
  final: SCENE_META.final,
};

function parseFields(value: string): Record<string, unknown> | null {
  try {
    const raw = value.trim() ? JSON.parse(value) : {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    return raw as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Point of view, draft status, and story-date note, kept in the fields JSON. */
export function ManuscriptMetaFields({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const parsed = useMemo(() => parseFields(value), [value]);
  const meta = parsed ? readManuscriptMeta(parsed) : { pov: "", sceneStatus: "" as const, storyDateNote: "" };

  function patch(partial: Partial<ManuscriptMeta>) {
    if (!parsed) return;
    onChange(JSON.stringify(withManuscriptMeta(parsed, partial), null, 2));
  }

  return (
    <div className="scene-meta">
      <label>
        {SCENE_META.pov}
        <input value={meta.pov} disabled={!parsed} onChange={(event) => patch({ pov: event.target.value })} />
      </label>
      <label>
        {SCENE_META.status}
        <select
          value={meta.sceneStatus}
          disabled={!parsed}
          onChange={(event) => patch({ sceneStatus: event.target.value as ManuscriptMeta["sceneStatus"] })}
        >
          <option value="">{SCENE_META.statusNone}</option>
          {MANUSCRIPT_SCENE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABEL[status]}
            </option>
          ))}
        </select>
      </label>
      <label>
        {SCENE_META.storyDate}
        <input
          value={meta.storyDateNote}
          disabled={!parsed}
          onChange={(event) => patch({ storyDateNote: event.target.value })}
        />
      </label>
      {parsed ? null : <p className="small error-text">{SCENE_META.invalidJson}</p>}
      <label>
        {SCENE_META.fieldsJson}
        <textarea
          name="fields"
          aria-label={SCENE_META.fieldsJson}
          className="mono"
          value={value}
          style={{ minHeight: "6rem" }}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    </div>
  );
}
