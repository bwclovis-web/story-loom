import type { ReactNode } from "react";
import { cn } from "@/ui/cn";
import { BookCover } from "./BookCover";

/**
 * The one project header. Cover, series eyebrow, and title row stay the same
 * on every project page. Pass a different `title` per page. Nested pages also
 * pass `breadcrumbs`. The drawn cover keeps the book title via `coverTitle`.
 */
export function LandingHeader({
  projectId,
  title,
  eyebrow,
  coverSrc,
  coverTitle,
  description,
  gettingStarted,
  breadcrumbs,
  actions,
}: {
  projectId: string;
  title: ReactNode;
  eyebrow: string;
  coverSrc: string | null;
  /** Book name on the drawn cover. Defaults to `title` when that is the book. */
  coverTitle?: string;
  description?: ReactNode;
  gettingStarted?: ReactNode;
  breadcrumbs?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className={cn("outline-header landing-header", actions ? "landing-header-actions" : null)}>
      {breadcrumbs ? <div className="landing-breadcrumbs">{breadcrumbs}</div> : null}
      <BookCover
        projectId={projectId}
        title={coverTitle ?? (typeof title === "string" ? title : eyebrow)}
        eyebrow={eyebrow}
        size="compact"
        coverSrc={coverSrc}
      />
      <div className="outline-heading">
        <p className="outline-eyebrow">{eyebrow}</p>
        <h1 className="capitalize">{title}</h1>
        {description ? <p className="landing-lead">{description}</p> : null}
        {gettingStarted != null ? <div className="landing-getting-started">{gettingStarted}</div> : null}
      </div>
      {actions ? <div className="landing-header-actions-slot">{actions}</div> : null}
    </header>
  );
}
