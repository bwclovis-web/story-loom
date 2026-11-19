import { cva, type VariantProps } from "class-variance-authority";

/**
 * Icon-only control. Keeps the legacy `.icon-button` chrome (transparent hit
 * target + tip tooltips) so shell/rail closes stay visually consistent.
 */
export const iconButtonVariants = cva("icon-button", {
  variants: {
    tip: {
      none: "",
      tip: "tip",
      end: "tip tip-end",
      right: "tip-right",
      rail: "rail-tip",
    },
  },
  defaultVariants: {
    tip: "tip",
  },
});

export type IconButtonVariantProps = VariantProps<typeof iconButtonVariants>;
