import { ProjectPageHeader } from "@/components/library/ProjectPageHeader";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { VisitDraftSwitcher } from "@/components/drafts/DraftControls";
import { HelpHint } from "@/components/HelpHint";
import { ButtonLink } from "@/components/ui/Atoms/Button";
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

function povChipClass(pov: string): string {
  if (!pov) return "style-pov-chip style-pov-chip--empty";
  const bucket = [...pov].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 3;
  return `style-pov-chip style-pov-chip--${["a", "b", "c"][bucket]}`;
}

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
  const paceMax = Math.max(...result.pacing.map((item) => Math.max(item.words, item.wordTarget ?? 0)), 1);
  const { characterMatrix, weaveSpans, povSequence } = result;

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
      <HelpHint anchor="manuscript-style-check" topic="style check and insights">
        {STYLE_CHECK.insightsLead} {STYLE_CHECK.panelNote}
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

      <section className="panel" aria-labelledby="style-insights">
        <h2 id="style-insights" style={{ marginTop: 0 }}>
          {STYLE_CHECK.insightsHeading}
        </h2>
        <p className="small muted">{STYLE_CHECK.insightsLead}</p>

        <h3 id="style-pacing">{STYLE_CHECK.pacing}</h3>
        {result.pacing.length === 0 ? (
          <p className="muted">{STYLE_CHECK.noResults}</p>
        ) : (
          <div className="pace-chart" aria-label={STYLE_CHECK.pacing}>
            {result.pacing.map((bar) => {
              const targetPct = bar.wordTarget !== undefined ? Math.min(100, (bar.wordTarget / paceMax) * 100) : null;
              const barPct = Math.max(4, (bar.words / paceMax) * 100);
              const title =
                bar.wordTarget !== undefined
                  ? `${bar.title}: ${STYLE_CHECK.pacingTarget(bar.words, bar.wordTarget)}`
                  : `${bar.title}: ${bar.words}`;
              return (
                <div key={bar.id} className="pace-chart-col" title={title}>
                  <div className="pace-chart-stack">
                    {targetPct !== null ? (
                      <div className="pace-chart-target" style={{ bottom: `${targetPct}%` }} aria-hidden />
                    ) : null}
                    <div className="pace-chart-bar" style={{ height: `${barPct}%` }} />
                  </div>
                  <span className="small">{bar.words}</span>
                </div>
              );
            })}
          </div>
        )}

        <h3 id="style-pov-sequence">{STYLE_CHECK.povSequence}</h3>
        {povSequence.length === 0 ? (
          <p className="muted">{STYLE_CHECK.povSequenceEmpty}</p>
        ) : (
          <div className="style-pov-strip" aria-labelledby="style-pov-sequence">
            {povSequence.map((item) => (
              <Link key={item.recordId} href={`${base}/records/${encodeURIComponent(item.recordId)}`} className={povChipClass(item.pov)}>
                <span className="small muted">{RECORD_TYPE_LABELS[item.type]}</span>
                <span>{item.title}</span>
                <span className="small">{item.pov || STYLE_CHECK.povUnset}</span>
              </Link>
            ))}
          </div>
        )}

        <h3 id="style-character-matrix">{STYLE_CHECK.characterMatrix}</h3>
        {characterMatrix.rows.length === 0 || characterMatrix.chapters.length === 0 ? (
          <p className="muted">{STYLE_CHECK.characterMatrixEmpty}</p>
        ) : (
          <>
            <p className="small muted">
              {STYLE_CHECK.characterMatrixCaption(characterMatrix.chapters.length, characterMatrix.rows.length)}
            </p>
            <div style={{ overflowX: "auto" }}>
              <table className="style-character-matrix" aria-labelledby="style-character-matrix">
                <thead>
                  <tr>
                    <th scope="col" className="sr-only">
                      Character
                    </th>
                    {characterMatrix.chapters.map((ch) => (
                      <th key={ch.id} scope="col" title={ch.title}>
                        <Link href={`${base}/records/${encodeURIComponent(ch.id)}`}>{ch.title}</Link>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {characterMatrix.rows.map((row) => (
                    <tr key={row.recordId}>
                      <th scope="row">
                        <Link href={`${base}/records/${encodeURIComponent(row.recordId)}`}>{row.name}</Link>
                      </th>
                      {row.counts.map((count, i) => {
                        const ch = characterMatrix.chapters[i]!;
                        return (
                          <td key={`${row.recordId}-${ch.id}`} className={count === 0 ? "style-matrix-zero" : undefined}>
                            {count > 0 ? (
                              <Link href={`${base}/records/${encodeURIComponent(ch.id)}`}>{count}</Link>
                            ) : (
                              "0"
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <h3 id="style-weave-spans">{STYLE_CHECK.weaveSpans}</h3>
        {weaveSpans.length === 0 ? (
          <p className="muted">{STYLE_CHECK.weaveSpansEmpty}</p>
        ) : (
          <ul className="style-weave-spans" aria-labelledby="style-weave-spans">
            {weaveSpans.map((span) => (
              <li key={span.id} className="style-weave-span">
                <p className="small muted" style={{ margin: "0 0 0.25rem" }}>
                  <Link href={`${base}/plan/weave/${encodeURIComponent(span.gridId)}`}>{span.gridTitle}</Link>
                  {span.fromProjectId !== span.toProjectId ? (
                    <>
                      {" "}
                      · {span.fromProjectTitle} → {span.toProjectTitle}
                    </>
                  ) : null}
                </p>
                <p style={{ margin: "0 0 0.25rem" }}>
                  <strong>{span.fromTitle}</strong> → <strong>{span.toTitle}</strong>
                </p>
                {span.note ? <p className="small muted" style={{ margin: "0 0 0.25rem" }}>{span.note}</p> : null}
                <p className="small" style={{ margin: 0 }}>
                  {span.spanBeats !== null ? STYLE_CHECK.weaveSpanBeatGap(span.spanBeats) : null}
                  {span.spanBeats !== null && span.spanChapters !== null ? " · " : null}
                  {span.spanChapters !== null ? STYLE_CHECK.weaveSpanChapterGap(span.spanChapters) : null}
                  {span.spanBeats === null && span.spanChapters === null ? STYLE_CHECK.weaveSpanNoDistance : null}
                </p>
              </li>
            ))}
          </ul>
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