import type { ReactNode } from "react";
import { BookCover } from "./BookCover";

/**
 * Shared landing header for Write, Weave, World, and Assistant.
 * The cover is decorative. The book title in the heading is the accessible name.
 */
export function LandingHeader({
  projectId,
  title,
  eyebrow,
  coverSrc,
  description,
  gettingStarted,
}: {
  projectId: string;
  title: string;
  eyebrow: string;
  coverSrc: string | null;
  description: string;
  gettingStarted: ReactNode;
}) {
  return (
    <header className="outline-header landing-header">
      <BookCover projectId={projectId} title={title} eyebrow={eyebrow} size="compact" coverSrc={coverSrc} />
      <div className="outline-heading">
        <p className="outline-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="landing-lead">{description}</p>
        {gettingStarted}
      </div>
    </header>
  );
}
