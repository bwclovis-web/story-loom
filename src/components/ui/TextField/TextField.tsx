import { useId, type InputHTMLAttributes, type PointerEventHandler, type ReactNode, type Ref } from "react";
import { cn } from "@/ui/cn";
import { textFieldVariants, type TextFieldVariantProps } from "./textFieldVariants";

export type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className" | "onPointerDown"> &
  TextFieldVariantProps & {
    label: ReactNode;
    hint?: string;
    className?: string;
    id?: string;
    ref?: Ref<HTMLInputElement>;
    onPointerDown?: PointerEventHandler<HTMLLabelElement>;
  };

/** Labeled text control. The class `sl-field` owns the border and focus ring. */
export function TextField({
  label,
  labelPosition = "top",
  hint,
  className,
  id,
  ref,
  onPointerDown,
  disabled,
  ...props
}: TextFieldProps) {
  const autoId = useId();
  const controlId = id ?? autoId;
  const hintId = hint ? `${controlId}-hint` : undefined;

  return (
    <label className={cn(textFieldVariants({ labelPosition }), className)} onPointerDown={onPointerDown}>
      <span className="sl-text-field-label">{label}</span>
      <input
        {...props}
        ref={ref}
        id={controlId}
        className="sl-field"
        disabled={disabled}
        aria-describedby={hintId}
      />
      {hint ? (
        <span className="sl-text-field-hint" id={hintId}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}
