import { useId, type CSSProperties, type InputHTMLAttributes, type ReactNode, type Ref } from "react";
import { cn } from "@/ui/cn";
import { checkboxVariants, type CheckboxVariantProps } from "./checkboxVariants";

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type" | "className" | "style"> &
  CheckboxVariantProps & {
    /** Visible name. Omit it when the input carries its own accessible name. */
    label?: ReactNode;
    className?: string;
    style?: CSSProperties;
    id?: string;
    ref?: Ref<HTMLInputElement>;
    indeterminate?: boolean;
  };

function assignRef(ref: Ref<HTMLInputElement> | undefined, node: HTMLInputElement | null) {
  if (typeof ref === "function") ref(node);
  else if (ref) ref.current = node;
}

/** Labeled checkbox. The box uses the same surface and accent as the switch. */
export function Checkbox({
  label,
  labelPosition = "right",
  className,
  style,
  id,
  ref,
  indeterminate,
  ...props
}: CheckboxProps) {
  const autoId = useId();
  const controlId = id ?? autoId;
  const input = (
    <input
      {...props}
      ref={
        indeterminate || ref
          ? (node) => {
              if (node) node.indeterminate = Boolean(indeterminate);
              assignRef(ref, node);
            }
          : undefined
      }
      id={controlId}
      type="checkbox"
      className="sl-checkbox-input"
    />
  );

  if (label == null || label === false) return input;

  return (
    <label className={cn(checkboxVariants({ labelPosition }), className)} style={style}>
      {input}
      <span className="sl-checkbox-label">{label}</span>
    </label>
  );
}
