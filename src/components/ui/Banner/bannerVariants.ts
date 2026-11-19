import { cva, type VariantProps } from "class-variance-authority";

/** Banner tones. Uses explicit `--color-*` / legacy aliases — no circular theme shortcuts. */
export const bannerVariants = cva("rounded-[var(--radius-md)] px-3.5 py-2.5 mb-4 [&_p]:my-0.5", {
  variants: {
    tone: {
      ok: "bg-[var(--add-bg)] text-[var(--ok)]",
      error: "bg-[var(--remove-bg)] text-[var(--danger)]",
      info: "bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
      warn: "bg-[var(--color-warn-soft)] text-[var(--warn)]",
    },
  },
  defaultVariants: {
    tone: "info",
  },
});

export type BannerVariantProps = VariantProps<typeof bannerVariants>;
