import Link from "next/link";
import { notFound } from "next/navigation";
import { CanonBadge } from "@/components/Badges";
import { LandingHeader } from "@/components/library/LandingHeader";
import { OverflowDisclosure } from "@/components/shell/OverflowDisclosure";
import { ProjectOnboarding } from "@/components/shell/ProjectOnboarding";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { WorldRecordTableRow } from "@/components/ui/RecordRow";
import { SearchPanel } from "@/components/ui/SearchPanel";
import { WorldDirectory } from "@/components/world/WorldDirectory";
import { WorldRecordIcon } from "@/components/world/WorldDestinationIcon";
import { Plus } from "lucide-react";
import { WorldKindBrowse, WorldReferenceFilters } from "@/components/world/WorldReferenceFilters";
import { stableStringify } from "@/domain/json";
import { getDb } from "@/server/db";
import { listProjectCoverHashes } from "@/server/services/coverService";
import { findProject } from "@/server/services/projectService";
import { listWorldIndex } from "@/server/services/recordService";
import { searchProjectRecords, type SearchHit } from "@/server/services/searchService";
import { GROUP_PAGES, SERIES, SHELL, WORLD, WORLD_KIND } from "@/ui/labels";
import { seriesBookLabel, seriesRecordHref } from "@/world/seriesHome";
import { manuscriptEyebrow } from "@/ui/library";
import { isWorldKindKey } from "@/world/referenceTemplates";
import {
  WORLDBUILDING_KIND_OTHER,
  WORLDBUILDING_KIND_UNSET,
  worldbuildingCustomKind,
  worldbuildingKindFromFields,
  worldKindDisplayFromFields,
  worldKindLabel,
} from "@/world/worldKinds";
import {
  categoryLabel,
  isWorldType,
  isWorldbuildingKindFilter,
  WORLD_CATEGORY_LABELS,
  WORLD_TYPES,
  worldCounts,
  worldHref,
  worldKindCounts,
} from "@/ui/world";

export const dynamic = "force-dynamic";

