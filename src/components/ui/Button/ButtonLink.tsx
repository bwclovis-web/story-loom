import Link from "next/link";
import type { AnchorHTMLAttributes, ComponentProps, ReactNode } from "react";
import { cn } from "@/ui/cn";
import { ButtonContent } from "./ButtonContent";
import { buttonVariants, type ButtonVariantProps } from "./buttonVariants";

type IconProp = { icon?: ReactNode };

/** Next.js Link styled like `Button`. Replaces `a.button-link` / `a.button-link.secondary`. */
export function ButtonLink({
  className,
  variant = "primary",
  size = "md",
  icon,
  children,
  ...props
}: Omit<ComponentProps<typeof Link>, "className"> &
  ButtonVariantProps &
  IconProp & {
    className?: string;
  }) {
  const onAccent = variant === "primary" || variant === "danger";
  return (
    <Link
      {...props}
      className={cn(buttonVariants({ variant, size }), "no-underline", className)}
      style={onAccent ? { ...props.style, color: "var(--color-on-accent)" } : props.style}
    >
      <ButtonContent icon={icon}>{children}</ButtonContent>
    </Link>
  );
}

/** Plain anchor (download / hash links) with the same variants. */
export function ButtonAnchor({
  className,
  variant = "primary",
  size = "md",
  icon,
  children,
  ...props
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className"> &
  ButtonVariantProps &
  IconProp & {
    className?: string;
  }) {
  const onAccent = variant === "primary" || variant === "danger";
  return (
    <a
      {...props}
      className={cn(buttonVariants({ variant, size }), "no-underline", className)}
      style={onAccent ? { ...props.style, color: "var(--color-on-accent)" } : props.style}
    >
      <ButtonContent icon={icon}>{children}</ButtonContent>
    </a>
  );
}
