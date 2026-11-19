import { cva, type VariantProps } from "class-variance-authority";

/**
 * Shared button CVA (no "use client"). Safe for Server Components such as
 * `ButtonLink` / `ButtonAnchor`, and for the client `Button`.
 *
 * Uses explicit `--color-*` tokens (not short Tailwind theme aliases) so
 * backgrounds and text stay contrasted. Marked with `sl-btn` so legacy
 * unlayered `button { color: on-accent }` rules in globals.css do not override.
 *
 * Variants: primary | secondary | danger | outline | ghost | soft
 * Sizes: sm | md | lg | icon | chip
 */
export const buttonVariants = cva(
  [
    "sl-btn",
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
        primary: [
          "bg-[var(--color-accent)] border-[var(--color-accent)] text-[var(--color-on-accent)]",
          "hover:enabled:bg-[var(--color-accent-hover)] hover:enabled:border-[var(--color-accent-hover)]",
        ].join(" "),
        secondary: [
          "bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text)]",
          "hover:enabled:bg-[var(--color-surface-sunken)] hover:enabled:border-[var(--color-border-strong)]",
        ].join(" "),
        danger: [
          "bg-[var(--color-danger)] border-[var(--color-danger)] text-[var(--color-on-accent)]",
          "hover:enabled:bg-[var(--color-danger-hover)] hover:enabled:border-[var(--color-danger-hover)]",
        ].join(" "),
        outline: [
          "bg-transparent border-[var(--color-border)] text-[var(--color-text)]",
          "hover:enabled:border-[var(--color-accent)] hover:enabled:bg-[var(--color-accent-soft)]",
        ].join(" "),
        ghost: [
          "bg-transparent border-transparent text-[var(--color-text-muted)]",
          "hover:enabled:bg-[var(--color-accent-tint)] hover:enabled:text-[var(--color-text)]",
        ].join(" "),
        soft: [
          "bg-[var(--color-accent-soft)] border-[var(--color-accent-soft-border)] text-[var(--color-text)]",
          "hover:enabled:border-[var(--color-accent)]",
        ].join(" "),
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

export type ButtonVariantProps = VariantProps<typeof buttonVariants>;
