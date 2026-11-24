"use client";

import Link from "next/link";
import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { BookOpen, Download, Layers, Plus } from "lucide-react";
import { LandingHeader } from "@/components/library/LandingHeader";
import { ChevronRightIcon, SearchIcon } from "@/components/shell/icons";
import { ManuscriptCreateForm } from "@/components/shell/ManuscriptTree";
import { HelpHint } from "@/components/HelpHint";
import { Corkboard, type CorkboardCard, type CorkboardGroup } from "@/components/write/Corkboard";
import { Outliner, type OutlinerRow } from "@/components/write/Outliner";
import { Button, ButtonLink } from "@/components/ui/Atoms/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import { CONTINUE_WRITING, MANUSCRIPT_ANNOTATIONS, MANUSCRIPT_SEARCH, NAV, WRITE } from "@/ui/labels";

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

type Tab = "chapters" | "scenes" | "corkboard" | "outliner";

export type { CorkboardCard, CorkboardGroup, OutlinerRow };

/**
 * Write landing: one ordered outline. Chapter and scene titles open the editor.
 * The chevron only shows or hides that chapter's scenes.
 */
export function ManuscriptOutline({
  projectId,
  title,
  eyebrow,
  coverSrc,
  description,
  afterLead,
  chapters,
  unplaced,
  looseNotes,
  draftId,
  initialQuery,
  headerActions,
  overflow,
  results,
  gettingStarted,
  synopsisById = new Map<string, string>(),
  corkboardGroups = [],
  corkboardUnplaced = [],
  outlinerRows = [],
}: {
  projectId: string;
  title: string;
  eyebrow: string;
  coverSrc: string | null;
  description: string;
  afterLead?: ReactNode;
  chapters: OutlineChapter[];
  unplaced: OutlineScene[];
  looseNotes: OutlineNote[];
  draftId: string | null;
  initialQuery: string;
  headerActions: ReactNode;
  overflow: ReactNode;
  results: ReactNode;
  gettingStarted: ReactNode;
  synopsisById?: Map<string, string>;
  corkboardGroups?: CorkboardGroup[];
  corkboardUnplaced?: CorkboardCard[];
  outlinerRows?: OutlinerRow[];
}) {
  const uid = useId();
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const [tab, setTab] = useState<Tab>("chapters");
  const [titleQuery, setTitleQuery] = useState(initialQuery);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [creating, setCreating] = useState<"chapter" | "scene" | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(chapters[0]?.id ?? null);

  useEffect(() => setTitleQuery(initialQuery), [initialQuery]);

  const query = titleQuery.trim().toLocaleLowerCase();
  const filtering = query.length > 0;
  const chapterOptions = chapters.map((chapter) => ({ id: chapter.id, title: chapter.title }));

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const order: Tab[] = ["chapters", "scenes", "corkboard", "outliner"];
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
  const selected = visibleChapters.find((chapter) => chapter.id === selectedId) ?? visibleChapters[0] ?? null;
  const startCreate = (kind: "chapter" | "scene") => setCreating((current) => (current === kind ? null : kind));

  return (
    <div className="manuscript-outline">
      <div className="outline-main">
      <LandingHeader
        projectId={projectId}
        title={title}
        eyebrow={eyebrow}
        coverSrc={coverSrc}
        description={description}
        gettingStarted={gettingStarted}
      />

      {afterLead ? <div className="outline-extra">{afterLead}</div> : null}

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
        <button
          type="button"
          className="outline-tab"
          id={`${uid}-tab-corkboard`}
          role="tab"
          aria-selected={tab === "corkboard"}
          aria-controls={`${uid}-panel-corkboard`}
          tabIndex={tab === "corkboard" ? 0 : -1}
          onClick={() => setTab("corkboard")}
          onKeyDown={onTabKey}
        >
          {MANUSCRIPT_ANNOTATIONS.corkboardTab}
        </button>
        <button
          type="button"
          className="outline-tab"
          id={`${uid}-tab-outliner`}
          role="tab"
          aria-selected={tab === "outliner"}
          aria-controls={`${uid}-panel-outliner`}
          tabIndex={tab === "outliner" ? 0 : -1}
          onClick={() => setTab("outliner")}
          onKeyDown={onTabKey}
        >
          {WRITE.outlinerTab}
        </button>
      </div>

      <div className="outline-toolbar">
        <div className="outline-toolbar-lead">
          {headerActions}
          <form className="outline-search" role="search" method="get" action={`${base}/write`} aria-label={MANUSCRIPT_SEARCH.label}>
            <label className="outline-search-field">
              <span className="sr-only">{WRITE.searchManuscript}</span>
              <SearchIcon />
              <input
                type="search"
                name="q"
                value={titleQuery}
                placeholder={WRITE.searchManuscript}
                onChange={(event) => setTitleQuery(event.target.value)}
              />
            </label>
            <button type="submit" className="sr-only">
              {MANUSCRIPT_SEARCH.submit}
            </button>
          </form>
        </div>
        <div className="outline-actions">
          <Button type="button" variant="secondary" size="sm" icon={<Plus strokeWidth={1.75} />} onClick={() => startCreate("chapter")}>
            {WRITE.newChapter}
          </Button>
          <Button type="button" variant="secondary" size="sm" icon={<Layers strokeWidth={1.75} />} onClick={() => startCreate("scene")}>
            {WRITE.newScene}
          </Button>
          <span className="outline-action-rule" aria-hidden="true" />
          <ButtonLink variant="secondary" size="sm" href={`${base}/import-chapters`} icon={<Download strokeWidth={1.75} />}>
            {NAV.importChapters}
          </ButtonLink>
          <span className="outline-action-rule" aria-hidden="true" />
          <ButtonLink variant="secondary" size="sm" href={`${base}/read`} icon={<BookOpen strokeWidth={1.75} />}>
            {NAV.readBook}
          </ButtonLink>
          <div className="outline-actions-end">
            <details className="outline-more">
              <summary>{WRITE.more}</summary>
              <div className="outline-more-panel">{overflow}</div>
            </details>
          </div>
        </div>
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
      </div>

      <div className="outline-list">
      <div role="tabpanel" id={`${uid}-panel-chapters`} aria-labelledby={`${uid}-tab-chapters`} hidden={tab !== "chapters"}>
        {filtering && chapterMatchCount > 0 ? (
          <p className="outline-filter-count" role="status">
            {WRITE.matches(chapterMatchCount)}
          </p>
        ) : null}
        {visibleChapters.length === 0 && visibleUnplaced.length === 0 && visibleLoose.length === 0 ? (
          filtering ? (
            <p className="outline-empty">{WRITE.noMatches}</p>
          ) : (
            <EmptyState as="div" className="outline-empty outline-empty-rich">
              <p>{WRITE.noChapters}</p>
              <p className="small muted">{CONTINUE_WRITING.emptyHint}</p>
              <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
                <Button type="button" size="sm" onClick={() => setCreating("chapter")}>
                  {CONTINUE_WRITING.createChapter}
                </Button>
                <ButtonLink size="sm" variant="secondary" href={`${base}/import-chapters`}>
                  {CONTINUE_WRITING.importChapters}
                </ButtonLink>
                <ButtonLink size="sm" variant="secondary" href={`${base}/world`}>
                  {CONTINUE_WRITING.openWorld}
                </ButtonLink>
                <ButtonLink size="sm" variant="secondary" href={`${base}/plan/weave`}>
                  {CONTINUE_WRITING.openWeave}
                </ButtonLink>
              </div>
            </EmptyState>
          )
        ) : (
          <ol className="outline-chapters">
            {visibleChapters.map((chapter) => {
              const children = chapter.scenes.length + chapter.notes.length > 0;
              const open = children && (filtering || expanded.has(chapter.id));
              const scenesDomId = `${uid}-scenes-${chapter.id}`;
              return (
                <li key={chapter.id} className="outline-chapter">
                  <div
                    className="outline-chapter-row"
                    data-selected={selected?.id === chapter.id ? "" : undefined}
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest("button.outline-disclose")) return;
                      setSelectedId(chapter.id);
                      setExpanded((prev) => (prev.has(chapter.id) ? prev : new Set(prev).add(chapter.id)));
                    }}
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="outline-select"
                      aria-pressed={selected?.id === chapter.id}
                      aria-label={WRITE.selectChapter(chapter.title)}
                      onClick={() => setSelectedId(chapter.id)}
                    >
                      <span className="outline-number">{chapter.number}</span>
                    </Button>
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

      <div role="tabpanel" id={`${uid}-panel-corkboard`} aria-labelledby={`${uid}-tab-corkboard`} hidden={tab !== "corkboard"}>
        <p className="small muted corkboard-lead">{MANUSCRIPT_ANNOTATIONS.corkboardLead}</p>
        <Corkboard projectId={projectId} groups={corkboardGroups} unplaced={corkboardUnplaced} />
      </div>

      <div role="tabpanel" id={`${uid}-panel-outliner`} aria-labelledby={`${uid}-tab-outliner`} hidden={tab !== "outliner"}>
        <HelpHint anchor="manuscript-outliner" topic="Outliner">
          {WRITE.outlinerLead}
        </HelpHint>
        <Outliner projectId={projectId} rows={outlinerRows} />
      </div>
      </div>
      {selected ? (
        <aside className="outline-inspector" aria-label={WRITE.selectedChapter}>
          <p className="outline-inspector-kicker">{WRITE.selectedChapter}</p>
          <p className="outline-inspector-number">{selected.number}</p>
          <h2 className="outline-inspector-title">{selected.title}</h2>
          <p className="outline-inspector-kind">{WRITE.chapterKind}</p>
          {selected.scenes.length ? (
            <nav className="outline-inspector-scenes" aria-label={WRITE.scenesTab}>
              <p className="small muted">{WRITE.scenes(selected.scenes.length)}</p>
              <ul>
                {selected.scenes.map((scene) => (
                  <li key={scene.id}>
                    <Link href={recordHref(base, scene.id)}>{scene.title}</Link>
                  </li>
                ))}
              </ul>
            </nav>
          ) : (
            <p className="small muted">{WRITE.noScenes}</p>
          )}
          {synopsisById.get(selected.id)?.trim() ? (
            <p className="small outline-inspector-synopsis">{synopsisById.get(selected.id)}</p>
          ) : null}
          <ButtonLink className="outline-open" href={recordHref(base, selected.id)}>
            {WRITE.openChapter}
          </ButtonLink>
          <div className="outline-rail-actions">
            <ButtonLink variant="ghost" size="sm" className="outline-rail-action" href={`${base}/read`} icon={<BookOpen strokeWidth={1.75} />}>
              {NAV.readBook}
            </ButtonLink>
            <Button type="button" variant="ghost" size="sm" className="outline-rail-action" icon={<Plus strokeWidth={1.75} />} onClick={() => startCreate("chapter")}>
              {WRITE.newChapter}
            </Button>
            <Button type="button" variant="ghost" size="sm" className="outline-rail-action" icon={<Layers strokeWidth={1.75} />} onClick={() => startCreate("scene")}>
              {WRITE.newScene}
            </Button>
            <ButtonLink variant="ghost" size="sm" className="outline-rail-action" href={`${base}/import-chapters`} icon={<Download strokeWidth={1.75} />}>
              {NAV.importChapters}
            </ButtonLink>
          </div>
        </aside>
      ) : null}
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
      {filtering && matches > 0 ? (
        <p className="outline-filter-count" role="status">
          {WRITE.matches(matches)}
        </p>
      ) : null}
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

function hit(title: string, query: string): boolean {
  return title.toLocaleLowerCase().includes(query);
}

function recordHref(base: string, id: string): string {
  return `${base}/records/${encodeURIComponent(id)}`;
}
