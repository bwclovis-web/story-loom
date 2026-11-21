import { ProjectPageHeader } from "@/components/library/ProjectPageHeader";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { VisitDraftSwitcher } from "@/components/drafts/DraftControls";
import { HelpHint } from "@/components/HelpHint";
import { ButtonLink } from "@/components/ui/Button";
import { RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import { DRAFT, NAV, SHELL, STYLE_CHECK } from "@/ui/labels";
import { getDb } from "@/server/db";
import { readWriteDraftCookie, resolveWriteDraftId } from "@/server/draftSelection";
import { listManuscriptDrafts } from "@/server/services/draftService";
import { findProject } from "@/server/services/projectService";
import { runManuscriptStyleCheck } from "@/server/services/styleCheckService";
import type { StyleCheckKind } from "@/writing/styleCheck";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<StyleCheckKind, string> = {
  echo: STYLE_CHECK.kindEcho,
  filter: STYLE_CHECK.kindFilter,
  adverb: STYLE_CHECK.kindAdverb,
  long_sentence: STYLE_CHECK.kindLongSentence,
  name_repeat: STYLE_CHECK.kindName,
  passive: STYLE_CHECK.kindPassive,
  weak_verb: STYLE_CHECK.kindWeakVerb,
};

export async function generateMetadata({ params }: { params: Promise<{ projectId: string }> }): Promise<Metadata> {
  const { projectId } = await params;
  const db = getDb();
  const project = await findProject(db, projectId);
  return { title: project ? `${STYLE_CHECK.heading} · ${project.title}` : NAV.brand };
}

export default async function ManuscriptStylePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const db = getDb();
  const project = await findProject(db, projectId);
  if (!project) notFound();
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const drafts = await listManuscriptDrafts(db, projectId);
  const hasDrafts = drafts.length > 0;
  const draftId = resolveWriteDraftId(drafts, await readWriteDraftCookie());
  const result = await runManuscriptStyleCheck(db, { projectId, hasDrafts, draftId });

  return (
    <>
      <ProjectPageHeader
        projectId={projectId}
        title={STYLE_CHECK.heading}
        description={STYLE_CHECK.lead}
        crumbs={[
          { href: `${base}/write`, label: SHELL.write },
          { label: STYLE_CHECK.heading, current: true },
        ]}
      />
      <HelpHint anchor="manuscript-style-check" topic="local style checks">
        {STYLE_CHECK.panelNote}
      </HelpHint>

      <div className="row" style={{ marginBottom: "1rem" }}>
        <ButtonLink href={`${base}/write`} variant="secondary" size="sm">
          {STYLE_CHECK.backToWrite}
        </ButtonLink>
      </div>

      {hasDrafts ? (
        <section className="panel">
          <VisitDraftSwitcher
            drafts={drafts.map((d) => ({
              id: d.id,
              kind: d.kind,
              label: d.label,
              completedAt: d.completedAt?.toISOString() ?? null,
            }))}
            selectedDraftId={draftId}
            basePath={`${base}/write/style`}
            label={DRAFT.draftLabel}
          />
        </section>
      ) : null}

      <section className="panel" aria-labelledby="style-pacing">
        <h2 id="style-pacing" style={{ marginTop: 0 }}>
          {STYLE_CHECK.pacing}
        </h2>
        {result.pacing.length === 0 ? (
          <p className="muted">{STYLE_CHECK.noResults}</p>
        ) : (
          <div className="pace-chart" aria-label={STYLE_CHECK.pacing}>
            {result.pacing.map((bar) => {
              const max = Math.max(...result.pacing.map((item) => item.words), 1);
              return (
                <div key={bar.id} className="pace-chart-col" title={`${bar.title}: ${bar.words}`}>
                  <div className="pace-chart-bar" style={{ height: `${Math.max(4, (bar.words / max) * 100)}%` }} />
                  <span className="small">{bar.words}</span>
                </div>
              );
            })}
          </div>
        )}
        <p>
          {STYLE_CHECK.dialogue}: {STYLE_CHECK.dialogueRatio(result.dialogue.dialogueWords, result.dialogue.narrationWords)}
        </p>
        <h3>{STYLE_CHECK.pov}</h3>
        {result.pov.length === 0 ? (
          <p className="muted">{STYLE_CHECK.povEmpty}</p>
        ) : (
          <ul>
            {result.pov.map((row) => (
              <li key={row.name}>
                {row.name}: {row.count}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel" aria-labelledby="style-results">
        <h2 id="style-results" style={{ marginTop: 0 }}>
          {STYLE_CHECK.resultsHeading}
        </h2>
        {result.records.length === 0 ? (
          <p className="muted">{STYLE_CHECK.noResults}</p>
        ) : (
          <>
            <p className="small muted">{STYLE_CHECK.resultsLead(result.totalIssues, result.records.length)}</p>
            <ul className="search-hits">
              {result.records.map((row) => (
                <li key={row.id} className="search-hit">
                  <div className="search-hit-head">
                    <span className="search-hit-title">
                      <Link href={`${base}/records/${encodeURIComponent(row.id)}`}>{row.title}</Link>
                    </span>
                    <span className="small muted">
                      {RECORD_TYPE_LABELS[row.type]}
                      {row.parentTitle ? ` · ${STYLE_CHECK.inParent(row.parentTitle)}` : null}
                    </span>
                  </div>
                  <p className="small muted">
                    {row.issues.length} suggestion{row.issues.length === 1 ? "" : "s"}
                  </p>
                  <ul className="style-check-list compact">
                    {row.issues.slice(0, 8).map((issue, i) => (
                      <li key={`${row.id}-${issue.start}-${i}`}>
                        <span className="badge subtle">{KIND_LABEL[issue.kind]}</span>{" "}
                        <Link
                          href={`${base}/records/${encodeURIComponent(row.id)}?${new URLSearchParams({
                            styleStart: String(issue.start),
                            styleEnd: String(issue.end),
                          })}`}
                        >
                          {issue.detail}
                        </Link>
                      </li>
                    ))}
                    {row.issues.length > 8 ? (
                      <li className="muted small">…and {row.issues.length - 8} more</li>
                    ) : null}
                  </ul>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}