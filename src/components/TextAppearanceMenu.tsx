"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ALargeSmall } from "lucide-react";
import { writePreference } from "@/components/shell/preferences";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { TEXT_APPEARANCE } from "@/ui/labels";
import {
  DEFAULT_TEXT_APPEARANCE,
  fontStack,
  parseTextAppearance,
  TEXT_COOKIE,
  TEXT_FONTS,
  TEXT_SIZES,
  TEXT_SPACINGS,
  TEXT_WIDTHS,
  textAppearanceVars,
  type TextAppearance,
} from "@/ui/textAppearance";

function readCookie(): TextAppearance {
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${TEXT_COOKIE}=([^;]*)`));
  return parseTextAppearance(m ? decodeURIComponent(m[1]) : undefined);
}

/** Font, size, spacing and width. `toolbar` is the labeled manuscript control; `icon` is the Aa button elsewhere. */
export function TextAppearanceMenu({
  align = "right",
  presentation = "icon",
}: {
  align?: "left" | "right";
  presentation?: "icon" | "toolbar";
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pref, setPref] = useState<TextAppearance>(DEFAULT_TEXT_APPEARANCE);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    setPref(readCookie());
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
      (buttonRef.current ?? wrapRef.current?.querySelector("button"))?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const update = (patch: Partial<TextAppearance>) => {
    const next = { ...pref, ...patch };
    setPref(next);
    for (const [name, value] of Object.entries(textAppearanceVars(next))) document.documentElement.style.setProperty(name, value);
    writePreference(TEXT_COOKIE, JSON.stringify(next));
  };

  const choice = <K extends keyof TextAppearance>(key: K, label: string, options: readonly { id: string; label: string }[]) => (
    <label>
      {label}
      <select value={pref[key]} onChange={(e) => update({ [key]: e.target.value } as Partial<TextAppearance>)}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="menu-wrap" ref={wrapRef}>
      {presentation === "toolbar" ? (
        <Button
          type="button"
          variant="toolbar"
          size="toolbar"
          className="tool-labeled"
          aria-label={TEXT_APPEARANCE.toolbar}
          aria-expanded={open}
          aria-controls={id}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((o) => !o)}
          icon={<ALargeSmall strokeWidth={1.75} />}
        >
          {TEXT_APPEARANCE.toolbar}
        </Button>
      ) : (
        <IconButton
          ref={buttonRef}
          tip="end"
          aria-label={TEXT_APPEARANCE.button}
          aria-expanded={open}
          aria-controls={id}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((o) => !o)}
        >
          <span aria-hidden="true" className="aa-icon">
            Aa
          </span>
        </IconButton>
      )}
      <div id={id} className={`tool-menu text-appearance ${align}`} role="group" aria-label={TEXT_APPEARANCE.heading} hidden={!open}>
        <strong>{TEXT_APPEARANCE.heading}</strong>
        {choice("font", TEXT_APPEARANCE.font, TEXT_FONTS)}
        {choice("size", TEXT_APPEARANCE.size, TEXT_SIZES)}
        {choice("spacing", TEXT_APPEARANCE.spacing, TEXT_SPACINGS)}
        {choice("width", TEXT_APPEARANCE.width, TEXT_WIDTHS)}
        <p className="text-sample" style={{ fontFamily: fontStack(pref.font) }}>
          {TEXT_APPEARANCE.sample}
        </p>
        <Button type="button" variant="secondary" size="sm" onClick={() => update(DEFAULT_TEXT_APPEARANCE)}>
          {TEXT_APPEARANCE.reset}
        </Button>
        <p className="small muted">{TEXT_APPEARANCE.note}</p>
      </div>
    </div>
  );
}
