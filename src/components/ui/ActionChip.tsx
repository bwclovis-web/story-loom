import type { ButtonHTMLAttributes, ReactNode } from "react";

/** Compact pill action used in assistant suggestions, toolbars, and similar rails. */
export function ActionChip({
  children,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button type="button" className={`action-chip ${className}`.trim()} {...rest}>
      {children}
    </button>
  );
}
