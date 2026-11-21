import Link from "next/link";
import { notFound } from "next/navigation";
import { ProjectPageHeader } from "@/components/library/ProjectPageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { getDb } from "@/server/db";
import { listContinuityTriage, type ContinuityKind } from "@/server/services/continuityService";
import { findProject } from "@/server/services/projectService";
import { CONTINUITY, SHELL } from "@/ui/labels";

export const dynamic = "force-dynamic";

const GROUPS: { kind: ContinuityKind; heading: string }[] = [
  { kind: "unresolved", heading: CONTINUITY.unresolved },
  { kind: "open_question", heading: CONTINUITY.openQuestions },
  { kind: "fact", heading: CONTINUITY.facts },
  { kind: "story_evidence", heading: CONTINUITY.storyEvidence },
  { kind: "comment", heading: CONTINUITY.comments },
  { kind: "review", heading: CONTINUITY.reviews },
];

export default async function ContinuityPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const db = getDb();
  const project = await findProject(db, projectId);
  if (!project) notFound();
  const items = await listContinuityTriage(db, projectId);
  const base = `/projects/${encodeURIComponent(projectId)}`;

  return (
    <>
      <ProjectPageHeader
        projectId={projectId}
        title={CONTINUITY.title}
        description={CONTINUITY.lead}
        crumbs={[
          { href: `${base}/world`, label: SHELL.world },
          { label: CONTINUITY.title, current: true },
        ]}
      />
      {items.length === 0 ? (
        <EmptyState>{CONTINUITY.none}</EmptyState>
      ) : (
        GROUPS.map((group) => {
          const rows = items.filter((item) => item.kind === group.kind);
          if (!rows.length) return null;
          return (
            <section key={group.kind} className="panel" aria-labelledby={`continuity-${group.kind}`}>
              <h2 id={`continuity-${group.kind}`}>{group.heading}</h2>
              <ul>
                {rows.map((row) => (
                  <li key={row.key}>
                    <Link href={row.href}>{row.title}</Link>
                    {row.detail ? <p className="small muted">{row.detail}</p> : null}
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </>
  );
}