export default async function WorldPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ type?: string; q?: string; list?: string; kind?: string }>;
}) {
  const { projectId } = await params;
  const query = await searchParams;
  const type = isWorldType(query.type) ? query.type : null;
  const q = (query.q ?? "").trim();
  const list = query.list === "1";
  const kindFilter =
    type === "worldbuilding" && isWorldbuildingKindFilter(query.kind) ? query.kind : null;
  const db = getDb();
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const [project, worldRecords, hits, coverHashes] = await Promise.all([
    findProject(db, projectId),
    listWorldIndex(db, projectId),
    q
      ? searchProjectRecords(db, {
          projectId,
          query: q,
          types: WORLD_TYPES,
          includeManuscript: false,
          includeSeriesBible: true,
        })
      : null,
    listProjectCoverHashes(db, [projectId]),
  ]);
  if (!project) notFound();
  const coverHash = coverHashes.get(projectId) ?? null;
  const eyebrow = manuscriptEyebrow(project.seriesName, project.workspace.name);
  const counted = worldRecords.map(({ record }) => ({
    type: record.type,
    worldKind: record.type === "worldbuilding" ? worldbuildingKindFromFields(record.fields) : null,
    customKind: record.type === "worldbuilding" ? worldbuildingCustomKind(record.fields) : null,
  }));
  const counts = worldCounts(counted);
  const kindCounts = worldKindCounts(counted);
  const listed = type
    ? worldRecords.filter(({ record: r }) => {
        if (r.type !== type) return false;
        if (type === "worldbuilding" && kindFilter) {
          const kind = worldbuildingKindFromFields(r.fields);
          const custom = worldbuildingCustomKind(r.fields);
          if (kindFilter === WORLDBUILDING_KIND_UNSET) return !kind && !custom;
          if (kindFilter === WORLDBUILDING_KIND_OTHER) return !!custom;
          return kind === kindFilter;
        }
        return true;
      })
    : worldRecords;
  const recent = [...worldRecords]
    .sort((a, b) => b.record.updatedAt.getTime() - a.record.updatedAt.getTime() || a.record.title.localeCompare(b.record.title))
    .slice(0, 8);
  const showHub = !type && !q && !list;
  const byId = new Map(worldRecords.map(({ record }) => [record.id, record]));
  const startsMidText = (hit: SearchHit): boolean => {
    const record = byId.get(hit.id);
    if (!hit.excerptTruncated || !record) return false;
    const source = hit.matchedIn === "title" ? record.title : hit.matchedIn === "body" ? record.body : stableStringify(record.fields);
    return !source.normalize("NFC").startsWith(hit.excerpt);
  };
  const selection = type ? `type=${type}` : "group=world";
  const exportHref = `${base}/export?${selection}`;
  const pdfHref = `${base}/export-pdf?${selection}`;
  const listTitle =
    type === "worldbuilding" && kindFilter && isWorldKindKey(kindFilter)
      ? worldKindLabel(kindFilter)
      : type === "worldbuilding" && kindFilter === WORLDBUILDING_KIND_OTHER
        ? WORLD.worldKindOther
      : type === "worldbuilding" && kindFilter === WORLDBUILDING_KIND_UNSET
        ? WORLD.worldKindUnset
        : type
          ? WORLD_CATEGORY_LABELS[type]
          : WORLD.allReferencesList;
  const crumb = q ? WORLD.search : listTitle;

  const newReference = (
    <ButtonLink href={`${base}/world/new${type ? `?type=${type}` : ""}`} icon={<Plus strokeWidth={1.75} />}>
      {WORLD.newReference}
    </ButtonLink>
  );
  const kindBrowse =
    !q && (showHub || type === "worldbuilding") ? (
      <WorldKindBrowse
        projectId={projectId}
        type={type}
        kind={kindFilter}
        searching={!!q}
        kindCounts={kindCounts}
      />
    ) : null;

  return (
    <>
      <LandingHeader
        projectId={projectId}
        title={showHub ? SHELL.world : q ? WORLD.resultsFor(q) : listTitle}
        coverTitle={project.title}
        eyebrow={eyebrow}
        coverSrc={coverHash ? `${base}/cover?v=${coverHash}` : null}
        description={showHub ? undefined : GROUP_PAGES.world}
        gettingStarted={showHub ? <ProjectOnboarding projectId={projectId} quiet marked /> : undefined}
        actions={newReference}
        breadcrumbs={
          type || q || list ? (
            <Breadcrumbs
              label={WORLD.breadcrumb}
              items={[
                { href: worldHref(projectId), label: SHELL.world },
                { label: crumb, current: true },
              ]}
            />
          ) : null
        }
      />

      {showHub ? (
        <div className="world-hub-layout">
          <div className="world-hub-main">
            <SearchPanel
              action={worldHref(projectId)}
              label={WORLD.searchReferences}
              inputId="world-hub-q"
              submitLabel={WORLD.search}
              hint={WORLD.hubSearchHint}
              defaultValue={q}
              className="world-hub-search"
            />
            <WorldReferenceFilters
              projectId={projectId}
              type={type}
              kind={kindFilter}
              searching={!!q}
              listing={list}
              counts={counts}
            />
            <section aria-labelledby="world-recent-heading">
              <div className="world-section-head">
                <h2 id="world-recent-heading">{WORLD.recentReferences}</h2>
                <Link href={worldHref(projectId, { list: true })}>{WORLD.viewAllReferences}</Link>
              </div>
              {recent.length === 0 ? (
                <EmptyState>{WORLD.noRecent}</EmptyState>
              ) : (
                <ul className="world-recent">
                  {recent.map(({ record: r, home }) => {
                    const kind = r.type === "worldbuilding" ? worldbuildingKindFromFields(r.fields) : null;
                    const kindLabel = r.type === "worldbuilding" ? worldKindDisplayFromFields(r.fields) : null;
                    const book = home ? seriesBookLabel(home) : null;
                    return (
                      <li key={r.id}>
                        <span className="world-recent-icon">
                          <WorldRecordIcon type={r.type} kind={kind} />
                        </span>
                        <Link className="world-recent-title" href={`${base}/records/${encodeURIComponent(r.id)}`}>
                          {r.title}
                        </Link>
                        <p className="world-recent-meta small muted">
                          {categoryLabel(r.type)}
                          {kindLabel ? ` · ${kindLabel}` : ""}
                          {book ? ` · ${SERIES.homeBadge(book)}` : ""}
                          {" · "}
                          {r.updatedAt.toLocaleString(undefined, { dateStyle: "medium" })}
                        </p>
                        <span className="world-recent-status">
                          <CanonBadge status={r.authorityStatus} />
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
            {kindBrowse}
            <OverflowDisclosure summary={SHELL.exportAndImport}>
              <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
                <ButtonLink variant="secondary" href={`${base}/import-markdown`}>
                  {WORLD.importReferences}
                </ButtonLink>
                <ButtonLink variant="secondary" href={exportHref}>
                  {WORLD.exportForChatGpt}
                </ButtonLink>
                <ButtonLink variant="secondary" href={pdfHref}>
                  {WORLD.exportPdf}
                </ButtonLink>
              </div>
            </OverflowDisclosure>
          </div>
          <WorldDirectory projectId={projectId} current="references" rail />
        </div>
      ) : (
        <>
          <SearchPanel
            action={worldHref(projectId)}
            label={WORLD.searchReferences}
            inputId="world-hub-q"
            submitLabel={WORLD.search}
            hint={WORLD.hubSearchHint}
            defaultValue={q}
            className="world-hub-search"
          />
          <WorldReferenceFilters
            projectId={projectId}
            type={type}
            kind={kindFilter}
            searching={!!q}
            listing={list}
            counts={counts}
          />
          {kindBrowse}
          {q ? (
            <p className="small">
              <Link href={worldHref(projectId)}>{WORLD.clearSearch}</Link>
            </p>
          ) : (
            <p className="small">
              <Link href={worldHref(projectId)}>{WORLD.clearFilters}</Link>
            </p>
          )}
          <OverflowDisclosure summary={SHELL.exportAndImport}>
        <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
          <ButtonLink variant="secondary" href={`${base}/import-markdown`}>
            {WORLD.importReferences}
          </ButtonLink>
          <ButtonLink variant="secondary" href={exportHref}>
            {WORLD.exportForChatGpt}
          </ButtonLink>
          <ButtonLink variant="secondary" href={pdfHref}>
            {WORLD.exportPdf}
          </ButtonLink>
        </div>
      </OverflowDisclosure>

      {hits ? (
        <section className="panel" aria-label={WORLD.resultsFor(q)}>
          <p className="small muted">
            {hits.length} {hits.length === 1 ? "match" : "matches"} in titles, text and structured fields.{" "}
            <Link href={worldHref(projectId)}>{WORLD.clearSearch}</Link>
          </p>
          {hits.length === 0 ? (
            <p>{WORLD.noResults}</p>
          ) : (
            <ul className="search-hits">
              {hits.map((h) => (
                <li key={h.id}>
                  <div className="row">
                    <Link href={`${base}/records/${encodeURIComponent(h.id)}`} className="hit-title">
                      {h.title}
                    </Link>
                    <span className="small muted">{categoryLabel(h.type)}</span>
                    <CanonBadge status={h.authorityStatus} />
                    {h.seriesHome ? (
                      <span className="small">
                        {SERIES.homeBadge(seriesBookLabel(h.seriesHome))}{" "}
                        <Link href={seriesRecordHref(h.seriesHome.projectId, h.id)}>{SERIES.editIn(seriesBookLabel(h.seriesHome))}</Link>
                      </span>
                    ) : null}
                  </div>
                  <p className="hit-excerpt small">
                    <span className="muted">Matched in {WORLD.matchedIn[h.matchedIn]}: </span>
                    {startsMidText(h) ? <span className="muted">&hellip; </span> : null}
                    {h.excerpt}
                    {h.excerptTruncated ? (
                      <span className="muted">
                        {" "}
                        &hellip;<span className="sr-only"> {WORLD.excerptShortened}</span>
                      </span>
                    ) : null}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {!q && (type || list) ? (
        <section className="panel" aria-labelledby="world-list-heading">
          <h2 id="world-list-heading" className="sr-only">
            {listTitle}
          </h2>
          {listed.length === 0 ? (
            <EmptyState>{WORLD.noReferences}</EmptyState>
          ) : (
            <table className="record-table world-table">
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  {type ? (type === "worldbuilding" ? <th scope="col">{WORLD_KIND.fieldKind}</th> : null) : (
                    <th scope="col">{WORLD.documentType}</th>
                  )}
                  <th scope="col">{WORLD.canonStatus}</th>
                  <th scope="col">{WORLD.savedVersion}</th>
                  <th scope="col">{WORLD.protection}</th>
                </tr>
              </thead>
              <tbody>
                {listed.map(({ record: r, home }) => {
                  const kindLabel =
                    r.type === "worldbuilding"
                      ? worldKindDisplayFromFields(r.fields) ?? (type === "worldbuilding" ? "—" : undefined)
                      : undefined;
                  const book = home ? seriesBookLabel(home) : null;
                  return (
                    <WorldRecordTableRow
                      key={r.id}
                      projectId={projectId}
                      recordId={r.id}
                      title={r.title}
                      typeLabel={type ? (type === "worldbuilding" ? kindLabel : undefined) : categoryLabel(r.type)}
                      authorityStatus={r.authorityStatus}
                      currentRevision={r.currentRevision}
                      isProtected={r.protected}
                      homeBook={book && home ? { label: book, editHref: seriesRecordHref(home.projectId, r.id) } : null}
                    />
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      ) : null}
        </>
      )}
    </>
  );
}
