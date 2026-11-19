import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { bannerVariants, type BannerVariantProps } from "./bannerVariants";
import { cn } from "@/ui/cn";

export type BannerProps = HTMLAttributes<HTMLDivElement> &
  BannerVariantProps & {
    children?: ReactNode;
    title?: string;
  };

/** Status / feedback strip. Replaces `.banner` / `.banner.ok|error|info|warn`. */
export const Banner = forwardRef<HTMLDivElement, BannerProps>(function Banner(
  { className, tone, title, children, role = "status", ...props },
  ref,
) {
  return (
    <div ref={ref} className={cn(bannerVariants({ tone }), className)} role={role} {...props}>
      {title ? <div className="font-semibold">{title}</div> : null}
      {children}
    </div>
  );
});
