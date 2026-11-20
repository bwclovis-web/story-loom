import Link from "next/link";
import { notFound } from "next/navigation";
import { MarkRewriteCompleteButton, StartAuthorRewriteButton, WriteDraftSwitcher } from "@/components/drafts/DraftControls";
import { ProjectOnboarding } from "@/components/shell/ProjectOnboarding";
import { ManuscriptOutline, type OutlineChapter, type OutlineNote, type OutlineScene } from "@/components/write/ManuscriptOutline";
import { RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import { getDb } from "@/server/db";
import { readWriteDraftCookie, resolveWriteDraftId } from "@/server/draftSelection";
import { listProjectCoverHashes } from "@/server/services/coverService";
import { listManuscriptDrafts } from "@/server/services/draftService";
import { findProject } from "@/server/services/projectService";
import { listRecordNav, listRecords } from "@/server/services/recordService";
import { countOpenReviewItems } from "@/server/services/reviewService";
import { searchManuscript, type ManuscriptHit } from "@/server/services/searchService";
import { MANUSCRIPT_SEARCH, NAV, SHELL } from "@/ui/labels";
import { manuscriptEyebrow } from "@/ui/library";
import { buildManuscriptTree } from "@/ui/manuscriptTree";
import type { RecordNavEntry } from "@/ui/navigation";
import { countWords } from "@/writing/wordCount";
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
  const project = await findProject(db, projectId);
  if (!project) notFound();
  const drafts = await listManuscriptDrafts(db, projectId);
  const activeDraftId = resolveWriteDraftId(drafts, await readWriteDraftCookie());
  const hasDrafts = drafts.length > 0;
  const [nav, records, search, coverHashes, openReviewItems] = await Promise.all([
    listRecordNav(db, projectId, { hasDrafts, draftId: activeDraftId }),
    listRecords(db, projectId),
    q ? searchManuscript(db, { projectId, query: q, matchCase, hasDrafts, draftId: activeDraftId }) : null,
    listProjectCoverHashes(db, [projectId]),
    countOpenReviewItems(db, projectId),
  ]);

  const byId = new Map(records.map((record) => [record.id, record]));
  const item = (id: string, title: string): OrderItem | null => {
    const record = byId.get(id);
    if (!record) return null;
    return {
      id,
      title,
      words: countWords(record.body),
      authorityStatus: record.authorityStatus,
      isProtected: record.protected,
    };
  };
  const outline = buildOutline(nav);
  const chapters = outline.chapters.flatMap((chapter) => {
    const row = item(chapter.id, chapter.title);
    if (!row) return [];
    return [{ ...row, scenes: chapter.scenes.flatMap((scene) => {
      const placed = item(scene.id, scene.title);
      return placed ? [placed] : [];
    }) }];
  });
  const unplaced = outline.unplaced.flatMap((scene) => {
    const placed = item(scene.id, scene.title);
    return placed ? [placed] : [];
  });
  const bookWords = [...chapters.flatMap((chapter) => [chapter, ...chapter.scenes]), ...unplaced].reduce(
    (sum, record) => sum + record.words,
    0,
  );
  const activeDraft = drafts.find((draft) => draft.id === activeDraftId) ?? null;
  const authorDraft = activeDraft?.kind === "author_manuscript" ? activeDraft : null;
  const showStart = !drafts.some((draft) => draft.kind === "author_manuscript");
  const coverHash = coverHashes.get(projectId) ?? null;
  const empty = outline.chapters.length === 0 && outline.unplaced.length === 0 && outline.looseNotes.length === 0;

  return (
    <ManuscriptOutline
      projectId={projectId}
      title={project.title}
      eyebrow={manuscriptEyebrow(project.seriesName, project.workspace.name)}
      coverSrc={coverHash ? `${base}/cover?v=${coverHash}` : null}
      chapters={outline.chapters}
      unplaced={outline.unplaced}
      looseNotes={outline.looseNotes}
      draftId={activeDraftId}
      initialQuery={q}
      matchCase={matchCase}
      headerActions={
        hasDrafts ? (
          <WriteDraftSwitcher
            projectId={projectId}
            drafts={drafts.map((draft) => ({
              id: draft.id,
              kind: draft.kind,
              label: draft.label,
              completedAt: draft.completedAt?.toISOString() ?? null,
            }))}
            activeDraftId={activeDraftId}
          />
        ) : null
      }
      overflow={
        <>
          {showStart ? <StartAuthorRewriteButton projectId={projectId} /> : null}
          {authorDraft ? (
            <MarkRewriteCompleteButton
              projectId={projectId}
              draftId={authorDraft.id}
              completed={!!authorDraft.completedAt}
            />
          ) : null}
          <section className="outline-tool" aria-label={SHELL.bookOrder}>
            <h2>{SHELL.bookOrder}</h2>
            <BookOrder projectId={projectId} chapters={chapters} unplaced={unplaced} bookWords={bookWords} />
          </section>
          <ProjectTools base={base} openReviewItems={openReviewItems} />
        </>
      }
      results={
        search ? (
          <SearchResults base={base} query={q} matchCase={matchCase} hits={search.hits} totalMatches={search.totalMatches} />
        ) : null
      }
      gettingStarted={<ProjectOnboarding projectId={projectId} quiet empty={empty} />}
    />
  );
}

