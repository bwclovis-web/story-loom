"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { IssueList } from "@/components/IssueList";
import type { DraftOption } from "@/components/drafts/DraftControls";
import { ContextRail, ContextRailToggle, useContextRail } from "@/components/shell/ContextRail";
import { CloseIcon } from "@/components/shell/icons";
import { WRITE_DRAFT_COOKIE, writePreference } from "@/components/shell/preferences";
import type { Issue } from "@/domain/issues";
import type { RewriteSourceView } from "@/server/services/draftService";
import {
  WEAVE_DECISIONS,
  WEAVE_DECISION_LABELS,
  WEAVE_LAYOUT_LABELS,
  type WeaveBeatView,
  type WeaveGridView,
  type WeaveLayoutMode,
  type WeaveSetupPayoffView,
  type WeaveThreadView,
} from "@/server/services/weaveService";
import { previewRewriteSourceAction } from "@/app/projects/[projectId]/drafts/actions";
import { DRAFT, SHELL, WEAVE, WRITE } from "@/ui/labels";
import {
  addWeaveBeatAction,
  addWeaveBeatWorldRefAction,
  addWeaveSetupPayoffAction,
  deleteWeaveGridAction,
  listManuscriptRewriteSourcesAction,
  moveWeaveBeatAction,
  removeWeaveBeatAction,
  removeWeaveBeatWorldRefAction,
  removeWeaveSetupPayoffAction,
  renameWeaveGridAction,
  saveWeaveGridAsTemplateAction,
  setWeaveLayoutModeAction,
  updateWeaveBeatAction,
} from "./actions";
import { WeavePlotGrid, type PlotDensity, type PlotGridChapter } from "./WeavePlotGrid";

export interface SeriesBookOption {
  id: string;
  title: string;
  bookName: string | null;
}

type DirtyBeatDraft = { title: string; body: string };

function dirtyStorageKey(gridId: string) {
  return `storyloom-weave-dirty:${gridId}`;
}

