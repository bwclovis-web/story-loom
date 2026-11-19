import { cva, type VariantProps } from "class-variance-authority";

/** Wrapper for exclusive option toggles (layout mode, filters, etc.). */
export const segmentedControlVariants = cva("segmented-control", {
  variants: {
    size: {
      md: "",
      sm: "segmented-control-sm",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

export const segmentedOptionVariants = cva("", {
  variants: {
    selected: {
      true: "is-selected",
      false: "",
    },
  },
  defaultVariants: {
    selected: false,
  },
});

export type SegmentedControlVariantProps = VariantProps<typeof segmentedControlVariants>;
export type SegmentedOptionVariantProps = VariantProps<typeof segmentedOptionVariants>;
