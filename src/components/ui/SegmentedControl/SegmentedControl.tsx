"use client";

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import {
  segmentedControlVariants,
  segmentedOptionVariants,
  type SegmentedControlVariantProps,
} from "./segmentedControlVariants";
import { cn } from "@/ui/cn";

export type SegmentedControlProps = HTMLAttributes<HTMLDivElement> &
  SegmentedControlVariantProps & {
    children: ReactNode;
    /** Accessible name for the option group. */
    label: string;
  };

export function SegmentedControl({ className, size, tone, label, children, ...props }: SegmentedControlProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(segmentedControlVariants({ size, tone }), className)}
      {...props}
    >
      {children}
    </div>
  );
}

export type SegmentedOptionProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  selected?: boolean;
  children: ReactNode;
};

export function SegmentedOption({
  className,
  selected = false,
  type = "button",
  children,
  ...props
}: SegmentedOptionProps) {
  return (
    <button
      type={type}
      className={cn(segmentedOptionVariants({ selected }), className)}
      aria-pressed={selected}
      {...props}
    >
      {children}
    </button>
  );
}
