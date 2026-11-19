import Link from "next/link";
import type { AnchorHTMLAttributes, ComponentProps } from "react";
import { buttonVariants, type ButtonVariantProps } from "./buttonVariants";
import { cn } from "@/ui/cn";

/** Next.js Link styled like `Button`. Replaces `a.button-link` / `a.button-link.secondary`. */
export function ButtonLink({
  className,
  variant = "primary",
  size = "md",
  ...props
}: Omit<ComponentProps<typeof Link>, "className"> &
  ButtonVariantProps & {
    className?: string;
  }) {
  const onAccent = variant === "primary" || variant === "danger";
  return (
    <Link
      {...props}
      className={cn(buttonVariants({ variant, size }), "no-underline", className)}
      style={onAccent ? { ...props.style, color: "var(--color-on-accent)" } : props.style}
    />
  );
}

/** Plain anchor (download / hash links) with the same variants. */
export function ButtonAnchor({
  className,
  variant = "primary",
  size = "md",
  ...props
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className"> &
  ButtonVariantProps & {
    className?: string;
  }) {
  const onAccent = variant === "primary" || variant === "danger";
  return (
    <a
      {...props}
      className={cn(buttonVariants({ variant, size }), "no-underline", className)}
      style={onAccent ? { ...props.style, color: "var(--color-on-accent)" } : props.style}
    />
  );
}
