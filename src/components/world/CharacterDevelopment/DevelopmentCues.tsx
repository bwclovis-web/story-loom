import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { CHARACTER_DEVELOPMENT } from "@/ui/labels";
import type { DevelopmentCue } from "@/domain/characterDevelopment";

/** Read-only links from a plot grid, timeline, or manuscript to dossier development. */
export function DevelopmentCues({
  title,
  cues,
}: {
  title: string;
  cues: DevelopmentCue[];
}) {
  return (
    <section className="panel" aria-label={title}>
      <h2>{title}</h2>
      {cues.length === 0 ? (
        <EmptyState>{CHARACTER_DEVELOPMENT.cuesEmpty}</EmptyState>
      ) : (
        <ul className="context-links">
          {cues.map((cue) => (
            <li key={cue.id}>
              <Link href={cue.href}>{cue.title}</Link>
              {cue.detail ? <div className="small muted">{cue.detail}</div> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
