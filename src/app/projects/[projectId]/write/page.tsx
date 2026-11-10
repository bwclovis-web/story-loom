import Link from "next/link";
import { RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import { getDb } from "@/server/db";
import { listRecordNav, listRecords } from "@/server/services/recordService";
import { searchManuscript, type ManuscriptHit } from "@/server/services/searchService";
import { GROUP_PAGES, MANUSCRIPT_SEARCH, NAV, SHELL } from "@/ui/labels";
import { buildManuscriptTree, type TreeScene } from "@/ui/manuscriptTree";
import { RECORD_GROUPS } from "@/ui/navigation";
import { countWords } from "@/writing/wordCount";
import { RecordListPage } from "../RecordListPage";
import { BookOrder, type OrderItem } from "./BookOrder";

export const dynamic = "force-dynamic";

export default async function WritePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ q?: string; case?: string }>;
}) {
  const { projectId } = await params;
  const query = await searchParams;
  const q = (query.q ?? "").trim();
  const matchCase = query.case === "1";
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const db = getDb();
  const [nav, records, search] = await Promise.all([
    listRecordNav(db, projectId),
    listRecords(db, projectId),
    q ? searchManuscript(db, { projectId, query: q, matchCase }) : null,
  ]);

  const byId = new Map(records.map((r) => [r.id, r]));
  const item = (s: TreeScene): OrderItem => {
    const r = byId.get(s.id)!;
    return { id: r.id, title: r.title, words: countWords(r.body), authorityStatus: r.authorityStatus, isProtected: r.protected };
  };
  const tree = buildManuscriptTree(nav.filter((n) => byId.has(n.id)));
  const chapters = tree.chapters.map((c) => ({ ...item(c), scenes: c.scenes.map(item) }));
  const unplaced = tree.unplaced.map(item);
  const bookWords = [...chapters.flatMap((c) => [c, ...c.scenes]), ...unplaced].reduce((sum, r) => sum + r.words, 0);

  return (
    <RecordListPage
      projectId={projectId}
      heading={SHELL.write}
      lead={GROUP_PAGES.write}
      types={RECORD_GROUPS.write}
      defaultType="manuscript_chapter"
      hideTypes={["manuscript_chapter", "manuscript_scene"]}
      actions={
        <p className="row">
          <Link className="button-link" href={`${base}/read`}>
            {NAV.readBook}
          </Link>
          <Link className="button-link secondary" href={`${base}/import-chapters`}>
            {NAV.importChapters}
          </Link>
        </p>
      }
    >
      <form role="search" method="get" action={`${base}/write`} className="panel manuscript-search" aria-label={MANUSCRIPT_SEARCH.label}>
        <label className="sr-only" htmlFor="manuscript-search-q">
          {MANUSCRIPT_SEARCH.label}
        </label>
        <input id="manuscript-search-q" type="search" name="q" defaultValue={q} placeholder={MANUSCRIPT_SEARCH.label} />
        <label className="inline">
          <input type="checkbox" name="case" value="1" defaultChecked={matchCase} />
          {MANUSCRIPT_SEARCH.matchCase}
        </label>
        <button type="submit">{MANUSCRIPT_SEARCH.submit}</button>
      </form>
      {search ? (
        <SearchResults base={base} query={q} matchCase={matchCase} hits={search.hits} totalMatches={search.totalMatches} />
      ) : null}
      <BookOrder projectId={projectId} chapters={chapters} unplaced={unplaced} bookWords={bookWords} />
    </RecordListPage>
  );
}

function SearchResults({
  base,
  query,
  matchCase,
  hits,
  totalMatches,
}: {
  base: string;
  query: string;
  matchCase: boolean;
  hits: ManuscriptHit[];
  totalMatches: number;
}) {
  const findHref = (id: string) =>
    `${base}/records/${encodeURIComponent(id)}?${new URLSearchParams({ find: query, ...(matchCase ? { case: "1" } : {}) })}`;
  return (
    <section className="panel" aria-labelledby="manuscript-search-heading">
      <h2 id="manuscript-search-heading">{MANUSCRIPT_SEARCH.heading(query)}</h2>
      <p className="small">
        {hits.length ? MANUSCRIPT_SEARCH.summary(totalMatches, hits.length) : MANUSCRIPT_SEARCH.none}{" "}
        <Link href={`${base}/write`}>{MANUSCRIPT_SEARCH.clear}</Link>
      </p>
      <p className="small muted">{MANUSCRIPT_SEARCH.note}</p>
      {hits.length ? (
        <ul className="search-hits">
          {hits.map((h) => (
            <li key={h.id}>
              <div className="row">
                <Link href={`${base}/records/${encodeURIComponent(h.id)}`} className="hit-title">
                  {h.title}
                </Link>
                <span className="small muted">
                  {RECORD_TYPE_LABELS[h.type]}
                  {h.parentTitle ? ` ${MANUSCRIPT_SEARCH.inParent(h.parentTitle)}` : ""}
                </span>
                <span className="small">{h.count ? MANUSCRIPT_SEARCH.matchesHere(h.count) : MANUSCRIPT_SEARCH.titleOnly}</span>
                {h.count && h.type !== "scene_note" ? (
                  <Link className="small" href={findHref(h.id)} aria-label={MANUSCRIPT_SEARCH.openWithFindLabel(h.title)}>
                    {MANUSCRIPT_SEARCH.openWithFind}
                  </Link>
                ) : null}
              </div>
              {h.excerpts.length ? (
                <ul className="hit-excerpts small">
                  {h.excerpts.map((e, i) => (
                    <li key={i}>
                      {e.cutBefore ? <span className="muted">&hellip; </span> : null}
                      {e.before}
                      <mark>{e.match}</mark>
                      {e.after}
                      {e.cutAfter ? <span className="muted"> &hellip;</span> : null}
                    </li>
                  ))}
                  {h.count > h.excerpts.length ? (
                    <li className="muted">{MANUSCRIPT_SEARCH.more(h.count - h.excerpts.length)}</li>
                  ) : null}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
