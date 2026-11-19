import type { ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "@/ui/cn";

/** Rounded select control matching scope / filter pills in Write and Assistant. */
export function PillSelect({
  label,
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  return (
    <label className={cn("flex min-w-28 flex-1 flex-col gap-0", className)}>
      <span className="visually-hidden">{label}</span>
      <select
        className={cn(
          "m-0 w-full rounded-full border border-[var(--color-border-strong)]",
          "bg-[var(--color-surface-sunken)] px-2.5 py-1.5 text-[0.85rem] text-[var(--color-text)]",
        )}
        {...rest}
      >
        {children}
      </select>
    </label>
  );
}

/** Non-interactive context pill (chapter · draft, etc.). */
export function PillLabel({ children, title, className }: { children: ReactNode; title?: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center overflow-hidden text-ellipsis whitespace-nowrap",
        "rounded-full border border-[var(--color-accent-soft-border)] bg-[var(--color-accent-soft)]",
        "px-2.5 py-1.5 text-[0.78rem] font-semibold text-[var(--color-text)]",
        className,
      )}
      title={title}
    >
      {children}
    </span>
  );
}
