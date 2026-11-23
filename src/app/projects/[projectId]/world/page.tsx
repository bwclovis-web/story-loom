import Link from "next/link";
import { notFound } from "next/navigation";
import { CanonBadge } from "@/components/Badges";
import { LandingHeader } from "@/components/library/LandingHeader";
import { OverflowDisclosure } from "@/components/shell/OverflowDisclosure";
import { ProjectOnboarding } from "@/components/shell/ProjectOnboarding";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { ButtonLink } from "@/components/ui/Atoms/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { WorldRecordTableRow } from "@/components/ui/RecordRow";
import { SearchPanel } from "@/components/ui/SearchPanel";
import { WorldCategoryNav } from "@/components/world/WorldCategoryNav";
import { WorldDirectory } from "@/components/world/WorldDirectory";
import { WorldHubCollections } from "@/components/world/WorldHubCollections";
import { WorldHubFilters } from "@/components/world/WorldHubFilters";
import { WorldRecentAccessed } from "@/components/world/WorldRecentAccessed";
import { WorldRecordIcon } from "@/components/world/WorldDestinationIcon";
import { Plus } from "lucide-react";
import { WorldKindBrowse } from "@/components/world/WorldReferenceFilters";
import { stableStringify } from "@/domain/json";
import { getDb } from "@/server/db";
import { listProjectCoverHashes } from "@/server/services/coverService";
import { findProject } from "@/server/services/projectService";
import { listWorldIndex } from "@/server/services/recordService";
import { searchProjectRecords, type SearchHit } from "@/server/services/searchService";
import {
  getSmartCollection,
  listSmartCollections,
  type SmartCollectionView,
} from "@/server/services/smartCollectionService";
import { listAvailableWorldCategories } from "@/server/services/worldCategoryService";
import { NotFoundError } from "@/server/services/errors";
import { GROUP_PAGES, SERIES, SHELL, SMART_COLLECTIONS, WORLD } from "@/ui/labels";
import { worldHubQueryFromCollectionFilter } from "@/world/worldHubCollections";
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
  taxonomyPlacementLabel,
  WORLD_CATEGORY_LABELS,
  WORLD_TYPES,
  worldHref,
  worldKindCounts,
} from "@/ui/world";
import type { CustomTaxonomyCategoryOption } from "@/world/customCategories";
import {
  categoryBrowseCounts,
  categoryLabelOrCustom,
  discoverWorldHubRecords,
  hubHasActiveFilters,
  listHubTags,
  parseWorldHubQuery,
  projectWorldHubRecord,
  worldHubHref,
  type WorldHubRecord,
} from "@/world/hubDiscovery";
import { getTaxonomyCategory } from "@/world/taxonomy";
import { WorldCategoryManager } from "@/components/world/WorldCategoryManager";

export const dynamic = "force-dynamic";

function scopeBadge(record: WorldHubRecord): string | null {
  if (record.worldScope === "book") return WORLD.scopeBook;
  if (record.worldScope === "series") return WORLD.scopeSeries;
  return null;
}

function taxonomyPrimaryLabel(record: WorldHubRecord): string | null {
  if (!record.taxonomy.primaryCategory) return null;
  const primary = record.taxonomy.primarySubcategory
    ? { category: record.taxonomy.primaryCategory, subcategory: record.taxonomy.primarySubcategory }
    : { category: record.taxonomy.primaryCategory };
  return taxonomyPlacementLabel(primary);
}

function secondaryLabels(
  record: WorldHubRecord,
  customCategories: readonly CustomTaxonomyCategoryOption[],
): string[] {
  return record.taxonomy.secondaryCategories.map((id) => categoryLabelOrCustom(id, customCategories));
}