function readDirtyDrafts(gridId: string): Record<string, DirtyBeatDraft> {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(dirtyStorageKey(gridId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, DirtyBeatDraft>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeDirtyDrafts(gridId: string, drafts: Record<string, DirtyBeatDraft>) {
  if (typeof window === "undefined") return;
  try {
    if (Object.keys(drafts).length === 0) sessionStorage.removeItem(dirtyStorageKey(gridId));
    else sessionStorage.setItem(dirtyStorageKey(gridId), JSON.stringify(drafts));
  } catch {
    /* ignore quota */
  }
}

export interface ManuscriptChoice {
  id: string;
  title: string;
  typeLabel: string;
}

export interface WorldChoice {
  id: string;
  title: string;
  typeLabel: string;
}

export interface SeriesBeatChoice {
  id: string;
  title: string;
  gridTitle: string;
  projectTitle: string;
  bookName: string | null;
}

function mergeBeatsPreservingDirty(
  prev: WeaveBeatView[],
  next: WeaveBeatView[],
  dirtyIds: ReadonlySet<string>,
): WeaveBeatView[] {
  const prevById = new Map(prev.map((b) => [b.id, b]));
  return next.map((b) => {
    const local = prevById.get(b.id);
    if (!local || !dirtyIds.has(b.id)) return b;
    return {
      ...b,
      title: local.title,
      body: local.body,
      x: local.x,
      y: local.y,
      width: local.width,
      height: local.height,
    };
  });
}

function beatCenter(beat: WeaveBeatView) {
  return { x: beat.x + beat.width / 2, y: beat.y + beat.height / 2 };
}

export function WeaveCanvas({
  projectId,
  grid: initial,
  projectTitle,
  bookName,
  seriesBooks = [],
  drafts = [],
  activeDraftId = null,
  planLabel,
  manuscriptChoices,
  manuscriptChapters,
  worldChoices,
  seriesBeats,
}: {
  projectId: string;
  grid: WeaveGridView;
  projectTitle?: string;
  bookName?: string | null;
  seriesBooks?: SeriesBookOption[];
  drafts?: DraftOption[];
  activeDraftId?: string | null;
  planLabel?: string;
  manuscriptChoices: ManuscriptChoice[];
  manuscriptChapters: PlotGridChapter[];
  worldChoices: WorldChoice[];
  seriesBeats: SeriesBeatChoice[];
}) {
  const router = useRouter();
  const idPrefix = useId();
  const railId = `${idPrefix}-weave-rail`;
  const titleId = `${railId}-title`;
  const rail = useContextRail();
  const [grid, setGrid] = useState(initial);
  const [beats, setBeats] = useState(() => {
    const stored = readDirtyDrafts(initial.id);
    return initial.beats.map((b) => {
      const d = stored[b.id];
      return d ? { ...b, title: d.title, body: d.body } : b;
    });
  });
  const [threads, setThreads] = useState<WeaveThreadView[]>(initial.threads);
  const [layoutMode, setLayoutMode] = useState<WeaveLayoutMode>(initial.layoutMode);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [decisionFilter, setDecisionFilter] = useState<string>("all");
  const [density, setDensity] = useState<PlotDensity>("compact");
  const [hiddenThreadIds, setHiddenThreadIds] = useState<string[]>([]);
  const [mobileThreadId, setMobileThreadId] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(initial.title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [templateTitle, setTemplateTitle] = useState("");
  const [setupFrom, setSetupFrom] = useState("");
  const [setupTo, setSetupTo] = useState("");
  const [rewriteSources, setRewriteSources] = useState<RewriteSourceView[]>([]);
  const [compareSourceId, setCompareSourceId] = useState("");
  const [comparePreview, setComparePreview] = useState<{
    title: string;
    body: string;
    revisionNumber: number;
  } | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const dirtyIdsRef = useRef(new Set(Object.keys(readDirtyDrafts(initial.id))));
  const dragRef = useRef<{
    beatId: string;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  useEffect(() => {
    setGrid(initial);
    setTitle(initial.title);
    setLayoutMode(initial.layoutMode);
    setThreads(initial.threads);
    setBeats((prev) => mergeBeatsPreservingDirty(prev, initial.beats, dirtyIdsRef.current));
  }, [initial]);

  const persistDirty = useCallback(
    (list: WeaveBeatView[]) => {
      const next: Record<string, DirtyBeatDraft> = {};
      for (const id of dirtyIdsRef.current) {
        const beat = list.find((b) => b.id === id);
        if (beat) next[id] = { title: beat.title, body: beat.body };
      }
      writeDirtyDrafts(initial.id, next);
    },
    [initial.id],
  );

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 759px)");
    const sync = () => {
      setNarrow(mq.matches);
      if (!mq.matches) setMobileThreadId(null);
      else if (threads[0]) setMobileThreadId((id) => id ?? threads[0]!.id);
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [threads]);

  const selected = beats.find((b) => b.id === selectedId) ?? null;

  const visibleBeats = useMemo(() => {
    if (decisionFilter === "all") return beats;
    if (decisionFilter === "unset") return beats.filter((b) => !b.decision);
    return beats.filter((b) => b.decision === decisionFilter);
  }, [beats, decisionFilter]);

  const visibleIds = useMemo(() => new Set(visibleBeats.map((b) => b.id)), [visibleBeats]);

  const localLinks = useMemo(
    () => grid.setupPayoffs.filter((l) => beats.some((b) => b.id === l.fromBeatId) && beats.some((b) => b.id === l.toBeatId)),
    [grid.setupPayoffs, beats],
  );

  const relatedLinks = useMemo(() => {
    if (!selected) return [] as WeaveSetupPayoffView[];
    return grid.setupPayoffs.filter((l) => l.fromBeatId === selected.id || l.toBeatId === selected.id);
  }, [grid.setupPayoffs, selected]);

  const markDirty = (beatId: string) => {
    dirtyIdsRef.current.add(beatId);
  };
  const clearDirty = (beatId: string) => {
    dirtyIdsRef.current.delete(beatId);
  };

  useEffect(() => {
    persistDirty(beats);
  }, [beats, persistDirty]);

  useEffect(() => {
    if (!selected?.manuscriptRecordId || selected.manuscriptUnavailable) {
      setRewriteSources([]);
      setCompareSourceId("");
      setComparePreview(null);
      return;
    }
    const manuscriptRecordId = selected.manuscriptRecordId;
    let cancelled = false;
    void (async () => {
      const result = await listManuscriptRewriteSourcesAction(projectId, manuscriptRecordId);
      if (cancelled) return;
      if (!result.ok) {
        setRewriteSources([]);
        return;
      }
      setRewriteSources(result.sources);
      setCompareSourceId(result.sources[0]?.toRecordId ?? "");
      setComparePreview(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, selected?.id, selected?.manuscriptRecordId, selected?.manuscriptUnavailable]);

  const selectBeat = useCallback(
    (beat: WeaveBeatView) => {
      setSelectedId(beat.id);
      if (!rail.visible) rail.toggle();
    },
    [rail],
  );

  const fitRect = useCallback((targets: WeaveBeatView[]) => {
    const el = surfaceRef.current;
    if (!el || !targets.length) return;
    const pad = 48;
    const minX = Math.min(...targets.map((b) => b.x));
    const minY = Math.min(...targets.map((b) => b.y));
    const maxX = Math.max(...targets.map((b) => b.x + b.width));
    const maxY = Math.max(...targets.map((b) => b.y + b.height));
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    el.scrollTo({
      left: Math.max(0, midX - el.clientWidth / 2),
      top: Math.max(0, midY - el.clientHeight / 2 + pad / 2),
      behavior: "smooth",
    });
  }, []);

  const onPointerDown = (e: ReactPointerEvent, beat: WeaveBeatView) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      beatId: beat.id,
      startX: e.clientX,
      startY: e.clientY,
      originX: beat.x,
      originY: beat.y,
    };
    selectBeat(beat);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.beatId !== e.currentTarget.getAttribute("data-beat-id")) return;
    const x = Math.max(0, Math.round(drag.originX + (e.clientX - drag.startX)));
    const y = Math.max(0, Math.round(drag.originY + (e.clientY - drag.startY)));
    markDirty(drag.beatId);
    setBeats((list) => list.map((b) => (b.id === drag.beatId ? { ...b, x, y } : b)));
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    const beat = beats.find((b) => b.id === drag.beatId);
    if (!beat) return;
    if (beat.x === drag.originX && beat.y === drag.originY) return;
    startTransition(async () => {
      const result = await moveWeaveBeatAction(projectId, grid.id, beat.id, { x: beat.x, y: beat.y });
      if (!result.ok) {
        setIssues(result.issues);
        setBeats(initial.beats);
        dirtyIdsRef.current.clear();
        return;
      }
      clearDirty(beat.id);
      setBeats((list) => list.map((b) => (b.id === result.beat.id ? result.beat : b)));
      router.refresh();
    });
  };

  const dropPoint = () => {
    const el = surfaceRef.current;
    if (!el) return { x: 40, y: 40 };
    return { x: Math.round(el.scrollLeft + 48), y: Math.round(el.scrollTop + 48) };
  };

  const onSurfaceKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      setSelectedId(null);
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      fitRect(visibleBeats);
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    if (!visibleBeats.length) return;
    e.preventDefault();
    const ordered = [...visibleBeats].sort((a, b) => a.y - b.y || a.x - b.x);
    const idx = selectedId ? ordered.findIndex((b) => b.id === selectedId) : -1;
    let nextIdx = idx;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") nextIdx = idx < 0 ? 0 : Math.min(ordered.length - 1, idx + 1);
    else nextIdx = idx <= 0 ? ordered.length - 1 : idx - 1;
    const next = ordered[nextIdx];
    if (next) {
      selectBeat(next);
      fitRect([next]);
    }
  };

  const decisionClass = (decision: string) =>
    decision ? ` board-card-decision-${decision}` : "";

  const setLayout = (next: WeaveLayoutMode) => {
    setLayoutMode(next);
    startTransition(async () => {
      const result = await setWeaveLayoutModeAction(projectId, grid.id, next);
      if (!result.ok) {
        setIssues(result.issues);
        setLayoutMode(initial.layoutMode);
        return;
      }
      setIssues([]);
      router.refresh();
    });
  };

  const addBeat = () => {
    if (layoutMode === "plot_grid" && threads[0]) {
      const firstRow = manuscriptChapters[0]?.rows[0];
      const visibleThread =
        threads.find((t) => !hiddenThreadIds.includes(t.id)) ?? threads[0];
      startTransition(async () => {
        const result = await addWeaveBeatAction(projectId, grid.id, {
          title: "Beat",
          x: 40,
          y: 40,
          threadId: visibleThread.id,
          manuscriptRecordId: firstRow?.id ?? null,
          cellOrder: 0,
        });
        if (!result.ok) {
          setIssues(result.issues);
          return;
        }
        setBeats((list) => [...list, result.beat]);
        selectBeat(result.beat);
        router.refresh();
      });
      return;
    }
    const { x, y } = dropPoint();
    startTransition(async () => {
      const result = await addWeaveBeatAction(projectId, grid.id, {
        title: "Beat",
        x,
        y,
      });
      if (!result.ok) {
        setIssues(result.issues);
        return;
      }
      setBeats((list) => [...list, result.beat]);
      selectBeat(result.beat);
      router.refresh();
    });
  };

  const isPlotGrid = layoutMode === "plot_grid";
  const visibleThreadCount = threads.filter((t) => !hiddenThreadIds.includes(t.id)).length;

  return (
    <div className={`write-layout reference-write-layout board-layout${isPlotGrid ? " plot-grid-layout" : ""}`}>
      <div className="write-main board-main">
        {isPlotGrid ? (
          <div className="plot-grid-selectors" role="group" aria-label={WEAVE.selectorsAria}>
            {projectTitle ? (
              <span className="plot-grid-selector plot-grid-selector-static">
                <span className="plot-grid-selector-icon" aria-hidden="true">
                  ▦
                </span>
                {projectTitle}
              </span>
            ) : null}
            {seriesBooks.length > 1 ? (
              <label className="plot-grid-selector plot-grid-selector-control">
                <span className="sr-only">{WEAVE.bookSelector}</span>
                <select
                  value={projectId}
                  aria-label={WEAVE.bookSelector}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    if (nextId && nextId !== projectId) {
                      router.push(`/projects/${encodeURIComponent(nextId)}/plan/weave`);
                    }
                  }}
                >
                  {seriesBooks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.bookName || b.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : bookName ? (
              <span className="plot-grid-selector plot-grid-selector-static">{bookName}</span>
            ) : null}
            {drafts.length > 0 ? (
              <label className="plot-grid-selector plot-grid-selector-control">
                <span className="sr-only">{WEAVE.planSelector}</span>
                <select
                  value={activeDraftId ?? ""}
                  aria-label={WEAVE.planSelector}
                  onChange={(e) => {
                    writePreference(WRITE_DRAFT_COOKIE, e.target.value);
                    router.refresh();
                  }}
                >
                  {drafts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : planLabel ? (
              <span className="plot-grid-selector plot-grid-selector-static">{planLabel}</span>
            ) : null}
          </div>
        ) : null}

        <div className="doc-toolbar">
          <h2 className="board-title-display">{isPlotGrid ? WEAVE.plotGridHeading : title}</h2>
          <div className="doc-toolbar-end">
            <ContextRailToggle rail={rail} controls={railId} />
          </div>
        </div>

        {!isPlotGrid ? (
          <>
            <p className="board-meta small muted">
              <span>{grid.viewLabel}</span>
              <span>{WEAVE_LAYOUT_LABELS[layoutMode]}</span>
              <span>{WEAVE.beatsCount(beats.length)}</span>
            </p>
            <p className="small muted" style={{ margin: 0 }}>
              {WEAVE.layoutHint}
            </p>
          </>
        ) : null}
        <IssueList issues={issues} />

        <div className="board-toolbar board-toolbar-compact" role="toolbar" aria-label={WEAVE.beatCanvas}>
          <div className="board-toolbar-group">
            <div className="segmented-control" role="group" aria-label={WEAVE.toolbarView}>
              <button
                type="button"
                className={isPlotGrid ? "is-selected" : undefined}
                aria-pressed={isPlotGrid}
                disabled={pending}
                onClick={() => {
                  if (!isPlotGrid) setLayout("plot_grid");
                }}
              >
                {WEAVE.layoutPlotGrid}
              </button>
              <button
                type="button"
                className={!isPlotGrid ? "is-selected" : undefined}
                aria-pressed={!isPlotGrid}
                disabled={pending}
                onClick={() => {
                  if (isPlotGrid) setLayout("freeform");
                }}
              >
                {WEAVE.layoutFreeform}
              </button>
            </div>
          </div>

          <div className="board-toolbar-group board-toolbar-grow">
            {isPlotGrid ? (
              <details className="board-threads-menu">
                <summary>{WEAVE.threadsControl(visibleThreadCount)}</summary>
                <div className="board-threads-menu-body">
                  {threads.length === 0 ? (
                    <p className="small muted">{WEAVE.noThreadsYet}</p>
                  ) : (
                    <ul className="stack">
                      {threads.map((t, i) => {
                        const checked = !hiddenThreadIds.includes(t.id);
                        return (
                          <li key={t.id}>
                            <label className="row" style={{ gap: "0.4rem" }}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  setHiddenThreadIds((ids) => {
                                    if (checked) {
                                      if (ids.length + 1 >= threads.length) return ids;
                                      return [...ids, t.id];
                                    }
                                    return ids.filter((id) => id !== t.id);
                                  });
                                }}
                              />
                              <span className={`plot-grid-thread-dot thread-tone-${i % 6}`} aria-hidden="true" />
                              <span>{t.title}</span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </details>
            ) : null}
            <label className="small board-toolbar-select">
              <span className="sr-only">{WEAVE.filterDecision}</span>
              <select
                value={decisionFilter}
                aria-label={WEAVE.filterLabeled}
                onChange={(e) => setDecisionFilter(e.target.value)}
              >
                <option value="all">{WEAVE.filterAll}</option>
                <option value="unset">{WEAVE.decisionUnset}</option>
                {WEAVE_DECISIONS.map((d) => (
                  <option key={d} value={d}>
                    {WEAVE_DECISION_LABELS[d]}
                  </option>
                ))}
              </select>
            </label>
            {isPlotGrid ? (
              <label className="small board-toolbar-select">
                <span className="sr-only">{WEAVE.density}</span>
                <select
                  value={density}
                  aria-label={WEAVE.density}
                  onChange={(e) => setDensity(e.target.value as PlotDensity)}
                >
                  <option value="compact">{WEAVE.densityLabeled(WEAVE.densityCompact)}</option>
                  <option value="comfortable">{WEAVE.densityLabeled(WEAVE.densityComfortable)}</option>
                </select>
              </label>
            ) : null}
            {isPlotGrid && narrow && threads.length ? (
              <label className="small">
                <span className="sr-only">{WEAVE.chooseMobileThread}</span>
                <select
                  value={mobileThreadId ?? threads[0]!.id}
                  aria-label={WEAVE.chooseMobileThread}
                  onChange={(e) => setMobileThreadId(e.target.value)}
                >
                  {threads.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {!isPlotGrid ? (
              <>
                <button
                  type="button"
                  className="secondary small-button"
                  disabled={!selected}
                  onClick={() => selected && fitRect([selected])}
                >
                  {WEAVE.fitSelection}
                </button>
                <button
                  type="button"
                  className="secondary small-button"
                  disabled={!visibleBeats.length}
                  onClick={() => fitRect(visibleBeats)}
                >
                  {WEAVE.fitAll}
                </button>
              </>
            ) : null}
          </div>

          <div className="board-toolbar-group board-toolbar-actions">
            <button
              type="button"
              className={isPlotGrid ? "small-button" : "secondary small-button"}
              disabled={pending}
              onClick={addBeat}
            >
              {isPlotGrid ? WEAVE.addBeatPrimary : WEAVE.addBeat}
            </button>
          </div>

          <details className="board-overflow">
            <summary aria-label={SHELL.moreActions}>{WEAVE.overflowMenu}</summary>
            <div className="board-overflow-body">
              <form
                className="row"
                style={{ gap: "0.35rem", flexWrap: "wrap" }}
                onSubmit={(e) => {
                  e.preventDefault();
                  startTransition(async () => {
                    const result = await renameWeaveGridAction(projectId, grid.id, title);
                    if (!result.ok) setIssues(result.issues);
                    else {
                      setIssues([]);
                      router.refresh();
                    }
                  });
                }}
              >
                <label className="board-title-field">
                  <span className="sr-only">{WEAVE.renameGrid}</span>
                  <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required />
                </label>
                <button type="submit" className="secondary small-button" disabled={pending}>
                  {WEAVE.renameGrid}
                </button>
              </form>
              <form
                className="row"
                style={{ gap: "0.35rem", flexWrap: "wrap" }}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!templateTitle.trim()) return;
                  startTransition(async () => {
                    const result = await saveWeaveGridAsTemplateAction(projectId, grid.id, { title: templateTitle });
                    if (!result.ok) setIssues(result.issues);
                    else {
                      setTemplateTitle("");
                      router.push(`/projects/${encodeURIComponent(projectId)}/plan/weave/templates`);
                    }
                  });
                }}
              >
                <input
                  value={templateTitle}
                  onChange={(e) => setTemplateTitle(e.target.value)}
                  placeholder={WEAVE.templateTitle}
                  aria-label={WEAVE.saveGridAsTemplate}
                />
                <button type="submit" className="secondary small-button" disabled={pending || !templateTitle.trim()}>
                  {WEAVE.saveGridAsTemplate}
                </button>
              </form>
              {isPlotGrid ? (
                <form
                  className="stack"
                  style={{ gap: "0.5rem" }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!setupFrom || !setupTo) return;
                    startTransition(async () => {
                      const result = await addWeaveSetupPayoffAction(projectId, {
                        fromBeatId: setupFrom,
                        toBeatId: setupTo,
                      });
                      if (!result.ok) setIssues(result.issues);
                      else {
                        setSetupFrom("");
                        setSetupTo("");
                        router.refresh();
                      }
                    });
                  }}
                >
                  <p className="small muted" style={{ margin: 0 }}>
                    {WEAVE.setupPayoff}
                  </p>
                  <label className="small">
                    {WEAVE.setupBeat}
                    <select value={setupFrom} onChange={(e) => setSetupFrom(e.target.value)} required>
                      <option value="">{WEAVE.chooseBeat}</option>
                      {seriesBeats.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.title} — {b.bookName || b.projectTitle} / {b.gridTitle}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="small">
                    {WEAVE.payoffBeat}
                    <select value={setupTo} onChange={(e) => setSetupTo(e.target.value)} required>
                      <option value="">{WEAVE.chooseBeat}</option>
                      {seriesBeats.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.title} — {b.bookName || b.projectTitle} / {b.gridTitle}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="submit" className="small-button" disabled={pending || !setupFrom || !setupTo}>
                    {WEAVE.addSetupPayoff}
                  </button>
                </form>
              ) : null}
              <p className="small muted" style={{ margin: 0 }}>
                {WEAVE.bookOrderNote}
              </p>
              {!confirmDelete ? (
                <button type="button" className="secondary small-button" onClick={() => setConfirmDelete(true)}>
                  {WEAVE.deleteGrid}
                </button>
              ) : (
                <button
                  type="button"
                  className="small-button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await deleteWeaveGridAction(projectId, grid.id);
                      if (!result.ok) {
                        setIssues(result.issues);
                        return;
                      }
                      router.push(`/projects/${encodeURIComponent(projectId)}/plan/weave`);
                    })
                  }
                >
                  {WEAVE.confirmDeleteGrid(grid.title)}
                </button>
              )}
            </div>
          </details>
        </div>

        {isPlotGrid ? (
          <WeavePlotGrid
            projectId={projectId}
            gridId={grid.id}
            threads={threads}
            beats={beats}
            chapters={manuscriptChapters}
            selectedId={selectedId}
            decisionFilter={decisionFilter}
            density={density}
            hiddenThreadIds={hiddenThreadIds}
            mobileThreadId={narrow ? mobileThreadId ?? threads[0]?.id ?? null : null}
            onSelectBeat={(beat) => {
              if (beat) selectBeat(beat);
              else setSelectedId(null);
            }}
            onIssues={setIssues}
            onBeatsChange={setBeats}
            onThreadsChange={setThreads}
          />
        ) : null}

        {layoutMode === "freeform" ? (
        <div
          ref={surfaceRef}
          className="board-surface board-surface-max"
          role="listbox"
          aria-label={WEAVE.beatCanvas}
          aria-description={WEAVE.keyboardHint}
          aria-activedescendant={selectedId ? `${idPrefix}-beat-${selectedId}` : undefined}
          tabIndex={0}
          onClick={() => setSelectedId(null)}
          onKeyDown={onSurfaceKeyDown}
        >
          <svg className="board-links-layer" aria-hidden="true">
            {localLinks.map((link) => {
              const from = beats.find((b) => b.id === link.fromBeatId);
              const to = beats.find((b) => b.id === link.toBeatId);
              if (!from || !to) return null;
              const a = beatCenter(from);
              const b = beatCenter(to);
              const active = selectedId === link.fromBeatId || selectedId === link.toBeatId;
              return (
                <line
                  key={link.id}
                  className={`board-link-line${active ? " active" : ""}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                />
              );
            })}
          </svg>

          {!beats.length ? (
            <div className="board-surface-empty">
              <strong>{WEAVE.emptyCanvas}</strong>
              <p className="small muted" style={{ margin: 0 }}>
                {WEAVE.emptyCanvasHint}
              </p>
            </div>
          ) : null}

          {beats.length > 0 && visibleBeats.length === 0 ? (
            <div className="board-surface-empty">
              <strong>{WEAVE.filterEmpty}</strong>
            </div>
          ) : null}

          {beats.map((beat) => {
            const hidden = !visibleIds.has(beat.id);
            return (
              <div
                key={beat.id}
                id={`${idPrefix}-beat-${beat.id}`}
                data-beat-id={beat.id}
                role="option"
                aria-selected={selectedId === beat.id}
                tabIndex={-1}
                className={`board-card${selectedId === beat.id ? " selected" : ""}${hidden ? " dimmed" : ""}${decisionClass(beat.decision)}`}
                style={{
                  left: beat.x,
                  top: beat.y,
                  width: beat.width,
                  minHeight: beat.height,
                  zIndex: beat.zIndex + (selectedId === beat.id ? 1000 : 0),
                  visibility: hidden ? "hidden" : undefined,
                  pointerEvents: hidden ? "none" : undefined,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  selectBeat(beat);
                }}
                onPointerDown={(e) => onPointerDown(e, beat)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
              >
                <p className="board-card-kind">{beat.decisionLabel || WEAVE.decisionUnset}</p>
                <p className="board-card-title">{beat.title}</p>
                {beat.manuscriptTitle ? (
                  <p className="board-card-meta">
                    {beat.manuscriptTitle}
                    {beat.manuscriptUnavailable ? " (Trash)" : ""}
                  </p>
                ) : null}
                {beat.worldRefs.length ? (
                  <p className="board-card-meta">
                    {beat.worldRefs.length} World cite{beat.worldRefs.length === 1 ? "" : "s"}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
        ) : null}

        {!isPlotGrid ? (
          <section className="panel" aria-labelledby={`${idPrefix}-setup`}>
            <h2 id={`${idPrefix}-setup`}>{WEAVE.setupPayoff}</h2>
            <p className="small muted">{WEAVE.setupPayoffNote}</p>
            {grid.setupPayoffs.length === 0 ? (
              <p className="muted">{WEAVE.noSetupPayoff}</p>
            ) : (
              <ul className="stack">
                {grid.setupPayoffs.map((link) => (
                  <li key={link.id} className="row" style={{ justifyContent: "space-between", gap: "0.5rem" }}>
                    <span className="small">
                      {link.fromTitle}
                      {link.fromProjectId !== projectId ? ` (${link.fromProjectTitle})` : ""} → {link.toTitle}
                      {link.toProjectId !== projectId ? ` (${link.toProjectTitle})` : ""}
                      {link.note ? ` — ${link.note}` : ""}
                    </span>
                    <button
                      type="button"
                      className="secondary small-button"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          const result = await removeWeaveSetupPayoffAction(projectId, link.id);
                          if (!result.ok) setIssues(result.issues);
                          else router.refresh();
                        })
                      }
                    >
                      {WEAVE.removeSetupPayoff}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form
              className="row"
              style={{ flexWrap: "wrap", gap: "0.5rem", marginTop: "0.75rem" }}
              onSubmit={(e) => {
                e.preventDefault();
                if (!setupFrom || !setupTo) return;
                startTransition(async () => {
                  const result = await addWeaveSetupPayoffAction(projectId, {
                    fromBeatId: setupFrom,
                    toBeatId: setupTo,
                  });
                  if (!result.ok) setIssues(result.issues);
                  else {
                    setSetupFrom("");
                    setSetupTo("");
                    router.refresh();
                  }
                });
              }}
            >
              <label>
                {WEAVE.setupBeat}
                <select value={setupFrom} onChange={(e) => setSetupFrom(e.target.value)} required>
                  <option value="">{WEAVE.chooseBeat}</option>
                  {seriesBeats.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title} — {b.bookName || b.projectTitle} / {b.gridTitle}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {WEAVE.payoffBeat}
                <select value={setupTo} onChange={(e) => setSetupTo(e.target.value)} required>
                  <option value="">{WEAVE.chooseBeat}</option>
                  {seriesBeats.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title} — {b.bookName || b.projectTitle} / {b.gridTitle}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="small-button" disabled={pending || !setupFrom || !setupTo}>
                {WEAVE.addSetupPayoff}
              </button>
            </form>
          </section>
        ) : null}
      </div>

      <ContextRail id={railId} labelledBy={titleId} rail={rail} focusOnOverlayOpen>
        <div className="context-head">
          <h2 id={titleId}>{selected && isPlotGrid ? selected.title : WEAVE.beatRail}</h2>
          {!rail.wide ? (
            <button type="button" className="icon-button" aria-label={WRITE.hideContext} onClick={rail.close}>
              <CloseIcon />
            </button>
          ) : null}
        </div>
        <div className="context-body">
        {!selected ? (
          <p className="rail-empty">{WEAVE.noBeatSelected}</p>
        ) : (
          <div className="stack">
            <div className="rail-section">
              {isPlotGrid ? (
                <>
                  <label>
                    {WEAVE.storyThread}
                    <select
                      value={selected.threadId ?? ""}
                      onChange={(e) => {
                        const threadId = e.target.value || null;
                        startTransition(async () => {
                          const result = await updateWeaveBeatAction(projectId, grid.id, selected.id, { threadId });
                          if (!result.ok) setIssues(result.issues);
                          else {
                            setBeats((list) => list.map((b) => (b.id === selected.id && result.ok ? result.beat : b)));
                            router.refresh();
                          }
                        });
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
                  <label>
                    {WEAVE.linkManuscript}
                    <select
                      value={selected.manuscriptRecordId ?? ""}
                      onChange={(e) => {
                        const manuscriptRecordId = e.target.value || null;
                        startTransition(async () => {
                          const result = await updateWeaveBeatAction(projectId, grid.id, selected.id, {
                            manuscriptRecordId,
                          });
                          if (!result.ok) setIssues(result.issues);
                          else {
                            setBeats((list) => list.map((b) => (b.id === selected.id && result.ok ? result.beat : b)));
                            router.refresh();
                          }
                        });
                      }}
                    >
                      <option value="">{WEAVE.chooseManuscript}</option>
                      {manuscriptChoices.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title} ({c.typeLabel})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {WEAVE.beatNote}
                    <textarea
                      rows={4}
                      value={selected.body}
                      onChange={(e) => {
                        markDirty(selected.id);
                        setBeats((list) => list.map((b) => (b.id === selected.id ? { ...b, body: e.target.value } : b)));
                      }}
                      onBlur={() =>
                        startTransition(async () => {
                          const result = await updateWeaveBeatAction(projectId, grid.id, selected.id, {
                            body: selected.body,
                          });
                          if (!result.ok) setIssues(result.issues);
                          else {
                            clearDirty(selected.id);
                            router.refresh();
                          }
                        })
                      }
                    />
                  </label>
                  <label>
                    {WEAVE.beatTitle}
                    <input
                      value={selected.title}
                      onChange={(e) => {
                        markDirty(selected.id);
                        setBeats((list) => list.map((b) => (b.id === selected.id ? { ...b, title: e.target.value } : b)));
                      }}
                      onBlur={() =>
                        startTransition(async () => {
                          const result = await updateWeaveBeatAction(projectId, grid.id, selected.id, {
                            title: selected.title,
                          });
                          if (!result.ok) setIssues(result.issues);
                          else {
                            clearDirty(selected.id);
                            router.refresh();
                          }
                        })
                      }
                    />
                  </label>
                  <label>
                    {WEAVE.decision}
                    <select
                      value={selected.decision}
                      onChange={(e) => {
                        const decision = e.target.value;
                        startTransition(async () => {
                          const result = await updateWeaveBeatAction(projectId, grid.id, selected.id, { decision });
                          if (!result.ok) setIssues(result.issues);
                          else {
                            setBeats((list) => list.map((b) => (b.id === selected.id && result.ok ? result.beat : b)));
                            router.refresh();
                          }
                        });
                      }}
                    >
                      <option value="">{WEAVE.decisionUnset}</option>
                      {WEAVE_DECISIONS.map((d) => (
                        <option key={d} value={d}>
                          {WEAVE_DECISION_LABELS[d]}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : (
                <>
                  <label>
                    {WEAVE.beatTitle}
                    <input
                      value={selected.title}
                      onChange={(e) => {
                        markDirty(selected.id);
                        setBeats((list) => list.map((b) => (b.id === selected.id ? { ...b, title: e.target.value } : b)));
                      }}
                      onBlur={() =>
                        startTransition(async () => {
                          const result = await updateWeaveBeatAction(projectId, grid.id, selected.id, {
                            title: selected.title,
                          });
                          if (!result.ok) setIssues(result.issues);
                          else {
                            clearDirty(selected.id);
                            router.refresh();
                          }
                        })
                      }
                    />
                  </label>
                  <label>
                    {WEAVE.beatBody}
                    <textarea
                      rows={4}
                      value={selected.body}
                      onChange={(e) => {
                        markDirty(selected.id);
                        setBeats((list) => list.map((b) => (b.id === selected.id ? { ...b, body: e.target.value } : b)));
                      }}
                      onBlur={() =>
                        startTransition(async () => {
                          const result = await updateWeaveBeatAction(projectId, grid.id, selected.id, {
                            body: selected.body,
                          });
                          if (!result.ok) setIssues(result.issues);
                          else {
                            clearDirty(selected.id);
                            router.refresh();
                          }
                        })
                      }
                    />
                  </label>
                  <label>
                    {WEAVE.decision}
                    <select
                      value={selected.decision}
                      onChange={(e) => {
                        const decision = e.target.value;
                        startTransition(async () => {
                          const result = await updateWeaveBeatAction(projectId, grid.id, selected.id, { decision });
                          if (!result.ok) setIssues(result.issues);
                          else {
                            setBeats((list) => list.map((b) => (b.id === selected.id && result.ok ? result.beat : b)));
                            router.refresh();
                          }
                        });
                      }}
                    >
                      <option value="">{WEAVE.decisionUnset}</option>
                      {WEAVE_DECISIONS.map((d) => (
                        <option key={d} value={d}>
                          {WEAVE_DECISION_LABELS[d]}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
            </div>

            {!isPlotGrid ? (
            <div className="rail-section">
              <h3>{WEAVE.sceneSection}</h3>
              <label>
                {WEAVE.linkManuscript}
                <select
                  value={selected.manuscriptRecordId ?? ""}
                  onChange={(e) => {
                    const manuscriptRecordId = e.target.value || null;
                    startTransition(async () => {
                      const result = await updateWeaveBeatAction(projectId, grid.id, selected.id, {
                        manuscriptRecordId,
                      });
                      if (!result.ok) setIssues(result.issues);
                      else {
                        setBeats((list) => list.map((b) => (b.id === selected.id && result.ok ? result.beat : b)));
                        router.refresh();
                      }
                    });
                  }}
                >
                  <option value="">{WEAVE.chooseManuscript}</option>
                  {manuscriptChoices.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title} ({c.typeLabel})
                    </option>
                  ))}
                </select>
              </label>
              {selected.manuscriptRecordId && !selected.manuscriptUnavailable ? (
                <Link
                  className="button-link"
                  href={`/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(selected.manuscriptRecordId)}`}
                >
                  {WEAVE.openSceneInWrite}
                </Link>
              ) : (
                <p className="rail-empty">{WEAVE.noSceneLinked}</p>
              )}
            </div>
            ) : null}

            <div className="rail-section">
              <h3>{WEAVE.worldRefs}</h3>
              <ul className="context-links">
                {selected.worldRefs.map((ref) => (
                  <li key={ref.id} className="row" style={{ justifyContent: "space-between", gap: "0.35rem" }}>
                    <span>
                      {ref.unavailable ? (
                        `${ref.title} (Trash)`
                      ) : (
                        <Link href={`/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(ref.recordId)}`}>
                          {ref.title}
                        </Link>
                      )}{" "}
                      <span className="muted">({ref.typeLabel})</span>
                    </span>
                    <button
                      type="button"
                      className="secondary small-button"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          const result = await removeWeaveBeatWorldRefAction(
                            projectId,
                            grid.id,
                            selected.id,
                            ref.id,
                          );
                          if (!result.ok) setIssues(result.issues);
                          else {
                            setBeats((list) =>
                              list.map((b) => (b.id === selected.id && result.ok ? result.beat : b)),
                            );
                            router.refresh();
                          }
                        })
                      }
                    >
                      {WEAVE.removeWorldRef}
                    </button>
                  </li>
                ))}
              </ul>
              {!selected.worldRefs.length ? <p className="rail-empty">{WEAVE.chooseWorld}</p> : null}
              <select
                defaultValue=""
                disabled={pending}
                aria-label={WEAVE.chooseWorld}
                onChange={(e) => {
                  const recordId = e.target.value;
                  e.target.value = "";
                  if (!recordId) return;
                  startTransition(async () => {
                    const result = await addWeaveBeatWorldRefAction(projectId, grid.id, selected.id, recordId);
                    if (!result.ok) setIssues(result.issues);
                    else {
                      setBeats((list) => list.map((b) => (b.id === selected.id && result.ok ? result.beat : b)));
                      router.refresh();
                    }
                  });
                }}
              >
                <option value="">{WEAVE.chooseWorld}</option>
                {worldChoices.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} ({c.typeLabel})
                  </option>
                ))}
              </select>
            </div>

            <div className="rail-section">
              <h3>{isPlotGrid ? WEAVE.linksSection : WEAVE.relatedConnections}</h3>
              {relatedLinks.length === 0 ? (
                <p className="rail-empty">{WEAVE.noRelatedConnections}</p>
              ) : (
                <ul className={`context-links${isPlotGrid ? " plot-rail-links" : ""}`}>
                  {relatedLinks.map((link) => {
                    const isSetup = link.fromBeatId === selected.id;
                    return (
                      <li key={link.id} className="small">
                        {isPlotGrid ? (
                          <>
                            <span className="plot-rail-link-kind">{isSetup ? WEAVE.setupLink : WEAVE.payoffLink}</span>
                            <span>
                              {isSetup
                                ? link.toTitle
                                : link.fromTitle}
                              {link.note ? ` — ${link.note}` : ""}
                            </span>
                          </>
                        ) : (
                          <>
                            {link.fromTitle} → {link.toTitle}
                            {link.note ? ` — ${link.note}` : ""}
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {isPlotGrid ? (
              <div className="rail-section plot-rail-actions">
                {selected.manuscriptRecordId && !selected.manuscriptUnavailable ? (
                  <Link
                    className="button-link"
                    href={`/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(selected.manuscriptRecordId)}`}
                  >
                    {WEAVE.openSceneInWrite}
                  </Link>
                ) : (
                  <p className="rail-empty">{WEAVE.noSceneLinked}</p>
                )}
                {rewriteSources.length > 0 ? (
                  <div className="plot-rail-compare">
                    <p className="small" style={{ margin: 0 }}>
                      <span className="muted">{WEAVE.compareZeroDraftSource}</span>
                    </p>
                    {rewriteSources.length > 1 ? (
                      <label className="small">
                        <span className="sr-only">{WEAVE.chooseZeroDraftSource}</span>
                        <select
                          value={compareSourceId}
                          aria-label={WEAVE.chooseZeroDraftSource}
                          onChange={(e) => {
                            setCompareSourceId(e.target.value);
                            setComparePreview(null);
                          }}
                        >
                          {rewriteSources.map((s) => (
                            <option key={s.toRecordId} value={s.toRecordId}>
                              {s.title} ({DRAFT.sourceRevision(s.toRevisionNumber)})
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <p className="small muted" style={{ margin: 0 }}>
                        {rewriteSources[0]!.title} · {DRAFT.sourceRevision(rewriteSources[0]!.toRevisionNumber)}
                      </p>
                    )}
                    <button
                      type="button"
                      className="secondary small-button"
                      disabled={pending || !compareSourceId}
                      onClick={() => {
                        const source = rewriteSources.find((s) => s.toRecordId === compareSourceId);
                        if (!source) return;
                        startTransition(async () => {
                          const result = await previewRewriteSourceAction(
                            projectId,
                            source.toRecordId,
                            source.toRevisionNumber,
                          );
                          if (!result.ok) {
                            setIssues(result.issues);
                            return;
                          }
                          setComparePreview({
                            title: result.title,
                            body: result.body,
                            revisionNumber: result.revisionNumber,
                          });
                        });
                      }}
                    >
                      {WEAVE.compareZeroDraft}
                    </button>
                    {comparePreview ? (
                      <div className="plot-rail-compare-preview" aria-label={comparePreview.title}>
                        <div className="row" style={{ justifyContent: "space-between", gap: "0.35rem" }}>
                          <strong className="small">
                            {comparePreview.title}{" "}
                            <span className="muted">{DRAFT.sourceRevision(comparePreview.revisionNumber)}</span>
                          </strong>
                          <button
                            type="button"
                            className="secondary small-button"
                            onClick={() => setComparePreview(null)}
                          >
                            {WEAVE.closeZeroDraftCompare}
                          </button>
                        </div>
                        <pre className="plot-rail-compare-body small">{comparePreview.body || "—"}</pre>
                      </div>
                    ) : null}
                  </div>
                ) : selected.manuscriptRecordId && !selected.manuscriptUnavailable ? (
                  <p className="small muted">{WEAVE.noZeroDraftSources}</p>
                ) : null}
                <div className="plot-rail-footer">
                  <span className="small muted" aria-live="polite">
                    {pending ? WEAVE.savingStatus : WEAVE.savedStatus}
                  </span>
                  <button
                    type="button"
                    className="secondary small-button"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await removeWeaveBeatAction(projectId, grid.id, selected.id);
                        if (!result.ok) {
                          setIssues(result.issues);
                          return;
                        }
                        dirtyIdsRef.current.delete(selected.id);
                        persistDirty(beats.filter((b) => b.id !== selected.id));
                        setBeats((list) => list.filter((b) => b.id !== selected.id));
                        setSelectedId(null);
                        router.refresh();
                      })
                    }
                  >
                    {WEAVE.removeBeat}
                  </button>
                </div>
              </div>
            ) : (
              <div className="rail-section">
                <p className="small muted">{WEAVE.removeBeatNote}</p>
                <button
                  type="button"
                  className="secondary small-button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await removeWeaveBeatAction(projectId, grid.id, selected.id);
                      if (!result.ok) {
                        setIssues(result.issues);
                        return;
                      }
                      dirtyIdsRef.current.delete(selected.id);
                      setBeats((list) => list.filter((b) => b.id !== selected.id));
                      setSelectedId(null);
                      router.refresh();
                    })
                  }
                >
                  {WEAVE.removeBeat}
                </button>
              </div>
            )}
          </div>
        )}
        </div>
      </ContextRail>
    </div>
  );
}
