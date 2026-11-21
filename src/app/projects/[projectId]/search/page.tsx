import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProjectPageHeader } from "@/components/library/ProjectPageHeader";
import { HelpHint } from "@/components/HelpHint";
import { SearchPanel } from "@/components/ui/SearchPanel";
import { findProject } from "@/server/services/projectService";
import {
  searchUnifiedProject,
  type UnifiedProjectSearchHit,
  type UnifiedSearchSource,
} from "@/server/services/projectUnifiedSearchService";
import { getDb } from "@/server/db";
import { readWriteDraftCookie, resolveWriteDraftId } from "@/server/draftSelection";
import { listManuscriptDrafts } from "@/server/services/draftService";
import { NAV, PROJECT_SEARCH } from "@/ui/labels";

export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<UnifiedSearchSource, string> = {
  record: PROJECT_SEARCH.sourceRecord,
  manuscript: PROJECT_SEARCH.sourceManuscript,
  weave_beat: PROJECT_SEARCH.sourceBeat,
  map_pin: PROJECT_SEARCH.sourceMapPin,
  map: PROJECT_SEARCH.sourceMap,
  story_event: PROJECT_SEARCH.sourceEvent,
  established_fact: PROJECT_SEARCH.sourceFact,
};

export async function generateMetadata({ params }: { params: Promise<{ projectId: string }> }): Promise<Metadata> {
  const { projectId } = await params;
  const db = getDb();
  const project = await findProject(db, projectId);
  return { title: project ? `${PROJECT_SEARCH.heading} · ${project.title}` : NAV.brand };
}

export default async function ProjectSearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { projectId } = await params;
  const query = await searchParams;
  const q = (query.q ?? "").trim();
  const db = getDb();
  const project = await findProject(db, projectId);
  if (!project) notFound();
  const drafts = await listManuscriptDrafts(db, projectId);
  const draftId = resolveWriteDraftId(drafts, await readWriteDraftCookie());
  const hits = q
    ? await searchUnifiedProject(db, {
        projectId,
        query: q,
        hasDrafts: drafts.length > 0,
        draftId,
      })
    : [];

  return (
    <>
      <ProjectPageHeader projectId={projectId} title={PROJECT_SEARCH.heading} description={PROJECT_SEARCH.lead} />
      <HelpHint anchor="project-search" topic="project search">
        {PROJECT_SEARCH.hint}
      </HelpHint>

      <SearchPanel
        action={`/projects/${encodeURIComponent(projectId)}/search`}
        label={PROJECT_SEARCH.searchLabel}
        submitLabel={PROJECT_SEARCH.submit}
        inputId="project-search-q"
        defaultValue={q}
        visibleLabel
      />

      {q ? <SearchResults query={q} hits={hits} /> : null}
    </>
  );
}

function SearchResults({ query, hits }: { query: string; hits: UnifiedProjectSearchHit[] }) {
  const grouped = new Map<UnifiedSearchSource, UnifiedProjectSearchHit[]>();
  for (const hit of hits) {
    grouped.set(hit.source, [...(grouped.get(hit.source) ?? []), hit]);
  }
  return (
    <section className="panel" aria-labelledby="project-search-results">
      <h2 id="project-search-results" style={{ marginTop: 0 }}>
        {PROJECT_SEARCH.resultsHeading(query)}
      </h2>
      {hits.length === 0 ? (
        <p className="muted">{PROJECT_SEARCH.none}</p>
      ) : (
        <p className="small muted">{PROJECT_SEARCH.summary(hits.length)}</p>
      )}
      {[...grouped.entries()].map(([source, list]) => (
        <div key={source}>
          <h3 className="small">{SOURCE_LABEL[source]}</h3>
          <ul className="search-hits">
            {list.map((hit) => (
              <li key={`${hit.source}-${hit.id}`}>
                <div className="row">
                  <Link href={hit.href} className="hit-title">
                    {hit.title}
                  </Link>
                  {hit.subtitle ? <span className="small muted">{hit.subtitle}</span> : null}
                  <span className="small muted">{PROJECT_SEARCH.matchedIn(hit.matchedIn)}</span>
                </div>
                {hit.excerpt ? <p className="small hit-excerpts">{hit.excerpt}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}