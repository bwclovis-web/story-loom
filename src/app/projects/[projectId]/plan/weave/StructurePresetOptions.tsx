"use client";

import { Checkbox } from "@/components/ui/Atoms/Checkbox";
import { HelpPopover } from "@/components/ui/HelpPopover";
import { WEAVE } from "@/ui/labels";
import { WEAVE_BEAT_PRESETS, type WeaveBeatPreset } from "@/world/weaveBeatPresets";

/** Featured starters on the Weave library and in-plan add picker. */
export const FEATURED_PRESET_IDS = [
  "save-the-cat",
  "heroines-journey-murdock",
  "heroines-journey-carriger",
  "mystery",
] as const;

export function featuredWeavePresets(): WeaveBeatPreset[] {
  return WEAVE_BEAT_PRESETS.filter((preset) =>
    (FEATURED_PRESET_IDS as readonly string[]).includes(preset.id),
  );
}

export function StructurePresetOptions({
  presets,
  selected,
  onToggle,
}: {
  presets: readonly WeaveBeatPreset[];
  selected: Record<string, boolean>;
  onToggle: (presetId: string, checked: boolean) => void;
}) {
  return (
    <ul className="weave-structure-options">
      {presets.map((preset) => {
        const checked = Boolean(selected[preset.id]);
        return (
          <li key={preset.id}>
            <div className={checked ? "weave-structure-option is-selected" : "weave-structure-option"}>
              <span className="weave-structure-option-check">
                <Checkbox
                  checked={checked}
                  onChange={(event) => onToggle(preset.id, event.target.checked)}
                  aria-label={preset.title}
                />
              </span>
              <span className="weave-structure-option-copy">
                <span className="weave-structure-option-title">
                  <strong>{preset.title}</strong>
                  <span className="small muted"> · {WEAVE.beatsCount(preset.beats.length)}</span>
                </span>
                <span className="small muted weave-structure-option-desc">{preset.description}</span>
              </span>
              <span className="weave-structure-option-info">
                <HelpPopover label={`About ${preset.title}`}>
                  {preset.attribution ? `${preset.attribution}. ` : null}
                  {preset.description}
                  {preset.sourceUrl ? (
                    <>
                      {" "}
                      <a href={preset.sourceUrl} target="_blank" rel="noreferrer">
                        {WEAVE.presetSource}
                      </a>
                    </>
                  ) : null}
                </HelpPopover>
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
