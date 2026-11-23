import { cva, type VariantProps } from "class-variance-authority";

/**
 * Labeled select CVA (no "use client"). Layout uses Tailwind + design tokens.
 * `sl-select` marks the wrapper; `sl-select-control` marks the native select.
 */
export const selectVariants = cva(
  [
    "sl-select",
    "flex gap-1 items-center",
    "min-w-0 max-w-full",
    "font-[family-name:var(--font-ui)] font-semibold",
    "text-[0.82rem] text-[var(--color-text)]",
  ].join(" "),
  {
    variants: {
      labelPosition: {
        top: "flex-col items-stretch",
        bottom: [
          "flex-col items-stretch",
          "[&_.sl-select-label]:order-2",
          "[&_.sl-select-control]:order-1",
          "[&_.sl-select-hint]:order-3",
        ].join(" "),
        left: "flex-row items-center gap-2",
        right: [
          "flex-row items-center gap-2",
          "[&_.sl-select-label]:order-2",
          "[&_.sl-select-control]:order-1",
          "[&_.sl-select-hint]:order-3 [&_.sl-select-hint]:basis-full",
        ].join(" "),
      },
      size: {
        sm: "text-[0.78rem] [&_.sl-select-control]:min-h-7 [&_.sl-select-control]:px-2 [&_.sl-select-control]:py-1 [&_.sl-select-control]:text-[0.85rem]",
        md: "[&_.sl-select-control]:min-h-8 [&_.sl-select-control]:px-2.5 [&_.sl-select-control]:py-1.5 [&_.sl-select-control]:text-[0.9rem]",
      },
    },
    defaultVariants: {
      labelPosition: "top",
      size: "md",
    },
  },
);

export const selectControlClassName = [
  "sl-select-control",
  "w-full min-w-0 max-w-full",
  "font-[family-name:var(--font-ui)] font-normal leading-none",
  "rounded-[var(--radius-md)] border border-solid",
  "border-[var(--color-input-border)] bg-[var(--color-surface)] text-[var(--color-text)]",
  "shadow-[inset_0_1px_1px_light-dark(rgba(28,24,20,0.04),rgba(0,0,0,0.2))]",
  "transition-[border-color,box-shadow,background-color]",
  "duration-[var(--motion-fast)] ease-[var(--motion-ease)]",
  "hover:enabled:border-[var(--color-border-strong)]",
  "focus-visible:outline-none focus-visible:border-[var(--color-accent)]",
  "focus-visible:shadow-[inset_0_1px_1px_light-dark(rgba(28,24,20,0.04),rgba(0,0,0,0.2)),0_0_0_3px_color-mix(in_srgb,var(--color-accent)_22%,transparent)]",
  "disabled:cursor-not-allowed disabled:opacity-60 disabled:bg-[var(--color-surface-sunken)]",
].join(" ");

export type SelectVariantProps = VariantProps<typeof selectVariants>;
