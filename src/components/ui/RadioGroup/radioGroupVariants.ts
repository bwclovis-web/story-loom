import { cva, type VariantProps } from "class-variance-authority";

/** Exclusive radio choices. `row` sits options side by side; `stack` lists them. */
export const radioGroupVariants = cva("radio-group", {
  variants: {
    layout: {
      row: "radio-group-row",
      stack: "radio-group-stack",
    },
  },
  defaultVariants: {
    layout: "row",
  },
});

export type RadioGroupVariantProps = VariantProps<typeof radioGroupVariants>;
