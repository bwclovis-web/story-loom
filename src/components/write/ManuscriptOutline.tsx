"use client";

import Link from "next/link";
import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { BookCover } from "@/components/library/BookCover";
import { ChevronRightIcon, SearchIcon } from "@/components/shell/icons";
import { ManuscriptCreateForm } from "@/components/shell/ManuscriptTree";
import { Button, ButtonLink } from "@/components/ui/Button";
import { RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import { MANUSCRIPT_SEARCH, NAV, WRITE } from "@/ui/labels";

export type OutlineNote = { id: string; title: string };

export type OutlineScene = { id: string; title: string; notes: OutlineNote[] };

export type OutlineChapter = {
  id: string;
  title: string;
  /** Display number from book order, such as 01. */
  number: string;
  scenes: OutlineScene[];
  notes: OutlineNote[];
};

type Tab = "chapters" | "scenes";

/**
 * Write landing: one ordered outline. Chapter and scene titles open the editor.
 * The chevron only shows or hides that chapter's scenes.
 */
export function ManuscriptOutline({
  projectId,
  title,
  eyebrow,
  coverSrc,
  chapters,
  unplaced,
  looseNotes,
  draftId,
  initialQuery,
  matchCase,
  headerActions,
  overflow,
  results,
  gettingStarted,
}: {
  projectId: string;
  title: string;
  eyebrow: string;
  coverSrc: string | null;
  chapters: OutlineChapter[];
  unplaced: OutlineScene[];
  looseNotes: OutlineNote[];
  draftId: string | null;
  initialQuery: string;
  matchCase: boolean;
  headerActions: ReactNode;
  overflow: ReactNode;
  results: ReactNode;
  gettingStarted: ReactNode;
}) {
  const uid = useId();
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const [tab, setTab] = useState<Tab>("chapters");
  const [titleQuery, setTitleQuery] = useState(initialQuery);
  const [match, setMatch] = useState(matchCase);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [creating, setCreating] = useState<"chapter" | "scene" | null>(null);

  useEffect(() => setTitleQuery(initialQuery), [initialQuery]);
  useEffect(() => setMatch(matchCase), [matchCase]);

  const query = titleQuery.trim().toLocaleLowerCase();
  const filtering = query.length > 0;
  const chapterOptions = chapters.map((chapter) => ({ id: chapter.id, title: chapter.title }));

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const order: Tab[] = ["chapters", "scenes"];
    const index = order.indexOf(tab);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % order.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + order.length) % order.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = order.length - 1;
    else return;
    event.preventDefault();
    const id = order[next]!;
    setTab(id);
    document.getElementById(`${uid}-tab-${id}`)?.focus();
  };

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const visibleChapters = filterChapters(chapters, query);
  const visibleUnplaced = filterScenes(unplaced, null, query);
  const visibleLoose = filterNotes(looseNotes, query);
  const unplacedHits = filtering
    ? unplaced.reduce((sum, scene) => sum + (keepScene(scene, null, query)?.matches ?? 0), 0)
    : 0;
  const chapterMatchCount =
    visibleChapters.reduce((sum, chapter) => sum + (chapter.matched ? 1 : 0) + chapter.sceneMatches + chapter.noteMatches, 0) +
    unplacedHits +
    visibleLoose.length;

  return (
    <div className="manuscript-outline">
      <header className="outline-header">
        <BookCover projectId={projectId} title={title} eyebrow={eyebrow} size="compact" coverSrc={coverSrc} />
        <div className="outline-heading">
          <p className="outline-eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
        </div>
        <div className="outline-header-actions">
          <Link className="outline-read" href={`${base}/read`}>
            {NAV.readBook}
          </Link>
          {headerActions}
        </div>
      </header>

      <div className="outline-tabs" role="tablist" aria-label={WRITE.manuscript}>
        <button
          type="button"
          className="outline-tab"
          id={`${uid}-tab-chapters`}
          role="tab"
          aria-selected={tab === "chapters"}
          aria-controls={`${uid}-panel-chapters`}
          tabIndex={tab === "chapters" ? 0 : -1}
          onClick={() => setTab("chapters")}
          onKeyDown={onTabKey}
        >
          {WRITE.chaptersTab}
        </button>
        <button
          type="button"
          className="outline-tab"
          id={`${uid}-tab-scenes`}
          role="tab"
          aria-selected={tab === "scenes"}
          aria-controls={`${uid}-panel-scenes`}
          tabIndex={tab === "scenes" ? 0 : -1}
          onClick={() => setTab("scenes")}
          onKeyDown={onTabKey}
        >
          {WRITE.scenesTab}
        </button>
      </div>

      <div className="outline-toolbar">
        <form className="outline-search" role="search" method="get" action={`${base}/write`} aria-label={MANUSCRIPT_SEARCH.label}>
          <label className="outline-search-field">
            <span className="sr-only">{WRITE.searchManuscript}</span>
            <SearchIcon />
            <input
              type="search"
              name="q"
              value={titleQuery}
              placeholder={WRITE.searchManuscript}
              aria-describedby={`${uid}-search-hint`}
              onChange={(event) => setTitleQuery(event.target.value)}
            />
          </label>
          <label className="outline-match">
            <input type="checkbox" name="case" value="1" checked={match} onChange={(event) => setMatch(event.target.checked)} />
            {MANUSCRIPT_SEARCH.matchCase}
          </label>
          <p className="outline-search-hint" id={`${uid}-search-hint`}>
            {WRITE.searchHint}
          </p>
          <button type="submit" className="sr-only">
            {MANUSCRIPT_SEARCH.submit}
          </button>
        </form>
        <div className="outline-actions">
          <ButtonLink variant="outline" size="sm" href={`${base}/import-chapters`}>
            {NAV.importChapters}
          </ButtonLink>
          <Button type="button" variant="outline" size="sm" onClick={() => setCreating((current) => (current === "scene" ? null : "scene"))}>
            {WRITE.newScene}
          </Button>
          <Button type="button" size="sm" onClick={() => setCreating((current) => (current === "chapter" ? null : "chapter"))}>
            {WRITE.newChapter}
          </Button>
        </div>
        <details className="outline-more">
          <summary>{WRITE.more}</summary>
          <div className="outline-more-panel">{overflow}</div>
        </details>
      </div>

      {creating ? (
        <ManuscriptCreateForm
          kind={creating}
          projectId={projectId}
          chapters={chapterOptions}
          defaultChapter={chapterOptions[0]?.id ?? null}
          draftId={draftId}
          onDone={() => setCreating(null)}
        />
      ) : null}

      {results}

      <div role="tabpanel" id={`${uid}-panel-chapters`} aria-labelledby={`${uid}-tab-chapters`} hidden={tab !== "chapters"}>
        {filtering ? <p className="outline-filter-count" role="status">{filterStatus(chapterMatchCount)}</p> : null}
        {visibleChapters.length === 0 && visibleUnplaced.length === 0 && visibleLoose.length === 0 ? (
          <p className="outline-empty">{filtering ? WRITE.noMatches : WRITE.noChapters}</p>
        ) : (
          <ol className="outline-chapters">
            {visibleChapters.map((chapter) => {
              const children = chapter.scenes.length + chapter.notes.length > 0;
              const open = children && (filtering || expanded.has(chapter.id));
              const scenesDomId = `${uid}-scenes-${chapter.id}`;
              return (
                <li key={chapter.id} className="outline-chapter">
                  <div className="outline-chapter-row">
                    <span className="outline-number">{chapter.number}</span>
                    <span className="outline-rule" aria-hidden="true" />
                    <div className="outline-chapter-copy">
                      <span className="outline-kind">{WRITE.chapterKind}</span>
                      <Link className="outline-chapter-title" href={recordHref(base, chapter.id)}>
                        {chapter.title}
                      </Link>
                    </div>
                    {children ? (
                      <button
                        type="button"
                        className="outline-disclose"
                        aria-expanded={open}
                        aria-controls={scenesDomId}
                        aria-label={open ? WRITE.hideScenes(chapter.title) : WRITE.showScenes(chapter.title)}
                        onClick={() => toggle(chapter.id)}
                      >
                        <ChevronRightIcon />
                      </button>
                    ) : (
                      <span className="outline-disclose-spacer" aria-hidden="true" />
                    )}
                  </div>
                  {children ? (
                    <ul className="outline-scenes" id={scenesDomId} hidden={!open}>
                      {chapter.scenes.map((scene) => (
                        <SceneRow key={scene.id} base={base} scene={scene} />
                      ))}
                      {chapter.notes.map((note) => (
                        <NoteRow key={note.id} base={base} note={note} />
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
        {visibleUnplaced.length ? (
          <section className="outline-extra" aria-label={WRITE.unplaced}>
            <h2>{WRITE.unplaced}</h2>
            <ul className="outline-scenes outline-scenes-flat">
              {visibleUnplaced.map((scene) => (
                <SceneRow key={scene.id} base={base} scene={scene} />
              ))}
            </ul>
          </section>
        ) : null}
        {visibleLoose.length ? (
          <section className="outline-extra" aria-label={WRITE.looseNotes}>
            <h2>{WRITE.looseNotes}</h2>
            <ul className="outline-scenes outline-scenes-flat">
              {visibleLoose.map((note) => (
                <NoteRow key={note.id} base={base} note={note} />
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <div role="tabpanel" id={`${uid}-panel-scenes`} aria-labelledby={`${uid}-tab-scenes`} hidden={tab !== "scenes"}>
        <SceneIndex
          base={base}
          chapters={chapters}
          unplaced={unplaced}
          looseNotes={looseNotes}
          query={query}
          filtering={filtering}
        />
      </div>

      {gettingStarted}
    </div>
  );
}

function SceneIndex({
  base,
  chapters,
  unplaced,
  looseNotes,
  query,
  filtering,
}: {
  base: string;
  chapters: OutlineChapter[];
  unplaced: OutlineScene[];
  looseNotes: OutlineNote[];
  query: string;
  filtering: boolean;
}) {
  const rows: ReactNode[] = [];
  let matches = 0;
  for (const chapter of chapters) {
    for (const scene of chapter.scenes) {
      const kept = keepScene(scene, chapter.title, query);
      if (!kept) continue;
      matches += kept.matches;
      rows.push(<SceneRow key={scene.id} base={base} scene={kept.scene} parent={chapter.title} />);
    }
    for (const note of chapter.notes) {
      if (query && !hit(note.title, query) && !hit(chapter.title, query)) continue;
      if (query && hit(note.title, query)) matches += 1;
      rows.push(<NoteRow key={note.id} base={base} note={note} parent={chapter.title} />);
    }
  }
  for (const scene of unplaced) {
    const kept = keepScene(scene, null, query);
    if (!kept) continue;
    matches += kept.matches;
    rows.push(<SceneRow key={scene.id} base={base} scene={kept.scene} parent={WRITE.unplaced} />);
  }
  for (const note of looseNotes) {
    if (query && !hit(note.title, query)) continue;
    if (query) matches += 1;
    rows.push(<NoteRow key={note.id} base={base} note={note} />);
  }

  return (
    <>
      {filtering ? <p className="outline-filter-count" role="status">{filterStatus(matches)}</p> : null}
      {rows.length === 0 ? <p className="outline-empty">{filtering ? WRITE.noMatches : WRITE.noScenes}</p> : <ul className="outline-scene-index">{rows}</ul>}
    </>
  );
}

function SceneRow({ base, scene, parent }: { base: string; scene: OutlineScene; parent?: string }) {
  return (
    <li className="outline-scene">
      <span className="outline-scene-mark" aria-hidden="true">
        <SceneMark />
      </span>
      <div className="outline-scene-copy">
        <Link href={recordHref(base, scene.id)}>{scene.title}</Link>
        {parent ? <span className="outline-parent">{MANUSCRIPT_SEARCH.inParent(parent)}</span> : null}
        {scene.notes.length ? (
          <ul className="outline-notes">
            {scene.notes.map((note) => (
              <li key={note.id}>
                <Link href={recordHref(base, note.id)}>
                  <span className="outline-note-kind">{RECORD_TYPE_LABELS.scene_note}</span>
                  {note.title}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

function NoteRow({ base, note, parent }: { base: string; note: OutlineNote; parent?: string }) {
  return (
    <li className="outline-scene outline-note-row">
      <span className="outline-scene-mark" aria-hidden="true">
        <SceneMark />
      </span>
      <div className="outline-scene-copy">
        <Link href={recordHref(base, note.id)}>
          <span className="outline-note-kind">{RECORD_TYPE_LABELS.scene_note}</span>
          {note.title}
        </Link>
        {parent ? <span className="outline-parent">{MANUSCRIPT_SEARCH.inParent(parent)}</span> : null}
      </div>
    </li>
  );
}

function SceneMark() {
  return (
    <svg className="outline-doc" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path d="M4 1.6h5.1L13 5.3v9.1H4V1.6Z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M9 1.8V5.3h3.3" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

type FilteredChapter = OutlineChapter & { matched: boolean; sceneMatches: number; noteMatches: number };

function filterChapters(chapters: readonly OutlineChapter[], query: string): FilteredChapter[] {
  if (!query) {
    return chapters.map((chapter) => ({ ...chapter, matched: false, sceneMatches: 0, noteMatches: 0 }));
  }
  const out: FilteredChapter[] = [];
  for (const chapter of chapters) {
    const matched = hit(chapter.title, query);
    if (matched) {
      const sceneMatches = chapter.scenes.filter((scene) => hit(scene.title, query)).length;
      const noteMatches = countNoteHits(chapter, query);
      out.push({ ...chapter, matched: true, sceneMatches, noteMatches });
      continue;
    }
    const scenes = chapter.scenes.flatMap((scene) => {
      const sceneHit = hit(scene.title, query);
      const notes = scene.notes.filter((note) => hit(note.title, query));
      if (sceneHit) return [scene];
      if (notes.length) return [{ ...scene, notes }];
      return [];
    });
    const notes = chapter.notes.filter((note) => hit(note.title, query));
    if (!scenes.length && !notes.length) continue;
    out.push({
      ...chapter,
      scenes,
      notes,
      matched: false,
      sceneMatches: scenes.filter((scene) => hit(scene.title, query)).length,
      noteMatches: notes.length + scenes.reduce((sum, scene) => sum + scene.notes.filter((note) => hit(note.title, query)).length, 0),
    });
  }
  return out;
}

function filterScenes(scenes: readonly OutlineScene[], parentTitle: string | null, query: string): OutlineScene[] {
  if (!query) return [...scenes];
  return scenes.flatMap((scene) => {
    const kept = keepScene(scene, parentTitle, query);
    return kept ? [kept.scene] : [];
  });
}

function keepScene(scene: OutlineScene, parentTitle: string | null, query: string): { scene: OutlineScene; matches: number } | null {
  if (!query) return { scene, matches: 0 };
  const sceneHit = hit(scene.title, query);
  const parentHit = parentTitle ? hit(parentTitle, query) : false;
  const notes = scene.notes.filter((note) => hit(note.title, query));
  if (!sceneHit && !parentHit && notes.length === 0) return null;
  const next = sceneHit || parentHit ? scene : { ...scene, notes };
  const matches = (sceneHit || parentHit ? 1 : 0) + notes.length;
  return { scene: next, matches };
}

function filterNotes(notes: readonly OutlineNote[], query: string): OutlineNote[] {
  if (!query) return [...notes];
  return notes.filter((note) => hit(note.title, query));
}

function countNoteHits(chapter: OutlineChapter, query: string): number {
  return (
    chapter.notes.filter((note) => hit(note.title, query)).length +
    chapter.scenes.reduce((sum, scene) => sum + scene.notes.filter((note) => hit(note.title, query)).length, 0)
  );
}

function filterStatus(count: number): string {
  return count === 0 ? WRITE.noMatches : WRITE.matches(count);
}

function hit(title: string, query: string): boolean {
  return title.toLocaleLowerCase().includes(query);
}

function recordHref(base: string, id: string): string {
  return `${base}/records/${encodeURIComponent(id)}`;
}
