"use client";

import {
  useEffect,
  useMemo,
  useState,
  useTransition,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import type { Issue } from "@/domain/issues";
import type { WeaveBeatView, WeaveThreadView } from "@/server/services/weaveService";
import { WEAVE } from "@/ui/labels";
import {
  addWeaveBeatAction,
  addWeaveThreadAction,
  deleteWeaveThreadAction,
  placeWeaveBeatAction,
  renameWeaveThreadAction,
  reorderWeaveThreadsAction,
} from "./actions";

export interface PlotGridRow {
  id: string;
  label: string;
  kind: "chapter" | "scene";
  indexLabel?: string;
}

export interface PlotGridChapter {
  id: string;
  title: string;
  rows: PlotGridRow[];
}

export type PlotDensity = "compact" | "comfortable";

export function WeavePlotGrid({
  projectId,
  gridId,
  threads: initialThreads,
  beats,
  chapters,
  selectedId,
  decisionFilter,
  density,
  mobileThreadId,
  onSelectBeat,
  onIssues,
  onBeatsChange,
  onThreadsChange,
}: {
  projectId: string;
  gridId: string;
  threads: WeaveThreadView[];
  beats: WeaveBeatView[];
  chapters: PlotGridChapter[];
  selectedId: string | null;
  decisionFilter: string;
  density: PlotDensity;
  /** When set (narrow), only this thread column is shown as a scene list. */
  mobileThreadId: string | null;
  onSelectBeat: (beat: WeaveBeatView | null) => void;
  onIssues: (issues: Issue[]) => void;
  onBeatsChange?: (beats: WeaveBeatView[]) => void;
  onThreadsChange?: (threads: WeaveThreadView[]) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [threads, setThreads] = useState(initialThreads);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [focus, setFocus] = useState<{ row: number; col: number }>({ row: 0, col: 0 });
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [newThreadTitle, setNewThreadTitle] = useState("");

  useEffect(() => {
    setThreads(initialThreads);
  }, [initialThreads]);

  const commitThreads = (next: WeaveThreadView[] | ((prev: WeaveThreadView[]) => WeaveThreadView[])) => {
    setThreads((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      queueMicrotask(() => onThreadsChange?.(resolved));
      return resolved;
    });
  };

  const flatRows = useMemo(() => {
    const list: PlotGridRow[] = [];
    for (const chapter of chapters) {
      if (collapsed[chapter.id]) continue;
      list.push(...chapter.rows);
    }
    return list;
  }, [chapters, collapsed]);

  const rowIds = useMemo(() => new Set(flatRows.map((r) => r.id)), [flatRows]);

  const visibleThreads = useMemo(() => {
    if (mobileThreadId) {
      const one = threads.find((t) => t.id === mobileThreadId);
      return one ? [one] : threads.slice(0, 1);
    }
    return threads;
  }, [threads, mobileThreadId]);

  const matchesFilter = (beat: WeaveBeatView) => {
    if (decisionFilter === "all") return true;
    if (decisionFilter === "unset") return !beat.decision;
    return beat.decision === decisionFilter;
  };

  const cellBeats = (row: PlotGridRow, thread: WeaveThreadView) => {
    const list = beats.filter(
      (beat) => beat.threadId === thread.id && beat.manuscriptRecordId === row.id && matchesFilter(beat),
    );
    return list.sort((a, b) => a.cellOrder - b.cellOrder || a.zIndex - b.zIndex || a.id.localeCompare(b.id));
  };

  const unplacedBeats = useMemo(() => {
    return beats
      .filter((b) => {
        if (!matchesFilter(b)) return false;
        if (!b.threadId) return true;
        if (!b.manuscriptRecordId) return true;
        return !rowIds.has(b.manuscriptRecordId);
      })
      .sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id));
  }, [beats, rowIds, decisionFilter]);

  const addInCell = (row: PlotGridRow, thread: WeaveThreadView) => {
    startTransition(async () => {
      const result = await addWeaveBeatAction(projectId, gridId, {
        title: "Beat",
        x: 40 + thread.position * 40,
        y: 40 + flatRows.findIndex((r) => r.id === row.id) * 24,
        threadId: thread.id,
        manuscriptRecordId: row.id,
        cellOrder: cellBeats(row, thread).length,
      });
      if (!result.ok) {
        onIssues(result.issues);
        return;
      }
      onIssues([]);
      onBeatsChange?.([...beats, result.beat]);
      onSelectBeat(result.beat);
      router.refresh();
    });
  };

  const onGridKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (!visibleThreads.length || !flatRows.length) return;
    if (e.key === "Escape") {
      onSelectBeat(null);
      return;
    }
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      setFocus((f) => {
        let { row, col } = f;
        if (e.key === "ArrowLeft") col = Math.max(0, col - 1);
        if (e.key === "ArrowRight") col = Math.min(visibleThreads.length - 1, col + 1);
        if (e.key === "ArrowUp") row = Math.max(0, row - 1);
        if (e.key === "ArrowDown") row = Math.min(flatRows.length - 1, row + 1);
        return { row, col };
      });
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const row = flatRows[focus.row];
      const thread = visibleThreads[focus.col];
      if (!row || !thread) return;
      const inCell = cellBeats(row, thread);
      if (inCell[0]) onSelectBeat(inCell[0]!);
      else addInCell(row, thread);
    }
  };

  const moveThread = (threadId: string, dir: -1 | 1) => {
    const idx = threads.findIndex((t) => t.id === threadId);
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= threads.length) return;
    const next = [...threads];
    const [item] = next.splice(idx, 1);
    next.splice(j, 0, item!);
    commitThreads(next);
    startTransition(async () => {
      const result = await reorderWeaveThreadsAction(
        projectId,
        gridId,
        next.map((t) => t.id),
      );
      if (!result.ok) {
        onIssues(result.issues);
        commitThreads(initialThreads);
        return;
      }
      onIssues([]);
      router.refresh();
    });
  };

  const placeOnUnplaced = (beat: WeaveBeatView, threadId: string | null) => {
    startTransition(async () => {
      const result = await placeWeaveBeatAction(projectId, gridId, beat.id, {
        threadId,
        // Keep an existing scene link when only assigning a thread from Unplaced.
        manuscriptRecordId: beat.manuscriptRecordId,
      });
      if (!result.ok) {
        onIssues(result.issues);
        return;
      }
      onIssues([]);
      onBeatsChange?.(beats.map((b) => (b.id === beat.id ? result.beat : b)));
      onSelectBeat(result.beat);
      router.refresh();
    });
  };

  const sceneCount = chapters.reduce((n, c) => n + c.rows.length, 0);

  return (
    <div className={`plot-grid-wrap density-${density}${mobileThreadId ? " plot-grid-mobile" : ""}`}>
      <p className="small muted">{WEAVE.bookOrderNote}</p>

      {!threads.length ? (
        <div className="plot-grid-empty-threads">
          <p className="muted">{WEAVE.noThreadsYet}</p>
          <form
            className="row"
            style={{ gap: "0.35rem", flexWrap: "wrap" }}
            onSubmit={(e) => {
              e.preventDefault();
              startTransition(async () => {
                const result = await addWeaveThreadAction(projectId, gridId, newThreadTitle || "Thread");
                if (!result.ok) {
                  onIssues(result.issues);
                  return;
                }
                setNewThreadTitle("");
                onIssues([]);
                commitThreads([...threads, result.thread]);
                router.refresh();
              });
            }}
          >
            <input
              value={newThreadTitle}
              onChange={(e) => setNewThreadTitle(e.target.value)}
              placeholder={WEAVE.threadTitle}
              aria-label={WEAVE.threadTitle}
            />
            <button type="submit" className="small-button" disabled={pending}>
              {WEAVE.addThread}
            </button>
          </form>
        </div>
      ) : (
        <div
          className="plot-grid-scroll"
          tabIndex={0}
          aria-label={WEAVE.plotGridTable}
          aria-description={WEAVE.plotGridKeyboard}
          onKeyDown={onGridKeyDown}
        >
          <table className="plot-grid-table">
            <thead>
              <tr>
                <th scope="col" className="plot-grid-corner">
                  {WEAVE.sceneColumn}
                </th>
                {visibleThreads.map((thread, col) => (
                  <th key={thread.id} scope="col" className={`plot-grid-thread-head thread-tone-${col % 6}`}>
                    {renameId === thread.id ? (
                      <form
                        className="row"
                        style={{ gap: "0.25rem", flexWrap: "wrap" }}
                        onSubmit={(e) => {
                          e.preventDefault();
                          startTransition(async () => {
                            const result = await renameWeaveThreadAction(projectId, gridId, thread.id, renameTitle);
                            if (!result.ok) {
                              onIssues(result.issues);
                              return;
                            }
                            setRenameId(null);
                            onIssues([]);
                            commitThreads((list) => list.map((t) => (t.id === thread.id ? result.thread : t)));
                            router.refresh();
                          });
                        }}
                      >
                        <input
                          value={renameTitle}
                          onChange={(e) => setRenameTitle(e.target.value)}
                          aria-label={WEAVE.renameThread}
                          required
                        />
                        <button type="submit" className="secondary small-button" disabled={pending}>
                          {WEAVE.renameThread}
                        </button>
                      </form>
                    ) : (
                      <span className="plot-grid-thread-title">
                        <span className="plot-grid-thread-dot" aria-hidden="true" />
                        <strong>{thread.title}</strong>
                      </span>
                    )}
                    {!mobileThreadId ? (
                      <div className="row plot-grid-thread-actions">
                        <button
                          type="button"
                          className="secondary small-button"
                          disabled={pending || col === 0}
                          onClick={() => moveThread(thread.id, -1)}
                        >
                          {WEAVE.moveThreadLeft}
                        </button>
                        <button
                          type="button"
                          className="secondary small-button"
                          disabled={pending || col === threads.length - 1}
                          onClick={() => moveThread(thread.id, 1)}
                        >
                          {WEAVE.moveThreadRight}
                        </button>
                        <button
                          type="button"
                          className="secondary small-button"
                          onClick={() => {
                            setRenameId(thread.id);
                            setRenameTitle(thread.title);
                          }}
                        >
                          {WEAVE.renameThread}
                        </button>
                        {confirmDeleteId === thread.id ? (
                          <button
                            type="button"
                            className="small-button"
                            disabled={pending}
                            onClick={() =>
                              startTransition(async () => {
                                const result = await deleteWeaveThreadAction(projectId, gridId, thread.id);
                                if (!result.ok) {
                                  onIssues(result.issues);
                                  return;
                                }
                                setConfirmDeleteId(null);
                                onIssues([]);
                                commitThreads((list) => list.filter((t) => t.id !== thread.id));
                                router.refresh();
                              })
                            }
                          >
                            {WEAVE.confirmDeleteThread(thread.title)}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="secondary small-button"
                            onClick={() => setConfirmDeleteId(thread.id)}
                          >
                            {WEAVE.deleteThread}
                          </button>
                        )}
                      </div>
                    ) : null}
                  </th>
                ))}
                {!mobileThreadId ? (
                  <th scope="col" className="plot-grid-add-thread">
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        startTransition(async () => {
                          const result = await addWeaveThreadAction(projectId, gridId, newThreadTitle || "Thread");
                          if (!result.ok) {
                            onIssues(result.issues);
                            return;
                          }
                          setNewThreadTitle("");
                          onIssues([]);
                          commitThreads((list) => [...list, result.thread]);
                          router.refresh();
                        });
                      }}
                    >
                      <button type="submit" className="secondary small-button" disabled={pending}>
                        {WEAVE.addThreadShort}
                      </button>
                    </form>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {chapters.map((chapter) => {
                const isCollapsed = Boolean(collapsed[chapter.id]);
                return (
                  <ChapterBlock
                    key={chapter.id}
                    chapter={chapter}
                    collapsed={isCollapsed}
                    colSpan={visibleThreads.length + (mobileThreadId ? 1 : 2)}
                    onToggle={() => setCollapsed((c) => ({ ...c, [chapter.id]: !c[chapter.id] }))}
                    visibleThreads={visibleThreads}
                    flatRows={flatRows}
                    focus={focus}
                    selectedId={selectedId}
                    pending={pending}
                    cellBeats={cellBeats}
                    onFocusCell={(row, col) => setFocus({ row, col })}
                    onSelectBeat={onSelectBeat}
                    onAddInCell={addInCell}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {unplacedBeats.length ? (
        <section className="plot-unplaced panel" aria-label={WEAVE.unplacedBeats(unplacedBeats.length)}>
          <h3 style={{ marginTop: 0 }}>{WEAVE.unplacedBeats(unplacedBeats.length)}</h3>
          <p className="small muted">{WEAVE.unplacedRowHint}</p>
          <ul className="plot-unplaced-list">
            {unplacedBeats.map((beat) => (
              <li key={beat.id}>
                <button
                  type="button"
                  className={`plot-grid-beat${selectedId === beat.id ? " selected" : ""}`}
                  onClick={() => onSelectBeat(beat)}
                >
                  <span className="plot-grid-beat-title">{beat.title}</span>
                  {beat.decisionLabel ? <span className="small muted">{beat.decisionLabel}</span> : null}
                  {beat.manuscriptTitle ? <span className="small muted"> · {beat.manuscriptTitle}</span> : null}
                </button>
                {threads.length && !beat.threadId ? (
                  <label className="small">
                    <span className="sr-only">{WEAVE.storyThread}</span>
                    <select
                      value=""
                      aria-label={WEAVE.storyThread}
                      onChange={(e) => {
                        const threadId = e.target.value || null;
                        if (threadId) placeOnUnplaced(beat, threadId);
                      }}
                    >
                      <option value="">{WEAVE.noThread}</option>
                      {threads.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="plot-grid-meta small muted">{WEAVE.plotMeta(sceneCount, threads.length)}</p>
    </div>
  );
}

function ChapterBlock({
  chapter,
  collapsed,
  colSpan,
  onToggle,
  visibleThreads,
  flatRows,
  focus,
  selectedId,
  pending,
  cellBeats,
  onFocusCell,
  onSelectBeat,
  onAddInCell,
}: {
  chapter: PlotGridChapter;
  collapsed: boolean;
  colSpan: number;
  onToggle: () => void;
  visibleThreads: WeaveThreadView[];
  flatRows: PlotGridRow[];
  focus: { row: number; col: number };
  selectedId: string | null;
  pending: boolean;
  cellBeats: (row: PlotGridRow, thread: WeaveThreadView) => WeaveBeatView[];
  onFocusCell: (row: number, col: number) => void;
  onSelectBeat: (beat: WeaveBeatView | null) => void;
  onAddInCell: (row: PlotGridRow, thread: WeaveThreadView) => void;
}) {
  return (
    <>
      <tr className="plot-grid-chapter-row">
        <th scope="colgroup" colSpan={colSpan}>
          <button
            type="button"
            className="plot-grid-chapter-toggle"
            aria-expanded={!collapsed}
            onClick={onToggle}
          >
            <span aria-hidden="true">{collapsed ? "▸" : "▾"}</span>
            {chapter.title}
            <span className="sr-only">
              {collapsed ? WEAVE.expandChapter : WEAVE.collapseChapter}
            </span>
          </button>
        </th>
      </tr>
                  {!collapsed
        ? chapter.rows.map((row) => {
            const rowIdx = flatRows.findIndex((r) => r.id === row.id);
            const showAddCol = colSpan > visibleThreads.length + 1;
            return (
              <tr key={row.id}>
                <th scope="row" className="plot-grid-rowhead">
                  {row.indexLabel ? <span className="plot-grid-scene-index">{row.indexLabel}</span> : null}
                  <strong>{row.label}</strong>
                  <span className="small muted">
                    {row.kind === "chapter" ? WEAVE.chapterOnlyRow : WEAVE.sceneRow}
                  </span>
                </th>
                {visibleThreads.map((thread, colIdx) => {
                  const inCell = cellBeats(row, thread);
                  const focused = focus.row === rowIdx && focus.col === colIdx;
                  return (
                    <td
                      key={`${row.id}-${thread.id}`}
                      className={`plot-grid-cell thread-tone-${colIdx % 6}${focused ? " focused" : ""}${inCell.length ? "" : " blank"}`}
                      onClick={() => onFocusCell(rowIdx, colIdx)}
                    >
                      {inCell.length === 0 ? (
                        <button
                          type="button"
                          className="plot-grid-blank-add"
                          disabled={pending}
                          onClick={() => onAddInCell(row, thread)}
                        >
                          {WEAVE.addBeatInCell}
                        </button>
                      ) : (
                        <ul className="plot-grid-cell-beats">
                          {inCell.map((beat) => (
                            <li key={beat.id}>
                              <button
                                type="button"
                                className={`plot-grid-beat${selectedId === beat.id ? " selected" : ""}`}
                                onClick={() => onSelectBeat(beat)}
                              >
                                <span className="plot-grid-beat-bar" aria-hidden="true" />
                                <span className="plot-grid-beat-title">{beat.title}</span>
                                {beat.decisionLabel ? (
                                  <span className="small muted">{beat.decisionLabel}</span>
                                ) : null}
                              </button>
                            </li>
                          ))}
                          <li>
                            <button
                              type="button"
                              className="plot-grid-blank-add"
                              disabled={pending}
                              onClick={() => onAddInCell(row, thread)}
                            >
                              {WEAVE.addBeatInCell}
                            </button>
                          </li>
                        </ul>
                      )}
                    </td>
                  );
                })}
                {showAddCol ? <td className="plot-grid-add-thread-cell" aria-hidden="true" /> : null}
              </tr>
            );
          })
        : null}
    </>
  );
}
