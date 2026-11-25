import { cva, type VariantProps } from "class-variance-authority";

/** Wrapper for exclusive option toggles (layout mode, filters, etc.). */
export const segmentedControlVariants = cva("segmented-control", {
  variants: {
    size: {
      md: "",
      sm: "segmented-control-sm",
    },
    /**
     * Selected fill. `accent` matches Maps / Write (brass fill on selected).
     * `default` keeps the quieter inset surface used on denser toolbars.
     */
    tone: {
      default: "",
      accent: "segmented-control-accent",
    },
  },
  defaultVariants: {
    size: "md",
    tone: "default",
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
