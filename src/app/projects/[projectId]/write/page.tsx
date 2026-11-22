import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { WritingProgressStrip } from "@/components/writing/WritingProgressStrip";
import { WritingSessionInit } from "@/components/writing/WritingSessionInit";
import { MarkRewriteCompleteButton, StartAuthorRewriteButton, WriteDraftSwitcher } from "@/components/drafts/DraftControls";
import { ProjectOnboarding } from "@/components/shell/ProjectOnboarding";
import { type CorkboardCard, type CorkboardGroup } from "@/components/write/Corkboard";
import {
  ManuscriptOutline,
  type OutlineChapter,
  type OutlineNote,
  type OutlineScene,
  type OutlinerRow,
} from "@/components/write/ManuscriptOutline";
import { RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import { getDb } from "@/server/db";
import { readWriteDraftCookie, resolveWriteDraftId } from "@/server/draftSelection";
import { listContinuityLedger } from "@/server/services/continuityService";
import { listProjectCoverHashes } from "@/server/services/coverService";
import { listManuscriptDrafts } from "@/server/services/draftService";
import { listSynopsesForRecords } from "@/server/services/manuscriptAnnotationService";
import { findProject } from "@/server/services/projectService";
import { listRecordNav, listRecords } from "@/server/services/recordService";
import { countOpenReviewItems } from "@/server/services/reviewService";
import { searchManuscript, type ManuscriptHit } from "@/server/services/searchService";
import { listChapterWritingGoals } from "@/server/services/writingGoalService";
import { buildWritingProgress } from "@/server/services/writingProgressService";
import { MANUSCRIPT_REPLACE, MANUSCRIPT_SEARCH, NAV, SHELL, SMART_COLLECTIONS, STYLE_CHECK, WRITE, WRITING_GOALS } from "@/ui/labels";
import { manuscriptEyebrow } from "@/ui/library";
import { buildManuscriptTree } from "@/ui/manuscriptTree";
import type { RecordNavEntry } from "@/ui/navigation";
import { readManuscriptMeta } from "@/writing/manuscriptStructure";
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
  const cookieStore = await cookies();
  const sessionRaw = cookieStore.get("wordly-writing-session")?.value;
  const sessionSince = sessionRaw ? new Date(decodeURIComponent(sessionRaw)) : null;
  const [nav, records, search, coverHashes, openReviewItems, progress, chapterGoals, continuityItems, primaryLocations] =
    await Promise.all([
      listRecordNav(db, projectId, { hasDrafts, draftId: activeDraftId }),
      listRecords(db, projectId),
      q ? searchManuscript(db, { projectId, query: q, matchCase, hasDrafts, draftId: activeDraftId }) : null,
      listProjectCoverHashes(db, [projectId]),
      countOpenReviewItems(db, projectId),
      buildWritingProgress(db, {
        projectId,
        hasDrafts,
        draftId: activeDraftId,
        sessionSince: sessionSince && !Number.isNaN(sessionSince.getTime()) ? sessionSince : null,
      }),
      listChapterWritingGoals(db, projectId),
      listContinuityLedger(db, projectId).catch(() => []),
      db.sceneLocation.findMany({
        where: { projectId, isPrimary: true },
        select: {
          manuscriptRecordId: true,
          location: { select: { title: true, trashedAt: true } },
        },
      }),
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
      revision: record.currentRevision,
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
  const unplacedScenes = outline.unplaced;
  const unplaced = unplacedScenes.flatMap((scene) => {
    const placed = item(scene.id, scene.title);
    return placed ? [placed] : [];
  });
  const synopsisById = await listSynopsesForRecords(
    db,
    projectId,
    nav.filter((r) => r.type === "manuscript_chapter" || r.type === "manuscript_scene").map((r) => r.id),
  );
  const corkboard = buildCorkboard(outline, byId, synopsisById);
  const goalByChapter = new Map(
    chapterGoals.filter((g) => g.recordId).map((g) => [g.recordId!, g.targetWords] as const),
  );
  const continuityByRecord = new Map<string, number>();
  for (const item of continuityItems) {
    if (!item.recordId) continue;
    continuityByRecord.set(item.recordId, (continuityByRecord.get(item.recordId) ?? 0) + 1);
  }
  const locationByRecord = new Map<string, string>();
  for (const row of primaryLocations) {
    if (row.location.trashedAt) continue;
    locationByRecord.set(row.manuscriptRecordId, row.location.title);
  }
  const outlinerRows = buildOutlinerRows(outline, byId, synopsisById, goalByChapter, continuityByRecord, locationByRecord);
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
    <>
      <WritingSessionInit />
    <ManuscriptOutline
      projectId={projectId}
      title={project.title}
      eyebrow={manuscriptEyebrow(project.seriesName, project.workspace.name)}
      coverSrc={coverHash ? `${base}/cover?v=${coverHash}` : null}
      description={WRITE.landingLead}
      afterLead={<WritingProgressStrip projectId={projectId} progress={progress} />}
      chapters={outline.chapters}
      unplaced={outline.unplaced}
      looseNotes={outline.looseNotes}
      synopsisById={synopsisById}
      corkboardGroups={corkboard.groups}
      corkboardUnplaced={corkboard.unplaced}
      outlinerRows={outlinerRows}
      draftId={activeDraftId}
      initialQuery={q}
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
      gettingStarted={<ProjectOnboarding projectId={projectId} quiet marked empty={empty} />}
    />
    </>
  );
}

function buildOutlinerRows(
  outline: { chapters: OutlineChapter[]; unplaced: OutlineScene[] },
  byId: Map<
    string,
    {
      fields: Record<string, unknown>;
      body: string;
      protected: boolean;
      currentRevision: number;
    }
  >,
  synopsisById: Map<string, string>,
  goalByChapter: Map<string, number>,
  continuityByRecord: Map<string, number>,
  locationByRecord: Map<string, string>,
): OutlinerRow[] {
  const rows: OutlinerRow[] = [];
  const push = (
    recordId: string,
    title: string,
    type: "manuscript_chapter" | "manuscript_scene",
    chapterTitle: string | null,
    number: string | null,
    parentRecordId: string | null,
  ) => {
    const record = byId.get(recordId);
    if (!record) return;
    const meta = readManuscriptMeta(record.fields);
    rows.push({
      recordId,
      title,
      type,
      chapterTitle,
      number,
      synopsis: synopsisById.get(recordId) ?? "",
      pov: meta.pov,
      sceneStatus: meta.sceneStatus,
      words: countWords(record.body),
      wordTarget: type === "manuscript_chapter" ? (goalByChapter.get(recordId) ?? null) : null,
      locationTitle: locationByRecord.get(recordId) ?? null,
      continuityOpen: continuityByRecord.get(recordId) ?? 0,
      isProtected: record.protected,
      revision: record.currentRevision,
      parentRecordId,
    });
  };
  for (const chapter of outline.chapters) {
    push(chapter.id, chapter.title, "manuscript_chapter", null, chapter.number, null);
    for (const scene of chapter.scenes) {
      push(scene.id, scene.title, "manuscript_scene", chapter.title, null, chapter.id);
    }
  }
  for (const scene of outline.unplaced) {
    push(scene.id, scene.title, "manuscript_scene", null, null, null);
  }
  return rows;
}

function buildCorkboard(
  outline: { chapters: OutlineChapter[]; unplaced: OutlineScene[] },
  byId: Map<string, { fields: Record<string, unknown> }>,
  synopsisById: Map<string, string>,
): { groups: CorkboardGroup[]; unplaced: CorkboardCard[] } {
  const card = (recordId: string, title: string, type: string, parentRecordId: string | null): CorkboardCard | null => {
    const record = byId.get(recordId);
    if (!record) return null;
    const meta = readManuscriptMeta(record.fields);
    return {
      recordId,
      title,
      type,
      synopsis: synopsisById.get(recordId) ?? "",
      pov: meta.pov,
      sceneStatus: meta.sceneStatus,
      parentRecordId,
    };
  };
  const groups = outline.chapters.flatMap((chapter) => {
    const chapterCard = card(chapter.id, chapter.title, "manuscript_chapter", null);
    if (!chapterCard) return [];
    return [
      {
        chapter: chapterCard,
        scenes: chapter.scenes.flatMap((scene) => {
          const sceneCard = card(scene.id, scene.title, "manuscript_scene", chapter.id);
          return sceneCard ? [sceneCard] : [];
        }),
      },
    ];
  });
  const unplaced = outline.unplaced.flatMap((scene) => {
    const sceneCard = card(scene.id, scene.title, "manuscript_scene", null);
    return sceneCard ? [sceneCard] : [];
  });
  return { groups, unplaced };
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
        { href: `${base}/search`, label: NAV.projectSearch },
        { href: `${base}/cross-references`, label: NAV.crossRefCheck },
        { href: `${base}/write/scrivenings`, label: WRITE.scrivenings },
        { href: `${base}/write/replace`, label: MANUSCRIPT_REPLACE.heading },
        { href: `${base}/write/style`, label: STYLE_CHECK.heading },
        { href: `${base}/write/goals`, label: WRITING_GOALS.heading },
        { href: `${base}/write/collections`, label: SMART_COLLECTIONS.heading },
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
        <p className="small">
          <Link
            href={`${base}/write/replace?${new URLSearchParams({
              find: query,
              ...(matchCase ? { case: "1" } : {}),
            })}`}
          >
            {MANUSCRIPT_SEARCH.replaceAcross}
          </Link>
        </p>
      ) : null}
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
