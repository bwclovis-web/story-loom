import { cva, type VariantProps } from "class-variance-authority";

/** Layout helpers for MenuPopover. Free of `"use client"` for Server Components. */
export const menuPopoverVariants = cva("menu-wrap", {
  variants: {
    align: {
      start: "",
      end: "",
    },
  },
  defaultVariants: {
    align: "end",
  },
});

export const menuPopoverPanelVariants = cva("tool-menu", {
  variants: {
    align: {
      start: "",
      end: "right",
    },
  },
  defaultVariants: {
    align: "end",
  },
});

export type MenuPopoverVariantProps = VariantProps<typeof menuPopoverVariants>;
