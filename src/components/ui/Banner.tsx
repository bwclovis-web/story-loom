import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/ui/cn";

export const bannerVariants = cva("rounded-[var(--radius-md)] px-3.5 py-2.5 mb-4 [&_p]:my-0.5", {
  variants: {
    tone: {
      ok: "bg-[var(--add-bg)] text-[var(--ok)]",
      error: "bg-[var(--remove-bg)] text-[var(--danger)]",
      info: "bg-[var(--color-accent-soft)] text-accent",
      warn: "bg-[var(--color-warn-soft)] text-[var(--warn)]",
    },
  },
  defaultVariants: {
    tone: "info",
  },
});

export type BannerProps = HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof bannerVariants> & {
    children: ReactNode;
    title?: string;
  };

/** Status / feedback strip. Replaces `.banner` / `.banner.ok|error|info|warn`. */
export function Banner({ className, tone, title, children, role = "status", ...props }: BannerProps) {
  return (
    <div className={cn(bannerVariants({ tone }), className)} role={role} {...props}>
      {title ? <div className="font-semibold">{title}</div> : null}
      {children}
    </div>
  );
}