function buildOutline(nav: readonly RecordNavEntry[]): {
  chapters: OutlineChapter[];
  unplaced: OutlineScene[];
  looseNotes: OutlineNote[];
} {
  const notes = nav.filter((record) => record.type === "scene_note");
  const tree = buildManuscriptTree(nav.filter((record) => record.type === "manuscript_chapter" || record.type === "manuscript_scene"));
  const notesFor = (parentId: string): OutlineNote[] =>
    notes.filter((note) => note.parentRecordId === parentId).map((note) => ({ id: note.id, title: note.title }));
  const chapters = tree.chapters.map((chapter, index) => ({
    id: chapter.id,
    title: chapter.title,
    number: String(index + 1).padStart(2, "0"),
    scenes: chapter.scenes.map((scene) => ({ id: scene.id, title: scene.title, notes: notesFor(scene.id) })),
    notes: notesFor(chapter.id),
  }));
  const unplaced = tree.unplaced.map((scene) => ({ id: scene.id, title: scene.title, notes: notesFor(scene.id) }));
  const placed = new Set<string>([
    ...chapters.flatMap((chapter) => [chapter.id, ...chapter.scenes.map((scene) => scene.id)]),
    ...unplaced.map((scene) => scene.id),
  ]);
  const looseNotes = notes
    .filter((note) => !note.parentRecordId || !placed.has(note.parentRecordId))
    .map((note) => ({ id: note.id, title: note.title }));
  return { chapters, unplaced, looseNotes };
}

function ProjectTools({ base, openReviewItems }: { base: string; openReviewItems: number }) {
  const groups = [
    {
      heading: SHELL.toolsBringIn,
      items: [
        { href: `${base}/import`, label: NAV.importPackage },
        { href: `${base}/import-markdown`, label: NAV.importMarkdown },
      ],
    },
    {
      heading: SHELL.toolsReadExport,
      items: [
        { href: `${base}/export`, label: NAV.exportContext },
        { href: `${base}/export-pdf`, label: NAV.exportPdf },
      ],
    },
    {
      heading: SHELL.toolsMaintain,
      items: [
        { href: `${base}/history`, label: NAV.history, count: openReviewItems },
        { href: `${base}/dictionary`, label: NAV.dictionary },
        { href: `${base}/cross-references`, label: NAV.crossRefCheck },
        { href: `${base}/upgrade`, label: NAV.upgradeProject },
      ],
    },
  ];
  return (
    <nav className="outline-tools" aria-label={SHELL.projectTools}>
      {groups.map((group) => (
        <section key={group.heading}>
          <h2>{group.heading}</h2>
          <ul>
            {group.items.map((item) => (
              <li key={item.href}>
                <Link href={item.href}>
                  {item.label}
                  {"count" in item && item.count ? <span className="outline-tool-count">{item.count}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
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
    <section className="outline-results" aria-labelledby="manuscript-search-heading">
      <h2 id="manuscript-search-heading">{MANUSCRIPT_SEARCH.heading(query)}</h2>
      <p className="small">
        {hits.length ? MANUSCRIPT_SEARCH.summary(totalMatches, hits.length) : MANUSCRIPT_SEARCH.none}{" "}
        <Link href={`${base}/write`}>{MANUSCRIPT_SEARCH.clear}</Link>
      </p>
      <p className="small muted">{MANUSCRIPT_SEARCH.note}</p>
      {hits.length ? (
        <ul className="search-hits">
          {hits.map((hit) => (
            <li key={hit.id}>
              <div className="row">
                <Link href={`${base}/records/${encodeURIComponent(hit.id)}`} className="hit-title">
                  {hit.title}
                </Link>
                <span className="small muted">
                  {RECORD_TYPE_LABELS[hit.type]}
                  {hit.parentTitle ? ` ${MANUSCRIPT_SEARCH.inParent(hit.parentTitle)}` : ""}
                </span>
                <span className="small">{hit.count ? MANUSCRIPT_SEARCH.matchesHere(hit.count) : MANUSCRIPT_SEARCH.titleOnly}</span>
                {hit.count && hit.type !== "scene_note" ? (
                  <Link className="small" href={findHref(hit.id)} aria-label={MANUSCRIPT_SEARCH.openWithFindLabel(hit.title)}>
                    {MANUSCRIPT_SEARCH.openWithFind}
                  </Link>
                ) : null}
              </div>
              {hit.excerpts.length ? (
                <ul className="hit-excerpts small">
                  {hit.excerpts.map((excerpt, index) => (
                    <li key={index}>
                      {excerpt.cutBefore ? <span className="muted">&hellip; </span> : null}
                      {excerpt.before}
                      <mark>{excerpt.match}</mark>
                      {excerpt.after}
                      {excerpt.cutAfter ? <span className="muted"> &hellip;</span> : null}
                    </li>
                  ))}
                  {hit.count > hit.excerpts.length ? (
                    <li className="muted">{MANUSCRIPT_SEARCH.more(hit.count - hit.excerpts.length)}</li>
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
