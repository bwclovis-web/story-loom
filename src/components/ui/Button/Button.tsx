"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { buttonVariants, type ButtonVariantProps } from "./buttonVariants";
import { cn } from "@/ui/cn";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  ButtonVariantProps & {
    children?: ReactNode;
  };

/** Interactive button. Prefer this for new UI; CSS `.secondary` / `.small-button` stay until migrated. */
export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
