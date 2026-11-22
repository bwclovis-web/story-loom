"use client";

import type { PromptPresetView } from "@/server/services/promptPresetService";
import { PROMPT_PRESETS } from "@/ui/labels";

export function PromptPresetSelect({
  id,
  presets,
  presetId,
  onPresetIdChange,
  instructionLens,
  onInstructionLensChange,
  disabled,
  showLensField = true,
}: {
  id: string;
  presets: PromptPresetView[];
  presetId: string;
  onPresetIdChange: (id: string) => void;
  instructionLens: string;
  onInstructionLensChange: (value: string) => void;
  disabled?: boolean;
  showLensField?: boolean;
}) {
  return (
    <div className="stack" style={{ gap: "0.5rem" }}>
      <label htmlFor={`${id}-preset`} className="small">
        {PROMPT_PRESETS.presetLabel}
      </label>
      <select
        id={`${id}-preset`}
        value={presetId}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value;
          onPresetIdChange(next);
          const preset = presets.find((p) => p.id === next);
          if (preset) onInstructionLensChange(preset.instructionText);
        }}
      >
        <option value="">{PROMPT_PRESETS.none}</option>
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
          </option>
        ))}
      </select>
      {showLensField ? (
        <label className="stack" style={{ gap: "0.25rem" }}>
          <span className="small">{PROMPT_PRESETS.lensLabel}</span>
          <textarea
            value={instructionLens}
            disabled={disabled}
            rows={3}
            maxLength={4000}
            placeholder={PROMPT_PRESETS.lensPlaceholder}
            onChange={(e) => onInstructionLensChange(e.target.value)}
          />
          <span className="small muted">{PROMPT_PRESETS.lensHint}</span>
        </label>
      ) : null}
    </div>
  );
}