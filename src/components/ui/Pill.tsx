import type { ReactNode, SelectHTMLAttributes } from "react";

/** Rounded select control matching scope / filter pills in Write and Assistant. */
export function PillSelect({
  label,
  className = "",
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  return (
    <label className={`pill-select ${className}`.trim()}>
      <span className="visually-hidden">{label}</span>
      <select {...rest}>{children}</select>
    </label>
  );
}

/** Non-interactive context pill (chapter · draft, etc.). */
export function PillLabel({ children, title, className = "" }: { children: ReactNode; title?: string; className?: string }) {
  return (
    <span className={`pill-label ${className}`.trim()} title={title}>
      {children}
    </span>
  );
}
