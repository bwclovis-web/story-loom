"use client";

import { useRef } from "react";
import { WRITE } from "@/ui/labels";
import { WRITE_MODES, type WriteMode } from "@/writing/writeMode";

const BUTTON_LABEL: Record<WriteMode, string> = {
  desk: WRITE.modeDesk,
  focus: WRITE.modeFocus,
  companion: WRITE.modeCompanion,
};

const CAPTION: Record<WriteMode, string> = {
  desk: WRITE.modeCaptionDesk,
  focus: WRITE.modeCaptionFocus,
  companion: WRITE.modeCaptionCompanion,
};

/** Desk, Focus, and Companion. One control, same place in every layout. */
export function WriteModeSwitch({ mode, onChange }: { mode: WriteMode; onChange: (mode: WriteMode) => void }) {
  const buttons = useRef<Partial<Record<WriteMode, HTMLButtonElement | null>>>({});

  const move = (next: WriteMode) => {
    onChange(next);
    requestAnimationFrame(() => buttons.current[next]?.focus());
  };

  return (
    <div className="write-mode">
      <p className="write-mode-caption">{CAPTION[mode]}</p>
      <div
        role="radiogroup"
        aria-label={WRITE.layoutGroup}
        className="segmented-control write-mode-switch"
        onKeyDown={(e) => {
          if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
          e.preventDefault();
          const index = WRITE_MODES.indexOf(mode);
          const step = e.key === "ArrowRight" ? 1 : -1;
          move(WRITE_MODES[(index + step + WRITE_MODES.length) % WRITE_MODES.length]);
        }}
      >
        {WRITE_MODES.map((item) => (
          <button
            key={item}
            ref={(el) => {
              buttons.current[item] = el;
            }}
            type="button"
            role="radio"
            className={item === mode ? "is-selected" : undefined}
            aria-checked={item === mode}
            tabIndex={item === mode ? 0 : -1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChange(item)}
          >
            {BUTTON_LABEL[item]}
          </button>
        ))}
      </div>
    </div>
  );
}
