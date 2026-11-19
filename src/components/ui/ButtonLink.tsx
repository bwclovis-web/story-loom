import Link from "next/link";
import type { VariantProps } from "class-variance-authority";
import type { AnchorHTMLAttributes, ComponentProps } from "react";
import { buttonVariants } from "@/components/ui/Button";
import { cn } from "@/ui/cn";

type ButtonVariantProps = VariantProps<typeof buttonVariants>;

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
  return <Link className={cn(buttonVariants({ variant, size }), "no-underline", className)} {...props} />;
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
  return <a className={cn(buttonVariants({ variant, size }), "no-underline", className)} {...props} />;
}