function listHeading(query: ReturnType<typeof parseWorldHubQuery>): string {
  if (query.q) return WORLD.search;
  if (query.unclassified) return WORLD.uncategorized;
  if (query.customKind) return query.customKind;
  if (query.tag) return query.tag;
  if (query.category) {
    const category = getTaxonomyCategory(query.category);
    if (query.subcategory) {
      const sub =
        category?.subcategories.find((item) => item.id === query.subcategory)?.label ?? query.subcategory;
      return category ? `${category.label} · ${sub}` : query.category;
    }
    return category?.label ?? query.category;
  }
  if (query.type === "worldbuilding" && query.kind && isWorldKindKey(query.kind)) {
    return worldKindLabel(query.kind);
  }
  if (query.type === "worldbuilding" && query.kind === WORLDBUILDING_KIND_OTHER) return WORLD.worldKindOther;
  if (query.type === "worldbuilding" && query.kind === WORLDBUILDING_KIND_UNSET) return WORLD.worldKindUnset;
  if (query.type) return WORLD_CATEGORY_LABELS[query.type];
  if (query.list) return WORLD.allReferencesList;
  return WORLD.allReferencesList;
}

function emptyMessage(query: ReturnType<typeof parseWorldHubQuery>, total: number): string {
  if (total === 0) return WORLD.emptyWorld;
  if (query.category || query.subcategory || query.unclassified) return WORLD.emptyCategory;
  return WORLD.emptyFilters;
}

