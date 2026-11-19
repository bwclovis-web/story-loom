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
  renameWeaveThreadAction,
  reorderWeaveThreadsAction,
} from "./actions";

export interface PlotGridRow {
  id: string | null;
  label: string;
  kind: "chapter" | "scene" | "unplaced";
  chapterTitle?: string;
}

export function WeavePlotGrid({
  projectId,
  gridId,
  threads: initialThreads,
  beats,
  rows,
  selectedId,
  onSelectBeat,
  onIssues,
}: {
  projectId: string;
  gridId: string;
  threads: WeaveThreadView[];
  beats: WeaveBeatView[];
  rows: PlotGridRow[];
  selectedId: string | null;
  onSelectBeat: (beat: WeaveBeatView | null) => void;
  onIssues: (issues: Issue[]) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [threads, setThreads] = useState(initialThreads);
  const [focus, setFocus] = useState<{ row: number; col: number }>({ row: 0, col: 0 });
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [newThreadTitle, setNewThreadTitle] = useState("");

  useEffect(() => {
    setThreads(initialThreads);
  }, [initialThreads]);

  const rowIds = useMemo(() => new Set(rows.filter((r) => r.id).map((r) => r.id as string)), [rows]);

  const cellBeats = (row: PlotGridRow, thread: WeaveThreadView) => {
    const list = beats.filter((beat) => {
      if (beat.threadId !== thread.id) return false;
      if (row.kind === "unplaced") {
        return !beat.manuscriptRecordId || !rowIds.has(beat.manuscriptRecordId);
      }
      return beat.manuscriptRecordId === row.id;
    });
    return list.sort((a, b) => a.cellOrder - b.cellOrder || a.zIndex - b.zIndex || a.id.localeCompare(b.id));
  };

  const unthreaded = useMemo(
    () => beats.filter((b) => !b.threadId).sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id)),
    [beats],
  );

  const addInCell = (row: PlotGridRow, thread: WeaveThreadView) => {
    startTransition(async () => {
      const result = await addWeaveBeatAction(projectId, gridId, {
        title: "Beat",
        x: 40 + thread.position * 40,
        y: 40,
        threadId: thread.id,
        manuscriptRecordId: row.id,
        cellOrder: cellBeats(row, thread).length,
      });
      if (!result.ok) {
        onIssues(result.issues);
        return;
      }
      onIssues([]);
      onSelectBeat(result.beat);
      router.refresh();
    });
  };

  const onGridKeyDown = (e: ReactKeyboardEvent<HTMLTableElement>) => {
    if (!threads.length || !rows.length) return;
    if (e.key === "Escape") {
      onSelectBeat(null);
      return;
    }
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      setFocus((f) => {
        let { row, col } = f;
        if (e.key === "ArrowLeft") col = Math.max(0, col - 1);
        if (e.key === "ArrowRight") col = Math.min(threads.length - 1, col + 1);
        if (e.key === "ArrowUp") row = Math.max(0, row - 1);
        if (e.key === "ArrowDown") row = Math.min(rows.length - 1, row + 1);
        return { row, col };
      });
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[focus.row];
      const thread = threads[focus.col];
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
    setThreads(next);
    startTransition(async () => {
      const result = await reorderWeaveThreadsAction(
        projectId,
        gridId,
        next.map((t) => t.id),
      );
      if (!result.ok) {
        onIssues(result.issues);
        setThreads(initialThreads);
        return;
      }
      onIssues([]);
      router.refresh();
    });
  };

  return (
    <div className="plot-grid-wrap">
      <p className="small muted">{WEAVE.bookOrderNote}</p>
      <div className="row plot-grid-thread-bar" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
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
              setThreads((list) => [...list, result.thread]);
              router.refresh();
            });
          }}
        >
          <label>
            <span className="sr-only">{WEAVE.threadTitle}</span>
            <input
              value={newThreadTitle}
              onChange={(e) => setNewThreadTitle(e.target.value)}
              placeholder={WEAVE.threadTitle}
              aria-label={WEAVE.threadTitle}
            />
          </label>
          <button type="submit" className="small-button" disabled={pending}>
            {WEAVE.addThread}
          </button>
        </form>
      </div>

      {!threads.length ? (
        <p className="muted">{WEAVE.noThreadsYet}</p>
      ) : (
        <div className="plot-grid-scroll">
          <table
            className="plot-grid-table"
            aria-label={WEAVE.plotGridTable}
            aria-description={WEAVE.plotGridKeyboard}
            tabIndex={0}
            onKeyDown={onGridKeyDown}
          >
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">{WEAVE.plotGridTable}</span>
                </th>
                {threads.map((thread, col) => (
                  <th key={thread.id} scope="col">
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
                            setThreads((list) => list.map((t) => (t.id === thread.id ? result.thread : t)));
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
                      <strong>{thread.title}</strong>
                    )}
                    <div className="row" style={{ gap: "0.25rem", flexWrap: "wrap", marginTop: "0.25rem" }}>
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
                              setThreads((list) => list.filter((t) => t.id !== thread.id));
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
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIdx) => (
                <tr key={row.id ?? `unplaced-${rowIdx}`}>
                  <th scope="row" className="plot-grid-rowhead">
                    <span className="small muted">
                      {row.kind === "chapter"
                        ? WEAVE.chapterOnlyRow
                        : row.kind === "scene"
                          ? WEAVE.sceneRow
                          : WEAVE.unplacedRow}
                    </span>
                    <strong>{row.label}</strong>
                    {row.chapterTitle ? <span className="small muted">{row.chapterTitle}</span> : null}
                    {row.kind === "unplaced" ? <span className="small muted">{WEAVE.unplacedRowHint}</span> : null}
                  </th>
                  {threads.map((thread, colIdx) => {
                    const inCell = cellBeats(row, thread);
                    const focused = focus.row === rowIdx && focus.col === colIdx;
                    return (
                      <td
                        key={`${row.id ?? "u"}-${thread.id}`}
                        className={`plot-grid-cell${focused ? " focused" : ""}${inCell.length ? "" : " blank"}`}
                        onClick={() => setFocus({ row: rowIdx, col: colIdx })}
                      >
                        {inCell.length === 0 ? (
                          <button
                            type="button"
                            className="secondary small-button"
                            disabled={pending}
                            onClick={() => addInCell(row, thread)}
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
                                className="secondary small-button"
                                disabled={pending}
                                onClick={() => addInCell(row, thread)}
                              >
                                {WEAVE.addBeatInCell}
                              </button>
                            </li>
                          </ul>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {unthreaded.length ? (
        <section className="panel" aria-label={WEAVE.unplacedRow}>
          <h3 style={{ marginTop: 0 }}>{WEAVE.unplacedRow}</h3>
          <p className="small muted">{WEAVE.unplacedRowHint}</p>
          <ul className="stack">
            {unthreaded.map((beat) => (
              <li key={beat.id}>
                <button
                  type="button"
                  className={`plot-grid-beat${selectedId === beat.id ? " selected" : ""}`}
                  onClick={() => onSelectBeat(beat)}
                >
                  {beat.title}
                  {beat.manuscriptTitle ? <span className="small muted"> · {beat.manuscriptTitle}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
