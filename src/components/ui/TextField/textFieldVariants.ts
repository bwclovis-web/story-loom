import { cva, type VariantProps } from "class-variance-authority";

/** Label sits above the field, to its left, or to its right. */
export const textFieldVariants = cva("sl-text-field", {
  variants: {
    labelPosition: {
      top: "is-top",
      left: "is-left",
      right: "is-right",
    },
  },
  defaultVariants: {
    labelPosition: "top",
  },
});

export type TextFieldVariantProps = VariantProps<typeof textFieldVariants>;
