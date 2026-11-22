import { cva, type VariantProps } from "class-variance-authority";

/** Where the label sits relative to the box. The box leads by default. */
export const checkboxVariants = cva("sl-checkbox", {
  variants: {
    labelPosition: {
      right: "",
      left: "is-left",
      top: "is-top",
    },
  },
  defaultVariants: {
    labelPosition: "right",
  },
});

export type CheckboxVariantProps = VariantProps<typeof checkboxVariants>;
