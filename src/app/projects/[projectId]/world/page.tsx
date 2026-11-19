import Link from "next/link";
import { CanonBadge, ProtectionStateBadge, SavedVersionBadge } from "@/components/Badges";
import { OverflowDisclosure } from "@/components/shell/OverflowDisclosure";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { WorldSurfaceNav } from "@/components/world/WorldSurfaceNav";
import { stableStringify } from "@/domain/json";
import { getDb } from "@/server/db";
import { listRecords } from "@/server/services/recordService";
import { searchProjectRecords, type SearchHit } from "@/server/services/searchService";
import { getSpellingLanguage } from "@/server/spelling";
import { GROUP_PAGES, RECORD, SHELL, WORLD } from "@/ui/labels";
import { categoryLabel, isWorldType, WORLD_CATEGORY_LABELS, WORLD_TYPES, worldHref } from "@/ui/world";
import { NewRecordForm } from "../NewRecordForm";

export const dynamic = "force-dynamic";

export default async function WorldPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ type?: string; q?: string; list?: string }>;
}) {
  const { projectId } = await params;
  const query = await searchParams;
  const type = isWorldType(query.type) ? query.type : null;
  const q = (query.q ?? "").trim();
  const list = query.list === "1";
  const db = getDb();
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const [records, hits, spellingLanguage] = await Promise.all([
    listRecords(db, projectId),
    q ? searchProjectRecords(db, { projectId, query: q, types: WORLD_TYPES, includeManuscript: false }) : null,
    getSpellingLanguage(),
  ]);
  const worldRecords = records.filter((r) => isWorldType(r.type));
  const listed = type ? worldRecords.filter((r) => r.type === type) : worldRecords;
  const recent = [...worldRecords]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || a.title.localeCompare(b.title))
    .slice(0, 8);
  const showHub = !type && !q && !list;
  const byId = new Map(records.map((r) => [r.id, r]));
  const startsMidText = (hit: SearchHit): boolean => {
    const record = byId.get(hit.id);
    if (!hit.excerptTruncated || !record) return false;
    const source = hit.matchedIn === "title" ? record.title : hit.matchedIn === "body" ? record.body : stableStringify(record.fields);
    return !source.normalize("NFC").startsWith(hit.excerpt);
  };
  const selection = type ? `type=${type}` : "group=world";
  const exportHref = `${base}/export?${selection}`;
  const pdfHref = `${base}/export-pdf?${selection}`;
  const crumb = q ? WORLD.search : type ? WORLD_CATEGORY_LABELS[type] : WORLD.allReferencesList;

  return (
    <>
      {type || q || list ? (
        <nav aria-label={WORLD.breadcrumb} className="breadcrumbs">
          <ol>
            <li>
              <Link href={worldHref(projectId)}>{SHELL.world}</Link>
            </li>
            <li>
              <span aria-current="page">{crumb}</span>
            </li>
          </ol>
        </nav>
      ) : null}
      <div className="page-head">
        <h1>{q ? WORLD.resultsFor(q) : type ? WORLD_CATEGORY_LABELS[type] : list ? WORLD.allReferencesList : SHELL.world}</h1>
      </div>
      <p className="page-lead">{showHub ? WORLD.hubLead : GROUP_PAGES.world}</p>
      <WorldSurfaceNav projectId={projectId} current="references" />

      {showHub ? (
        <>
          <form role="search" action={worldHref(projectId)} method="get" className="panel world-hub-search" aria-label={WORLD.searchReferences}>
            <label htmlFor="world-hub-q">{WORLD.searchReferences}</label>
            <div className="row">
              <input id="world-hub-q" type="search" name="q" placeholder={WORLD.searchReferences} />
              <button type="submit">{WORLD.search}</button>
            </div>
            <p className="small muted">{WORLD.searchHint}</p>
          </form>
          <section className="panel" aria-labelledby="world-recent-heading">
            <h2 id="world-recent-heading">{WORLD.recentReferences}</h2>
            {recent.length === 0 ? (
              <p className="muted">{WORLD.noRecent}</p>
            ) : (
              <ul className="world-recent">
                {recent.map((r) => (
                  <li key={r.id}>
                    <Link href={`${base}/records/${encodeURIComponent(r.id)}`}>{r.title}</Link>
                    <span className="small muted">{categoryLabel(r.type)}</span>
                    <CanonBadge status={r.authorityStatus} />
                    <span className="small muted">{r.updatedAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="small">
              <Link href={worldHref(projectId, { list: true })}>{WORLD.allReferencesList}</Link>
            </p>
          </section>
        </>
      ) : null}

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
            {type ? WORLD_CATEGORY_LABELS[type] : WORLD.allReferences}
          </h2>
          {listed.length === 0 ? (
            <p className="muted">{WORLD.noReferences}</p>
          ) : (
            <table className="record-table world-table">
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  {type ? null : <th scope="col">{WORLD.documentType}</th>}
                  <th scope="col">{WORLD.canonStatus}</th>
                  <th scope="col">{WORLD.savedVersion}</th>
                  <th scope="col">{WORLD.protection}</th>
                </tr>
              </thead>
              <tbody>
                {listed.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`${base}/records/${encodeURIComponent(r.id)}`}>{r.title}</Link>
                    </td>
                    {type ? null : <td className="small">{categoryLabel(r.type)}</td>}
                    <td>
                      <CanonBadge status={r.authorityStatus} />
                    </td>
                    <td>
                      <SavedVersionBadge revision={r.currentRevision} />
                    </td>
                    <td>
                      <ProtectionStateBadge isProtected={r.protected} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}

      <OverflowDisclosure summary={SHELL.newRecord} className="panel">
        <h2 className="sr-only">{RECORD.newRecordHeading}</h2>
        <NewRecordForm projectId={projectId} spellingLanguage={spellingLanguage} defaultType={type ?? "character_dossier"} />
      </OverflowDisclosure>
    </>
  );
}
