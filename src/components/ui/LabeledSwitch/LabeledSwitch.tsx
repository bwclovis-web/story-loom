"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/ui/cn";

export function LabeledSwitch({
  label,
  checked,
  onCheckedChange,
  disabled,
  hint,
  className,
  id,
}: {
  label: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  hint?: string;
  className?: string;
  id?: string;
}) {
  const autoId = useId();
  const controlId = id ?? autoId;
  const labelId = `${controlId}-label`;

  return (
    <span className={cn("labeled-switch", className)} title={hint}>
      <span id={labelId} className="labeled-switch-label">
        {label}
      </span>
      <button
        type="button"
        role="switch"
        id={controlId}
        className={cn("labeled-switch-control", checked && "is-on")}
        aria-labelledby={labelId}
        aria-checked={checked}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onCheckedChange(!checked)}
      />
    </span>
  );
}