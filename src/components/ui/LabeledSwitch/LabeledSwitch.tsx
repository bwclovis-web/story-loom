"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/ui/cn";
import { labeledSwitchVariants, type LabeledSwitchVariantProps } from "./labeledSwitchVariants";

export function LabeledSwitch({
  label,
  labelPosition = "left",
  checked,
  onCheckedChange,
  disabled,
  hint,
  className,
  id,
}: LabeledSwitchVariantProps & {
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

  return (
    <label className={cn(labeledSwitchVariants({ labelPosition }), className)} title={hint}>
      <span className="labeled-switch-label">{label}</span>
      <input
        type="checkbox"
        role="switch"
        id={controlId}
        className="labeled-switch-input"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onCheckedChange(event.target.checked)}
      />
    </label>
  );
}
