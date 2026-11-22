import { cva, type VariantProps } from "class-variance-authority";

/** Label sits left of the track, right of it, or above it. */
export const labeledSwitchVariants = cva("labeled-switch", {
  variants: {
    labelPosition: {
      left: "",
      right: "is-right",
      top: "is-top",
    },
  },
  defaultVariants: {
    labelPosition: "left",
  },
});

export type LabeledSwitchVariantProps = VariantProps<typeof labeledSwitchVariants>;
