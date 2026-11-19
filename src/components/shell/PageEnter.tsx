"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** Remounts main page content on route change so CSS page-enter can play. */
export function PageEnter({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="page-enter">
      {children}
    </div>
  );
}
