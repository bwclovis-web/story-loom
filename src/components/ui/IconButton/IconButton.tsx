"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { iconButtonVariants, type IconButtonVariantProps } from "./iconButtonVariants";
import { cn } from "@/ui/cn";

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  IconButtonVariantProps & {
    children: ReactNode;
    /** Shown via CSS tooltip (`data-tooltip`). Defaults to `aria-label`. */
    tooltip?: string;
  };

/** Square icon control with optional tip placement. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, tip, tooltip, type = "button", children, ...props },
  ref,
) {
  const label = tooltip ?? (typeof props["aria-label"] === "string" ? props["aria-label"] : undefined);
  return (
    <button
      ref={ref}
      type={type}
      className={cn(iconButtonVariants({ tip }), className)}
      data-tooltip={label}
      {...props}
    >
      {children}
    </button>
  );
});
