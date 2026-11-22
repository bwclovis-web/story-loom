import { useId, type ReactNode, type Ref, type SelectHTMLAttributes } from "react";
import { cn } from "@/ui/cn";
import { selectControlClassName, selectVariants, type SelectVariantProps } from "./selectVariants";

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "id" | "className" | "size"> &
  SelectVariantProps & {
    /** Visible name. Omit when the select already has an accessible name. */
    label?: ReactNode;
    hint?: string;
    className?: string;
    id?: string;
    ref?: Ref<HTMLSelectElement>;
    children: ReactNode;
  };

/** Labeled native select. Prefer this for new UI; bare `<select>` stays until migrated. */
export function Select({
  label,
  labelPosition = "top",
  size = "md",
  hint,
  className,
  id,
  ref,
  disabled,
  children,
  ...props
}: SelectProps) {
  const autoId = useId();
  const controlId = id ?? autoId;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const control = (
    <select
      {...props}
      ref={ref}
      id={controlId}
      className={selectControlClassName}
      disabled={disabled}
      aria-describedby={hintId}
    >
      {children}
    </select>
  );

  if (label == null || label === false) {
    return (
      <span className={cn(selectVariants({ labelPosition, size }), className)}>
        {control}
        {hint ? (
          <span className="sl-select-hint text-[0.75rem] font-normal text-[var(--color-text-muted)]" id={hintId}>
            {hint}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <label className={cn(selectVariants({ labelPosition, size }), className)}>
      <span className="sl-select-label whitespace-nowrap text-[var(--color-text)]">{label}</span>
      {control}
      {hint ? (
        <span className="sl-select-hint text-[0.75rem] font-normal text-[var(--color-text-muted)]" id={hintId}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}
