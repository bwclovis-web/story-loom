import type { ReactNode } from "react";

/** Icon plus label inside Button, ButtonLink, and ButtonAnchor. */
export function ButtonContent({ icon, children }: { icon?: ReactNode; children?: ReactNode }) {
  return (
    <>
      {icon ? (
        <span className="icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children}
    </>
  );
}
