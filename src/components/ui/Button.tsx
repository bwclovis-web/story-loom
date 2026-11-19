"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/ui/cn";

/**
 * Shared button (Tailwind + CVA). Prefer this for new UI; existing
 * `.secondary` / `.small-button` CSS stays until those call sites migrate.
 *
 * Variants: primary | secondary | danger | outline | ghost | soft
 * Sizes: sm | md | lg | icon | chip
 */
export const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-1.5",
    "font-[family-name:var(--font-ui)] font-medium leading-none",
    "border border-solid transition-[background-color,border-color,color,transform,opacity]",
    "duration-[var(--motion-fast)] ease-[var(--motion-ease)]",
    "cursor-pointer select-none whitespace-nowrap",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
    "focus-visible:outline-[var(--color-focus)]",
    "disabled:cursor-not-allowed disabled:opacity-50",
    "active:enabled:translate-y-px",
  ].join(" "),
  {
    variants: {
      variant: {
        primary:
          "bg-accent border-accent text-[var(--color-on-accent)] hover:enabled:bg-[var(--color-accent-hover)] hover:enabled:border-[var(--color-accent-hover)]",
        secondary:
          "bg-surface border-line text-ink hover:enabled:bg-[var(--color-surface-sunken)] hover:enabled:border-[var(--color-border-strong)]",
        danger:
          "bg-danger border-danger text-[var(--color-on-accent)] hover:enabled:bg-[var(--color-danger-hover)] hover:enabled:border-[var(--color-danger-hover)]",
        outline:
          "bg-transparent border-line text-ink hover:enabled:border-accent hover:enabled:bg-[var(--color-accent-soft)]",
        ghost:
          "bg-transparent border-transparent text-muted hover:enabled:bg-[var(--color-accent-tint)] hover:enabled:text-ink",
        soft:
          "bg-[var(--color-accent-soft)] border-[var(--color-accent-soft-border)] text-ink hover:enabled:border-accent",
      },
      size: {
        sm: "min-h-7 rounded-[var(--radius-md)] px-2.5 py-1 text-[0.85rem] [&_.icon]:size-3.5",
        md: "min-h-8 rounded-[var(--radius-md)] px-3.5 py-1.5 text-[0.9rem] [&_.icon]:size-4",
        lg: "min-h-10 rounded-[var(--radius-lg)] px-4 py-2 text-base [&_.icon]:size-[1.125rem]",
        icon: "size-8 min-h-8 rounded-[var(--radius-md)] p-0 [&_.icon]:size-4",
        chip: "min-h-0 rounded-full px-2.5 py-1.5 text-[0.78rem] [&_.icon]:size-3.5",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    children?: ReactNode;
  };

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
