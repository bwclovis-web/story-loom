import {
  useId,
  type InputHTMLAttributes,
  type PointerEventHandler,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/ui/cn";
import { textFieldVariants, type TextFieldVariantProps } from "./textFieldVariants";

type SharedProps = TextFieldVariantProps & {
  label: ReactNode;
  hint?: string;
  className?: string;
  id?: string;
  onPointerDown?: PointerEventHandler<HTMLLabelElement>;
  /** Hide the visible label while keeping it available to assistive tech. */
  labelClassName?: string;
};

type SingleLineProps = SharedProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className" | "onPointerDown"> & {
    multiline?: false;
    ref?: Ref<HTMLInputElement>;
  };

type MultiLineProps = SharedProps &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "className" | "onPointerDown"> & {
    multiline: true;
    ref?: Ref<HTMLTextAreaElement>;
  };

export type TextFieldProps = SingleLineProps | MultiLineProps;

/** Labeled text control. The class `sl-field` owns the border and focus ring. */
export function TextField(props: TextFieldProps) {
  const {
    label,
    labelPosition = "top",
    hint,
    className,
    id,
    onPointerDown,
    disabled,
    labelClassName,
    multiline,
    ref,
    ...rest
  } = props;
  const autoId = useId();
  const controlId = id ?? autoId;
  const hintId = hint ? `${controlId}-hint` : undefined;

  return (
    <label className={cn(textFieldVariants({ labelPosition }), className)} onPointerDown={onPointerDown}>
      <span className={cn("sl-text-field-label", labelClassName)}>{label}</span>
      {multiline ? (
        <textarea
          {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)}
          ref={ref as Ref<HTMLTextAreaElement> | undefined}
          id={controlId}
          className="sl-field"
          disabled={disabled}
          aria-describedby={hintId}
        />
      ) : (
        <input
          {...(rest as InputHTMLAttributes<HTMLInputElement>)}
          ref={ref as Ref<HTMLInputElement> | undefined}
          id={controlId}
          className="sl-field"
          disabled={disabled}
          aria-describedby={hintId}
        />
      )}
      {hint ? (
        <span className="sl-text-field-hint" id={hintId}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}
