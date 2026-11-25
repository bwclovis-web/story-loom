"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/ui/cn";
import { ButtonContent } from "./ButtonContent";
import { buttonVariants, type ButtonVariantProps } from "./buttonVariants";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  ButtonVariantProps & {
    children?: ReactNode;
    /** Lucide (or other) icon shown before the label. Decorative; the label stays the name. */
    icon?: ReactNode;
  };

/** Interactive button. Prefer this for new UI; CSS `.secondary` / `.small-button` stay until migrated. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, type = "button", icon, children, ...props },
  ref,
) {
  return (
    <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props}>
      <ButtonContent icon={icon}>{children}</ButtonContent>
    </button>
  );
});
