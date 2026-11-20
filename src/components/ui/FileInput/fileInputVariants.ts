import { cva } from "class-variance-authority";

/** Layout for the shared file picker. No "use client". */
export const fileInputVariants = cva("flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5");

export const fileInputNameClass =
  "min-w-0 text-[0.85rem] text-[var(--color-text-muted)] [overflow-wrap:anywhere]";