export default async function WorldPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId } = await params;
  const raw = await searchParams;
  const flat: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw)) {
    flat[key] = Array.isArray(value) ? value[0] : value;
  }
  let query = parseWorldHubQuery(flat);
  const collectionId = flat.collection?.trim() || null;
  const db = getDb();
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const [project, worldRecords, hits, coverHashes, availableCategories, worldCollections] = await Promise.all([
    findProject(db, projectId),
    listWorldIndex(db, projectId),
    query.q
      ? searchProjectRecords(db, {
          projectId,
          query: query.q,
          types: [...WORLD_TYPES],
          includeManuscript: false,
          includeSeriesBible: true,
        })
      : null,
    listProjectCoverHashes(db, [projectId]),
    listAvailableWorldCategories(db, projectId),
    listSmartCollections(db, projectId, "world").catch(() => [] as SmartCollectionView[]),
  ]);
  if (!project) notFound();

  let activeCollection: SmartCollectionView | null = null;
  if (collectionId) {
    try {
      const loaded = await getSmartCollection(db, projectId, collectionId);
      if (loaded.scope === "world") activeCollection = loaded;
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
  }
  // Bare ?collection=id (or list-only) restores saved controls when no discovery filters are present.
  const discoveryActive = hubHasActiveFilters({ ...query, list: false });
  if (activeCollection && !discoveryActive && !query.q) {
    query = worldHubQueryFromCollectionFilter(activeCollection.filter);
  }

  const customCategories: CustomTaxonomyCategoryOption[] = availableCategories.map((row) => ({
    slug: row.slug,
    label: row.label,
    description: row.description,
    parentCategorySlug: row.parentCategorySlug,
    shared: Boolean(row.home),
    homeLabel: row.home ? row.home.bookName?.trim() || row.home.title : null,
  }));

  const hubRecords = worldRecords.map(({ record, home }) =>
    projectWorldHubRecord({
      id: record.id,
      title: record.title,
      type: record.type,
      authorityStatus: record.authorityStatus,
      protected: record.protected,
      currentRevision: record.currentRevision,
      worldScope: record.worldScope,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      fields: record.fields,
      home,
    }),
  );
  const browse = categoryBrowseCounts(hubRecords, customCategories);
  const tags = listHubTags(hubRecords);
  const discovered = discoverWorldHubRecords(hubRecords, query);
  const showHub = !hubHasActiveFilters(query) && !activeCollection;
  const recentUpdated = [...hubRecords]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title))
    .slice(0, 8);
  const kindCounts = worldKindCounts(
    worldRecords.map(({ record }) => ({
      type: record.type,
      worldKind: record.type === "worldbuilding" ? worldbuildingKindFromFields(record.fields) : null,
      customKind: record.type === "worldbuilding" ? worldbuildingCustomKind(record.fields) : null,
    })),
  );

  const coverHash = coverHashes.get(projectId) ?? null;
  const eyebrow = manuscriptEyebrow(project.seriesName, project.workspace.name);
  const byId = new Map(worldRecords.map(({ record }) => [record.id, record]));
  const startsMidText = (hit: SearchHit): boolean => {
    const record = byId.get(hit.id);
    if (!hit.excerptTruncated || !record) return false;
    const source =
      hit.matchedIn === "title" ? record.title : hit.matchedIn === "body" ? record.body : stableStringify(record.fields);
    return !source.normalize("NFC").startsWith(hit.excerpt);
  };

  const selection = query.type ? `type=${query.type}` : "group=world";
  const exportHref = `${base}/export?${selection}`;
  const pdfHref = `${base}/export-pdf?${selection}`;
  const listTitle = listHeading(query);
  const crumb = query.q ? WORLD.search : listTitle;
  const newHref = query.category
    ? `${base}/world/new?category=${encodeURIComponent(query.category)}${
        query.subcategory ? `&subcategory=${encodeURIComponent(query.subcategory)}` : ""
      }`
    : query.type
      ? `${base}/world/new?type=${encodeURIComponent(query.type)}`
      : `${base}/world/new`;
  const categoryForCreate = query.category ? getTaxonomyCategory(query.category) : null;
  const knownIds = hubRecords.map((record) => record.id);

  const newReference = (
    <ButtonLink href={newHref} icon={<Plus strokeWidth={1.75} />}>
      {WORLD.newReference}
    </ButtonLink>
  );

  const categoryNav = (
    <WorldCategoryNav
      projectId={projectId}
      counts={browse.byCategory}
      subcategoryCounts={browse.bySubcategory}
      customKinds={browse.customKinds}
      tagCounts={browse.tags}
      unclassified={browse.unclassified}
      currentCategory={query.category}
      currentSubcategory={query.subcategory}
      currentCustomKind={query.customKind}
      currentTag={query.tag}
      unclassifiedSelected={query.unclassified}
      allSelected={query.list && !query.category && !query.unclassified && !query.customKind && !query.tag && !query.type}
      customCategories={customCategories}
      collectionId={activeCollection?.id ?? null}
    />
  );

  const collectionsPanel = (
    <WorldHubCollections
      key={activeCollection?.id ?? "world-collections"}
      projectId={projectId}
      query={query}
      collections={worldCollections}
      activeCollection={activeCollection}
      matchCount={discovered.length}
      customCategories={customCategories}
    />
  );

  const searchHiddenCollection = activeCollection ? (
    <input type="hidden" name="collection" value={activeCollection.id} />
  ) : null;

  const renderRecordTable = (rows: WorldHubRecord[]) => (
    <table className="record-table world-table">
      <thead>
        <tr>
          <th scope="col">Title</th>
          <th scope="col">{WORLD.documentType}</th>
          <th scope="col">{WORLD.canonStatus}</th>
          <th scope="col">{WORLD.savedVersion}</th>
          <th scope="col">{WORLD.protection}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((record) => {
          const book = record.home ? seriesBookLabel(record.home) : null;
          return (
            <WorldRecordTableRow
              key={record.id}
              projectId={projectId}
              recordId={record.id}
              title={record.title}
              typeLabel={categoryLabel(record.type)}
              taxonomyLabel={taxonomyPrimaryLabel(record)}
              secondaryLabels={secondaryLabels(record, customCategories)}
              scopeLabel={scopeBadge(record)}
              authorityStatus={record.authorityStatus}
              currentRevision={record.currentRevision}
              isProtected={record.protected}
              homeBook={book && record.home ? { label: book, editHref: seriesRecordHref(record.home.projectId, record.id) } : null}
            />
          );
        })}
      </tbody>
    </table>
  );

  const renderRecordCards = (rows: WorldHubRecord[]) => (
    <ul className="world-card-grid">
      {rows.map((record) => {
        const book = record.home ? seriesBookLabel(record.home) : null;
        const kind = record.type === "worldbuilding" ? worldbuildingKindFromFields(record.fields) : null;
        return (
          <li key={record.id} className="world-card panel">
            <div className="world-card-head">
              <WorldRecordIcon type={record.type} kind={kind} />
              <Link href={`${base}/records/${encodeURIComponent(record.id)}`} className="world-card-title">
                {record.title}
              </Link>
            </div>
            <p className="small muted">
              {categoryLabel(record.type)}
              {taxonomyPrimaryLabel(record) ? ` · ${taxonomyPrimaryLabel(record)}` : ""}
              {scopeBadge(record) ? ` · ${scopeBadge(record)}` : ""}
            </p>
            <div className="row" style={{ flexWrap: "wrap", gap: "0.35rem" }}>
              <CanonBadge status={record.authorityStatus} />
              {secondaryLabels(record, customCategories).map((label) => (
                <span key={label} className="badge badge-muted">
                  + {label}
                </span>
              ))}
              {book && record.home ? (
                <span className="small">
                  {SERIES.homeBadge(book)}{" "}
                  <Link href={seriesRecordHref(record.home.projectId, record.id)}>{SERIES.editIn(book)}</Link>
                </span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );

  const discoveryEmpty =
    hubRecords.length === 0 ? (
      <EmptyState as="div">
        {WORLD.emptyWorld}
        <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem", marginTop: "0.65rem" }}>
          <ButtonLink href={`${base}/world/new`}>{WORLD.newReference}</ButtonLink>
          <ButtonLink variant="secondary" href={`${base}/import-markdown`}>
            {WORLD.importReferences}
          </ButtonLink>
        </div>
      </EmptyState>
    ) : (
      <EmptyState as="div">
        {activeCollection ? SMART_COLLECTIONS.worldEmptyMatches : emptyMessage(query, hubRecords.length)}
        <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem", marginTop: "0.65rem" }}>
          {activeCollection ? (
            <>
              <ButtonLink
                href={worldHubHref(projectId, {
                  ...worldHubQueryFromCollectionFilter(activeCollection.filter),
                  list: true,
                  collection: activeCollection.id,
                })}
              >
                {SMART_COLLECTIONS.worldOpen}
              </ButtonLink>
              <ButtonLink variant="secondary" href={worldHref(projectId, { list: true })}>
                {SMART_COLLECTIONS.worldAllReferences}
              </ButtonLink>
            </>
          ) : categoryForCreate ? (
            <ButtonLink href={newHref}>{WORLD.newInCategory(categoryForCreate.label)}</ButtonLink>
          ) : (
            <ButtonLink href={`${base}/world/new`}>{WORLD.newReference}</ButtonLink>
          )}
          {!activeCollection ? (
            <>
              <ButtonLink variant="secondary" href={worldHref(projectId)}>
                {WORLD.clearFilters}
              </ButtonLink>
              <ButtonLink variant="secondary" href={`${base}/world/organize`}>
                {WORLD.organizeReferences}
              </ButtonLink>
            </>
          ) : null}
        </div>
      </EmptyState>
    );

  return (
    <>
      <LandingHeader
        projectId={projectId}
        title={showHub ? SHELL.world : query.q ? WORLD.resultsFor(query.q) : listTitle}
        coverTitle={project.title}
        eyebrow={eyebrow}
        coverSrc={coverHash ? `${base}/cover?v=${coverHash}` : null}
        description={showHub ? WORLD.hubLead : GROUP_PAGES.world}
        gettingStarted={showHub ? <ProjectOnboarding projectId={projectId} quiet marked /> : undefined}
        actions={newReference}
        breadcrumbs={
          !showHub ? (
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
        <div className="world-hub-layout world-hub-with-nav pt-10">
          <aside className="world-hub-aside">{categoryNav}</aside>
          <div className="world-hub-main">
            <SearchPanel
              action={worldHref(projectId)}
              label={WORLD.searchReferences}
              inputId="world-hub-q"
              submitLabel={WORLD.search}
              hint={WORLD.hubSearchHint}
              defaultValue={query.q}
              className="world-hub-search"
            >
              {searchHiddenCollection}
            </SearchPanel>
            <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
              <ButtonLink href={`${base}/world/organize`} variant="secondary">
                {WORLD.organizeReferences}
              </ButtonLink>
              <ButtonLink href={worldHref(projectId, { list: true })} variant="secondary">
                {WORLD.viewAllReferences}
              </ButtonLink>
            </div>
            {collectionsPanel}
            <WorldCategoryManager projectId={projectId} categories={customCategories} />
            <WorldRecentAccessed projectId={projectId} knownIds={knownIds} />
            <section aria-labelledby="world-updated-heading">
              <div className="world-section-head">
                <h2 id="world-updated-heading">{WORLD.recentUpdated}</h2>
                <Link href={worldHref(projectId, { list: true })}>{WORLD.viewAllReferences}</Link>
              </div>
              {recentUpdated.length === 0 ? (
                <EmptyState>{WORLD.noRecent}</EmptyState>
              ) : (
                <ul className="world-recent">
                  {recentUpdated.map((record) => {
                    const kind = record.type === "worldbuilding" ? worldbuildingKindFromFields(record.fields) : null;
                    const kindLabel =
                      record.type === "worldbuilding" ? worldKindDisplayFromFields(record.fields) : null;
                    const book = record.home ? seriesBookLabel(record.home) : null;
                    return (
                      <li key={record.id}>
                        <span className="world-recent-icon">
                          <WorldRecordIcon type={record.type} kind={kind} />
                        </span>
                        <Link className="world-recent-title" href={`${base}/records/${encodeURIComponent(record.id)}`}>
                          {record.title}
                        </Link>
                        <p className="world-recent-meta small muted">
                          {categoryLabel(record.type)}
                          {kindLabel ? ` · ${kindLabel}` : ""}
                          {taxonomyPrimaryLabel(record) ? ` · ${taxonomyPrimaryLabel(record)}` : ""}
                          {book ? ` · ${SERIES.homeBadge(book)}` : ""}
                          {" · "}
                          {new Date(record.updatedAt).toLocaleString(undefined, { dateStyle: "medium" })}
                        </p>
                        <span className="world-recent-status">
                          <CanonBadge status={record.authorityStatus} />
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
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
          <WorldDirectory projectId={projectId} current="references" rail heading={WORLD.toolsAndSpaces} />
        </div>
      ) : (
        <div className="world-hub-layout world-hub-with-nav pt-10">
          <aside className="world-hub-aside">{categoryNav}</aside>
          <div className="world-hub-main">
            <SearchPanel
              action={worldHref(projectId)}
              label={WORLD.searchReferences}
              inputId="world-hub-q"
              submitLabel={WORLD.search}
              hint={WORLD.hubSearchHint}
              defaultValue={query.q}
              className="world-hub-search"
            >
              {searchHiddenCollection}
            </SearchPanel>
            <WorldHubFilters
              projectId={projectId}
              query={query}
              tags={tags}
              collectionId={activeCollection?.id ?? null}
            />
            {collectionsPanel}
            {query.type === "worldbuilding" || query.kind ? (
              <WorldKindBrowse
                projectId={projectId}
                type={query.type}
                kind={query.kind}
                searching={!!query.q}
                kindCounts={kindCounts}
              />
            ) : null}
            <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
              <Link href={worldHref(projectId)}>{query.q ? WORLD.clearSearch : WORLD.clearFilters}</Link>
              {categoryForCreate ? (
                <Link href={newHref}>{WORLD.newInCategory(categoryForCreate.label)}</Link>
              ) : null}
              <Link href={`${base}/world/organize`}>{WORLD.organizeReferences}</Link>
            </div>
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
              <section className="panel" aria-label={WORLD.resultsFor(query.q)}>
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
                              <Link href={seriesRecordHref(h.seriesHome.projectId, h.id)}>
                                {SERIES.editIn(seriesBookLabel(h.seriesHome))}
                              </Link>
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

            {!query.q ? (
              <section className="panel" aria-labelledby="world-list-heading">
                <div className="world-section-head">
                  <h2 id="world-list-heading">{listTitle}</h2>
                  <Link
                    href={worldHubHref(projectId, {
                      ...query,
                      view: query.view === "cards" ? "list" : "cards",
                      collection: activeCollection?.id ?? null,
                    })}
                  >
                    {query.view === "cards" ? WORLD.viewList : WORLD.viewCards}
                  </Link>
                </div>
                {discovered.length === 0
                  ? discoveryEmpty
                  : query.view === "cards"
                    ? renderRecordCards(discovered)
                    : renderRecordTable(discovered)}
                {discovered.some((record) => record.home) && !discovered.some((record) => !record.home) ? (
                  <p className="small muted">{WORLD.seriesOnlyNote}</p>
                ) : null}
              </section>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
