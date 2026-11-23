import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Button } from "@/components/ui/Atoms/Button";
import { cn } from "@/ui/cn";

/** Compact pill action — thin wrapper over `Button` chip + outline. */
export function ActionChip({
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <Button variant="outline" size="chip" className={cn(className)} {...rest}>
      {children}
    </Button>
  );
}
