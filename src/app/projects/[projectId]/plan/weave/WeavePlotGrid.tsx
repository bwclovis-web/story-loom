"use client";
import { Button } from "@/components/ui/Button";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useRouter } from "next/navigation";
import type { Issue } from "@/domain/issues";
import type { WeaveBeatView, WeaveThreadView } from "@/server/services/weaveService";
import { WEAVE } from "@/ui/labels";
import { plotRowForManuscript } from "@/ui/plotGridPlacement";
import { beatLinkTagClass, beatMatchesLinkFilter, type WeaveLinkFilter } from "@/weave/beatLinkFilter";
import { CreateSceneFromBeat } from "./CreateSceneFromBeat";
import {
  addWeaveBeatAction,
  addWeaveThreadAction,
  deleteWeaveThreadAction,
  placeWeaveBeatAction,
  relocateWeaveBeatAction,
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

const DRAG_THRESHOLD_PX = 6;

type DropTarget =
  | { kind: "cell"; threadId: string; rowId: string; insertIndex: number }
  | { kind: "unplaced"; insertIndex: number };

function insertIndexFromY(clientY: number, beatEls: Element[], dragBeatId: string): number {
  const others = beatEls.filter((el) => el.getAttribute("data-beat-id") !== dragBeatId);
  for (let i = 0; i < others.length; i += 1) {
    const rect = others[i]!.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return i;
  }
  return others.length;
}

function resolveDropTarget(clientX: number, clientY: number, dragBeatId: string): DropTarget | null {
  const stack = document.elementsFromPoint(clientX, clientY);
  // Prefer an explicit drop surface (cell / Unplaced), including under the dragged beat.
  const drop =
    stack
      .map((node) => (node instanceof Element ? node.closest<HTMLElement>("[data-plot-drop]") : null))
      .find((node) => node != null) ?? null;
  if (!drop) return null;
  const kind = drop.dataset.plotDrop;
  if (kind === "unplaced") {
    return {
      kind: "unplaced",
      insertIndex: insertIndexFromY(clientY, [...drop.querySelectorAll("[data-beat-id]")], dragBeatId),
    };
  }
  if (kind === "cell") {
    const threadId = drop.dataset.threadId;
    const rowId = drop.dataset.rowId;
    if (!threadId || !rowId) return null;
    return {
      kind: "cell",
      threadId,
      rowId,
      insertIndex: insertIndexFromY(clientY, [...drop.querySelectorAll("[data-beat-id]")], dragBeatId),
    };
  }
  return null;
}

function dropTargetKey(target: DropTarget | null): string | null {
  if (!target) return null;
  if (target.kind === "unplaced") return `unplaced:${target.insertIndex}`;
  return `cell:${target.threadId}:${target.rowId}:${target.insertIndex}`;
}

export function WeavePlotGrid({
  projectId,
  gridId,
  threads: initialThreads,
  beats,
  chapters,
  otherDraftRowByRecordId = {},
  selectedId,
  decisionFilter,
  linkFilter,
  density,
  hiddenThreadIds = [],
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
  /** Beat manuscript id → visible row, for a rewrite pair that is not itself a row. */
  otherDraftRowByRecordId?: Record<string, string>;
  selectedId: string | null;
  decisionFilter: string;
  linkFilter: WeaveLinkFilter;
  density: PlotDensity;
  hiddenThreadIds?: string[];
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
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ title: string; x: number; y: number; w: number } | null>(null);
  const dragRef = useRef<{
    beatId: string;
    title: string;
    startX: number;
    startY: number;
    active: boolean;
    pointerId: number;
    width: number;
  } | null>(null);
  const dropTargetRef = useRef<DropTarget | null>(null);
  const suppressClickRef = useRef(false);
  const beatsSnapshotRef = useRef(beats);

  useEffect(() => {
    setThreads(initialThreads);
  }, [initialThreads]);

  useEffect(() => {
    beatsSnapshotRef.current = beats;
  }, [beats]);

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

  const rowIds = useMemo(() => new Set(chapters.flatMap((chapter) => chapter.rows.map((row) => row.id))), [chapters]);
  const otherDraftRows = useMemo(() => new Map(Object.entries(otherDraftRowByRecordId)), [otherDraftRowByRecordId]);

  const visibleThreads = useMemo(() => {
    const filtered = threads.filter((t) => !hiddenThreadIds.includes(t.id));
    const base = filtered.length ? filtered : threads;
    if (mobileThreadId) {
      const one = base.find((t) => t.id === mobileThreadId) ?? threads.find((t) => t.id === mobileThreadId);
      return one ? [one] : base.slice(0, 1);
    }
    return base;
  }, [threads, mobileThreadId, hiddenThreadIds]);

  const matchesFilter = (beat: WeaveBeatView) => {
    if (!beatMatchesLinkFilter(beat, linkFilter)) return false;
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
        return plotRowForManuscript(b.manuscriptRecordId, rowIds, otherDraftRows) === null;
      })
      .sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id));
  }, [beats, rowIds, otherDraftRows, decisionFilter, linkFilter]);

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

  const applyRelocate = (beatId: string, target: DropTarget) => {
    const previous = beatsSnapshotRef.current;
    const moving = previous.find((b) => b.id === beatId);
    if (!moving) return;

    const threadId = target.kind === "cell" ? target.threadId : moving.threadId;
    const manuscriptRecordId = target.kind === "cell" ? target.rowId : null;
    const cellOrder = target.insertIndex;

    const cellKey = (t: string | null, m: string | null) => (t && m ? `${t}::${m}` : null);
    const srcKey = cellKey(moving.threadId, moving.manuscriptRecordId);
    const destKey = cellKey(threadId, manuscriptRecordId);
    const optimistic = previous.map((beat) => ({ ...beat }));
    const byId = new Map(optimistic.map((b) => [b.id, b]));
    const mover = byId.get(beatId)!;
    mover.threadId = threadId;
    mover.manuscriptRecordId = manuscriptRecordId;
    mover.cellOrder = cellOrder;
    if (destKey && threadId && manuscriptRecordId) {
      const others = optimistic
        .filter((b) => b.id !== beatId && cellKey(b.threadId, b.manuscriptRecordId) === destKey)
        .sort((a, b) => a.cellOrder - b.cellOrder || a.zIndex - b.zIndex || a.id.localeCompare(b.id));
      const next = [...others];
      next.splice(Math.min(cellOrder, next.length), 0, mover);
      next.forEach((b, i) => {
        b.threadId = threadId;
        b.manuscriptRecordId = manuscriptRecordId;
        b.cellOrder = i;
      });
    }
    if (srcKey && srcKey !== destKey) {
      const source = optimistic
        .filter((b) => b.id !== beatId && cellKey(b.threadId, b.manuscriptRecordId) === srcKey)
        .sort((a, b) => a.cellOrder - b.cellOrder || a.zIndex - b.zIndex || a.id.localeCompare(b.id));
      source.forEach((b, i) => {
        b.cellOrder = i;
      });
    }
    onBeatsChange?.(optimistic);
    setSettlingId(beatId);
    window.setTimeout(() => setSettlingId((id) => (id === beatId ? null : id)), 220);

    startTransition(async () => {
      const result = await relocateWeaveBeatAction(projectId, gridId, beatId, {
        threadId,
        manuscriptRecordId,
        cellOrder,
      });
      if (!result.ok) {
        onIssues(result.issues);
        onBeatsChange?.(previous);
        return;
      }
      onIssues([]);
      onBeatsChange?.(result.beats);
      const updated = result.beats.find((b) => b.id === beatId) ?? null;
      if (updated) onSelectBeat(updated);
      router.refresh();
    });
  };

  const clearDragUi = () => {
    dropTargetRef.current = null;
    setDropTarget(null);
    setDraggingId(null);
    setGhost(null);
  };

  const detachWindowDrag = useRef<(() => void) | null>(null);

  const endDrag = (clientX: number, clientY: number) => {
    detachWindowDrag.current?.();
    detachWindowDrag.current = null;
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) {
      clearDragUi();
      return;
    }
    // Resolve from coordinates on release — React dropTarget state can lag the last move.
    const target = drag.active
      ? resolveDropTarget(clientX, clientY, drag.beatId) ?? dropTargetRef.current
      : null;
    clearDragUi();
    if (drag.active) {
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
    if (drag.active && target) {
      applyRelocate(drag.beatId, target);
    }
  };

  useEffect(() => {
    return () => {
      detachWindowDrag.current?.();
      detachWindowDrag.current = null;
    };
  }, []);

  const onBeatPointerDown = (e: ReactPointerEvent<HTMLButtonElement>, beat: WeaveBeatView) => {
    if (e.button !== 0) return;
    // Keep the gesture on window listeners so React className re-renders cannot drop it.
    const rect = e.currentTarget.getBoundingClientRect();
    const pointerId = e.pointerId;
    dragRef.current = {
      beatId: beat.id,
      title: beat.title,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
      pointerId,
      width: Math.max(120, Math.round(rect.width)),
    };
    suppressClickRef.current = false;
    onSelectBeat(beat);

    const onMove = (ev: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== ev.pointerId) return;
      const dist = Math.hypot(ev.clientX - drag.startX, ev.clientY - drag.startY);
      if (!drag.active && dist < DRAG_THRESHOLD_PX) return;
      if (!drag.active) {
        drag.active = true;
        setDraggingId(drag.beatId);
      }
      ev.preventDefault();
      const next = resolveDropTarget(ev.clientX, ev.clientY, drag.beatId);
      dropTargetRef.current = next;
      setDropTarget(next);
      setGhost({
        title: drag.title,
        x: ev.clientX + 12,
        y: ev.clientY + 12,
        w: drag.width,
      });
    };
    const onUp = (ev: PointerEvent) => {
      if (dragRef.current?.pointerId !== ev.pointerId) return;
      endDrag(ev.clientX, ev.clientY);
    };
    detachWindowDrag.current?.();
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    detachWindowDrag.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  };

  const onBeatClick = (e: React.MouseEvent, beat: WeaveBeatView) => {
    if (suppressClickRef.current || draggingId === beat.id) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    onSelectBeat(beat);
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
  const selectedBeat = beats.find((beat) => beat.id === selectedId) ?? null;
  const activeDropKey = dropTargetKey(dropTarget);

  return (
    <div
      className={`plot-grid-wrap density-${density}${mobileThreadId ? " plot-grid-mobile" : ""}${draggingId ? " is-dragging" : ""}`}
    >
      {ghost ? (
        <div
          className="plot-grid-drag-ghost"
          style={{ left: ghost.x, top: ghost.y, width: ghost.w }}
          aria-hidden="true"
        >
          <span className="plot-grid-beat-bar" />
          <span className="plot-grid-beat-title">{ghost.title}</span>
        </div>
      ) : null}
      {selectedBeat && !selectedBeat.manuscriptRecordId ? (
        <CreateSceneFromBeat
          projectId={projectId}
          beat={selectedBeat}
          chapters={chapters
            .filter((chapter) => chapter.id !== "__unplaced_scenes__")
            .map((chapter) => ({ id: chapter.id, title: chapter.title }))}
          onIssues={onIssues}
          onCreated={(beat) => {
            onBeatsChange?.(beats.map((row) => (row.id === beat.id ? beat : row)));
            router.refresh();
          }}
        />
      ) : null}
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
            <Button type="submit" disabled={pending} size="sm">
              {WEAVE.addThread}
            </Button>
          </form>
        </div>
      ) : (
        <div
          className="plot-grid-scroll"
          tabIndex={0}
          aria-label={WEAVE.plotGridTable}
          aria-description={`${WEAVE.plotGridKeyboard} ${WEAVE.dragBeatHint}`}
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
                        <Button type="submit" disabled={pending} variant="secondary" size="sm">
                          {WEAVE.renameThread}
                        </Button>
                      </form>
                    ) : (
                      <div className="plot-grid-thread-head-row">
                        <span className="plot-grid-thread-title">
                          <span className="plot-grid-thread-dot" aria-hidden="true" />
                          <strong>{thread.title}</strong>
                        </span>
                        {!mobileThreadId ? (
                          <details className="plot-grid-thread-menu">
                            <summary aria-label={WEAVE.overflowMenu}>···</summary>
                            <div className="plot-grid-thread-menu-body">
                              <Button
                                type="button"
                               
                                disabled={pending || col === 0}
                                onClick={() => moveThread(thread.id, -1)}
                               variant="secondary" size="sm">
                                {WEAVE.moveThreadLeft}
                              </Button>
                              <Button
                                type="button"
                               
                                disabled={pending || col === threads.length - 1}
                                onClick={() => moveThread(thread.id, 1)}
                               variant="secondary" size="sm">
                                {WEAVE.moveThreadRight}
                              </Button>
                              <Button
                                type="button"
                               
                                onClick={() => {
                                  setRenameId(thread.id);
                                  setRenameTitle(thread.title);
                                }}
                               variant="secondary" size="sm">
                                {WEAVE.renameThread}
                              </Button>
                              {confirmDeleteId === thread.id ? (
                                <Button
                                  type="button"
                                 
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
                                 size="sm">
                                  {WEAVE.confirmDeleteThread(thread.title)}
                                </Button>
                              ) : (
                                <Button
                                  type="button"
                                 
                                  onClick={() => setConfirmDeleteId(thread.id)}
                                 variant="secondary" size="sm">
                                  {WEAVE.deleteThread}
                                </Button>
                              )}
                            </div>
                          </details>
                        ) : null}
                      </div>
                    )}
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
                      <Button type="submit" disabled={pending} variant="secondary" size="sm">
                        {WEAVE.addThreadShort}
                      </Button>
                    </form>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {chapters.map((chapter, chapterIndex) => {
                const isCollapsed = Boolean(collapsed[chapter.id]);
                return (
                  <ChapterBlock
                    key={chapter.id}
                    chapter={chapter}
                    chapterIndex={chapterIndex + 1}
                    collapsed={isCollapsed}
                    colSpan={visibleThreads.length + (mobileThreadId ? 1 : 2)}
                    onToggle={() => setCollapsed((c) => ({ ...c, [chapter.id]: !c[chapter.id] }))}
                    visibleThreads={visibleThreads}
                    flatRows={flatRows}
                    beats={beats}
                    focus={focus}
                    selectedId={selectedId}
                    pending={pending}
                    draggingId={draggingId}
                    settlingId={settlingId}
                    dropTarget={dropTarget}
                    cellBeats={cellBeats}
                    onFocusCell={(row, col) => setFocus({ row, col })}
                    onBeatPointerDown={onBeatPointerDown}
                    onBeatClick={onBeatClick}
                    onAddInCell={addInCell}
                    mirroredBeats={(row, thread) =>
                      beats
                        .filter(
                          (beat) =>
                            beat.threadId === thread.id &&
                            matchesFilter(beat) &&
                            beat.manuscriptRecordId !== row.id &&
                            plotRowForManuscript(beat.manuscriptRecordId, rowIds, otherDraftRows) === row.id,
                        )
                        .sort((a, b) => a.cellOrder - b.cellOrder || a.id.localeCompare(b.id))
                    }
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {unplacedBeats.length || draggingId ? (
        <details
          className={`plot-unplaced-tray${dropTarget?.kind === "unplaced" ? " drop-active" : ""}`}
          open
          data-plot-drop="unplaced"
        >
          <summary>{WEAVE.unplacedBeats(unplacedBeats.length)}</summary>
          <p className="small muted plot-unplaced-hint">{WEAVE.unplacedRowHint}</p>
          {unplacedBeats.length ? (
            <ul className="plot-unplaced-list">
              {unplacedBeats.map((beat, index) => (
                <li
                  key={beat.id}
                  className={
                    dropTarget?.kind === "unplaced" && dropTarget.insertIndex === index
                      ? "drop-insert-before"
                      : undefined
                  }
                >
                  <button
                    type="button"
                    data-beat-id={beat.id}
                    className={`plot-grid-beat${beatLinkTagClass(beat)}${selectedId === beat.id ? " selected" : ""}${draggingId === beat.id ? " dragging" : ""}${settlingId === beat.id ? " settling" : ""}`}
                    onPointerDown={(e) => onBeatPointerDown(e, beat)}
                    onClick={(e) => onBeatClick(e, beat)}
                  >
                    <span className="plot-grid-beat-bar" aria-hidden="true" />
                    <span className="plot-grid-beat-title">{beat.title}</span>
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
          ) : (
            <p className="small muted">{WEAVE.dragBeatHint}</p>
          )}
          {dropTarget?.kind === "unplaced" && dropTarget.insertIndex >= unplacedBeats.length ? (
            <div className="plot-drop-slot" aria-hidden="true" />
          ) : null}
        </details>
      ) : null}

      <p className="plot-grid-meta small muted">{WEAVE.plotMeta(sceneCount, threads.length)}</p>
      <span className="sr-only" aria-live="polite">
        {activeDropKey ? WEAVE.dragBeatHint : ""}
      </span>
    </div>
  );
}

function ChapterBlock({
  chapter,
  chapterIndex,
  collapsed,
  colSpan,
  onToggle,
  visibleThreads,
  flatRows,
  beats,
  focus,
  selectedId,
  pending,
  draggingId,
  settlingId,
  dropTarget,
  cellBeats,
  onFocusCell,
  onBeatPointerDown,
  onBeatClick,
  onAddInCell,
  mirroredBeats,
}: {
  chapter: PlotGridChapter;
  chapterIndex: number;
  collapsed: boolean;
  colSpan: number;
  onToggle: () => void;
  visibleThreads: WeaveThreadView[];
  flatRows: PlotGridRow[];
  beats: WeaveBeatView[];
  focus: { row: number; col: number };
  selectedId: string | null;
  pending: boolean;
  draggingId: string | null;
  settlingId: string | null;
  dropTarget: DropTarget | null;
  cellBeats: (row: PlotGridRow, thread: WeaveThreadView) => WeaveBeatView[];
  onFocusCell: (row: number, col: number) => void;
  onBeatPointerDown: (e: ReactPointerEvent<HTMLButtonElement>, beat: WeaveBeatView) => void;
  onBeatClick: (e: React.MouseEvent, beat: WeaveBeatView) => void;
  onAddInCell: (row: PlotGridRow, thread: WeaveThreadView) => void;
  mirroredBeats: (row: PlotGridRow, thread: WeaveThreadView) => WeaveBeatView[];
}) {
  const chapterHeading = (() => {
    const stripped = chapter.title.replace(/^chapter\s+\d+\s*[:·.—-]?\s*/i, "").trim();
    return WEAVE.chapterHeading(chapterIndex, stripped || chapter.title);
  })();

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
            <span className="plot-grid-chapter-chevron" aria-hidden="true">
              ▸
            </span>
            {chapterHeading}
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
            const rowBeats = beats.filter((b) => b.manuscriptRecordId === row.id);
            const subtitle =
              rowBeats.find((b) => b.decisionLabel)?.decisionLabel ||
              rowBeats.find((b) => b.body.trim())?.body.trim().slice(0, 72) ||
              null;
            const sceneTitle =
              row.kind === "chapter"
                ? row.label.replace(/^chapter\s+\d+\s*[:·.—-]?\s*/i, "").trim() || row.label
                : row.label;
            return (
              <tr key={row.id}>
                <th scope="row" className="plot-grid-rowhead">
                  <span className="plot-grid-scene-line">
                    {row.indexLabel ? <span className="plot-grid-scene-index">{row.indexLabel}</span> : null}
                    <strong>{sceneTitle}</strong>
                  </span>
                  {subtitle ? <span className="plot-grid-scene-sub small muted">{subtitle}</span> : null}
                </th>
                {visibleThreads.map((thread, colIdx) => {
                  const inCell = cellBeats(row, thread);
                  const mirrored = mirroredBeats(row, thread);
                  const focused = focus.row === rowIdx && focus.col === colIdx;
                  const cellDrop =
                    dropTarget?.kind === "cell" &&
                    dropTarget.threadId === thread.id &&
                    dropTarget.rowId === row.id;
                  return (
                    <td
                      key={`${row.id}-${thread.id}`}
                      data-plot-drop="cell"
                      data-thread-id={thread.id}
                      data-row-id={row.id}
                      className={`plot-grid-cell thread-tone-${colIdx % 6}${focused ? " focused" : ""}${inCell.length || mirrored.length ? "" : " blank"}${cellDrop ? " drop-active" : ""}`}
                      onClick={() => onFocusCell(rowIdx, colIdx)}
                    >
                      {inCell.length === 0 ? (
                        <button
                          type="button"
                          className="plot-grid-blank-add"
                          disabled={pending}
                          aria-label={WEAVE.blankCellAddHint}
                          title={WEAVE.blankCellAddHint}
                          onClick={() => onAddInCell(row, thread)}
                        >
                          {WEAVE.addBeatInCell}
                        </button>
                      ) : (
                        <ul className="plot-grid-cell-beats">
                          {inCell.map((beat, index) => (
                            <li
                              key={beat.id}
                              className={
                                cellDrop && dropTarget.insertIndex === index ? "drop-insert-before" : undefined
                              }
                            >
                              <button
                                type="button"
                                data-beat-id={beat.id}
                                className={`plot-grid-beat${beatLinkTagClass(beat)}${selectedId === beat.id ? " selected" : ""}${draggingId === beat.id ? " dragging" : ""}${settlingId === beat.id ? " settling" : ""}`}
                                onPointerDown={(e) => onBeatPointerDown(e, beat)}
                                onClick={(e) => onBeatClick(e, beat)}
                              >
                                <span className="plot-grid-beat-bar" aria-hidden="true" />
                                <span className="plot-grid-beat-title">{beat.title}</span>
                              </button>
                            </li>
                          ))}
                          {cellDrop && dropTarget.insertIndex >= inCell.length ? (
                            <li className="drop-insert-before" aria-hidden="true">
                              <div className="plot-drop-slot" />
                            </li>
                          ) : null}
                          <li className="plot-grid-cell-add">
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
                      {mirrored.length ? (
                        <ul className="plot-grid-cell-beats plot-grid-cell-mirror">
                          {mirrored.map((beat) => (
                            <li key={beat.id}>
                              <button
                                type="button"
                                data-beat-id={beat.id}
                                className={`plot-grid-beat plot-grid-beat-mirror${beatLinkTagClass(beat)}${selectedId === beat.id ? " selected" : ""}`}
                                title={WEAVE.otherDraftBeatHint}
                                onClick={(e) => onBeatClick(e, beat)}
                              >
                                <span className="plot-grid-beat-bar" aria-hidden="true" />
                                <span className="plot-grid-beat-title">{beat.title}</span>
                                <span className="small muted">{WEAVE.otherDraftBeat}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {inCell.length === 0 && cellDrop ? <div className="plot-drop-slot" aria-hidden="true" /> : null}
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
