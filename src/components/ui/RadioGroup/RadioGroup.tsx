import type { ReactNode } from "react";
import { cn } from "@/ui/cn";
import { radioGroupVariants, type RadioGroupVariantProps } from "./radioGroupVariants";

export type RadioOption = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
};

export function RadioGroup({
  legend,
  name,
  value,
  onValueChange,
  options,
  hint,
  layout,
  className,
}: RadioGroupVariantProps & {
  legend: ReactNode;
  name: string;
  value: string;
  onValueChange: (value: string) => void;
  options: readonly RadioOption[];
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={cn(radioGroupVariants({ layout }), className)}>
      <legend>
        <span className="field-caption">{legend}</span>
      </legend>
      <div className="radio-group-options">
        {options.map((option) => (
          <label key={option.value} className="radio-option">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              disabled={option.disabled}
              onChange={() => onValueChange(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
      {hint ? <p className="small muted radio-group-hint">{hint}</p> : null}
    </fieldset>
  );
}
