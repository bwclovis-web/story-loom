"use client";

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
import { BoardOverflowMenu } from "@/components/ui/BoardOverflowMenu";
import { Button, ButtonLink } from "@/components/ui/Button";
import { CanvasToolbar, CanvasToolbarGroup } from "@/components/ui/CanvasToolbar";
import { IconButton } from "@/components/ui/IconButton";
import { SegmentedControl, SegmentedOption } from "@/components/ui/SegmentedControl";
import { CanvasReferenceSummary } from "@/components/world/CanvasReferenceSummary";
import { LinkSceneForm } from "@/components/world/LinkSceneForm";
import { ContextRail, ContextRailToggle, useContextRail } from "@/components/shell/ContextRail";
import { setUnsaved } from "@/components/shell/unsaved";
import { CloseIcon } from "@/components/shell/icons";
import type { Issue } from "@/domain/issues";
import { isLinkableReferenceType } from "@/domain/recordTypes";
import type { BoardCardView, BoardView } from "@/server/services/boardService";
import type { LoadedInspector } from "@/server/services/referenceInspectorService";
import { WORLD, WRITE } from "@/ui/labels";
import { readBoardFilter, readBoardView, writeBoardFilter, writeBoardView } from "@/world/boardViewState";
import { canvasReturnPath, withCanvasReturn } from "@/world/canvasReturn";
import {
  centerScroll,
  dragExceeded,
  gestureForBoardPointer,
  mergeBoardCards,
  rememberNoteDraft,
  shouldWriteMove,
  type BoardNoteDraft,
  type BoardSurfaceView,
  type BoardTool,
} from "@/world/boardInteraction";
import { MarkerScenes } from "../maps/MarkerScenes";
import { inspectReferenceAction } from "../inspectorActions";
import { AskAboutBoard } from "./AskAboutBoard";
import {
  addImageCardAction,
  addNoteCardAction,
  addRecordCardAction,
  deleteBoardAction,
  moveBoardCardAction,
  removeBoardCardAction,
  renameBoardAction,
  updateNoteCardAction,
} from "./actions";

export interface PlaceableRecord {
  id: string;
  title: string;
  typeLabel: string;
}

export interface PlaceableImage {
  id: string;
  recordId: string;
  recordTitle: string;
  name: string;
  altText: string;
}

export function BoardCanvas({
  projectId,
  board: initial,
  records,
  images,
  initialCardId = null,
}: {
  projectId: string;
  board: BoardView;
  records: PlaceableRecord[];
  images: PlaceableImage[];
  initialCardId?: string | null;
}) {
  const router = useRouter();
  const idPrefix = useId();
  const railId = `${idPrefix}-board-rail`;
  const titleId = `${railId}-title`;
  const rail = useContextRail();
  const [board, setBoard] = useState(initial);
  const [cards, setCards] = useState(initial.cards);
  const [selectedId, setSelectedId] = useState<string | null>(initialCardId);
  const [inspection, setInspection] = useState<LoadedInspector | null>(null);
  const didDeepLink = useRef(false);
  const railRef = useRef(rail);
  railRef.current = rail;
  const [issues, setIssues] = useState<Issue[]>([]);
  const [status, setStatus] = useState("");
  const [sceneRefresh, setSceneRefresh] = useState(0);
  const [missingSelection, setMissingSelection] = useState("");
  const [posX, setPosX] = useState("");
  const [posY, setPosY] = useState("");
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(initial.title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [noteEdit, setNoteEdit] = useState<{ title: string; body: string } | null>(null);
  const [tool, setTool] = useState<BoardTool>("select");
  const [view, setView] = useState<BoardSurfaceView>("canvas");
  const [layoutLocked, setLayoutLocked] = useState(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const noteTitleRef = useRef<HTMLInputElement>(null);
  const noteDraftsRef = useRef<Record<string, BoardNoteDraft>>({});
  const cardsRef = useRef(initial.cards);
  const toolRef = useRef(tool);
  const lockedRef = useRef(layoutLocked);
  toolRef.current = tool;
  lockedRef.current = layoutLocked;
  const dragRef = useRef<{
    cardId: string;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    x: number;
    y: number;
    exceeded: boolean;
    cancelled: boolean;
  } | null>(null);
  const panRef = useRef<{ startX: number; startY: number; left: number; top: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const [kindFilter, setKindFilter] = useState<"all" | "record" | "image" | "note">("all");

  useEffect(() => {
    setBoard(initial);
    setTitle(initial.title);
    setCards((prev) => {
      const next = mergeBoardCards(initial.cards, prev, noteDraftsRef.current);
      cardsRef.current = next;
      return next;
    });
  }, [initial]);

  useEffect(() => {
    setView(readBoardView(initial.id));
    setKindFilter(readBoardFilter(initial.id));
  }, [initial.id]);

  useEffect(() => {
    const key = `board-notes-${board.id}`;
    return () => setUnsaved(key, false);
  }, [board.id]);

  cardsRef.current = cards;
  const selected = cards.find((c) => c.id === selectedId) ?? null;

  const visibleCards = useMemo(() => {
    if (kindFilter === "all") return cards;
    return cards.filter((c) => c.kind === kindFilter);
  }, [cards, kindFilter]);
  const visibleIds = useMemo(() => new Set(visibleCards.map((c) => c.id)), [visibleCards]);

  const inspectRecordId = selected && selected.kind !== "note" ? selected.recordId : null;

  useEffect(() => {
    if (!initialCardId) {
      setMissingSelection("");
      return;
    }
    if (!initial.cards.some((card) => card.id === initialCardId)) {
      setMissingSelection(WORLD.cardMissing);
      return;
    }
    setMissingSelection("");
    if (!didDeepLink.current) {
      didDeepLink.current = true;
      setSelectedId(initialCardId);
      if (!railRef.current.visible) railRef.current.toggle();
    }
  }, [initialCardId, initial.cards]);

  useEffect(() => {
    if (!selected) return;
    setPosX(String(Math.round(selected.x)));
    setPosY(String(Math.round(selected.y)));
  }, [selected?.id, selected?.x, selected?.y]);

  const selectedNoteId = selected?.kind === "note" ? selected.id : null;

  useEffect(() => {
    const current = selectedNoteId ? cardsRef.current.find((card) => card.id === selectedNoteId) : null;
    if (current?.kind === "note") {
      const draft = noteDraftsRef.current[current.id];
      setNoteEdit(draft ?? { title: current.noteTitle, body: current.noteBody });
      setInspection(null);
      return;
    }
    setNoteEdit(null);
    if (!inspectRecordId) {
      setInspection(null);
      return;
    }
    let cancelled = false;
    setInspection(null);
    void inspectReferenceAction(projectId, inspectRecordId).then((result) => {
      if (!cancelled) setInspection(result);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, inspectRecordId, selectedNoteId]);

  const selectCard = useCallback(
    (card: BoardCardView) => {
      setSelectedId(card.id);
      if (!rail.visible) rail.toggle();
    },
    [rail],
  );

  const fitRect = useCallback((targets: BoardCardView[]) => {
    const el = surfaceRef.current;
    if (!el) return;
    const next = centerScroll(el, targets);
    if (!next) return;
    el.scrollTo({ left: next.left, top: next.top, behavior: "smooth" });
  }, []);

  const restoreDrag = useCallback((drag: NonNullable<typeof dragRef.current>) => {
    setCards((list) =>
      list.map((card) => (card.id === drag.cardId ? { ...card, x: drag.originX, y: drag.originY } : card)),
    );
  }, []);

  const cancelActiveMove = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return false;
    drag.cancelled = true;
    dragRef.current = null;
    restoreDrag(drag);
    return true;
  }, [restoreDrag]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable='true']")) return;
      if (!cancelActiveMove()) return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancelActiveMove]);

  const onHandlePointerDown = (event: ReactPointerEvent, card: BoardCardView) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    selectCard(card);
    const editingText = event.target instanceof Element && Boolean(event.target.closest("input, textarea, select, [contenteditable='true']"));
    const gesture = gestureForBoardPointer({
      tool: toolRef.current,
      locked: lockedRef.current,
      onHandle: true,
      onCard: true,
      editingText,
      exceeded: false,
    });
    if (editingText || lockedRef.current || toolRef.current !== "select" || gesture === "pan") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      cardId: card.id,
      startX: event.clientX,
      startY: event.clientY,
      originX: card.x,
      originY: card.y,
      x: card.x,
      y: card.y,
      exceeded: false,
      cancelled: false,
    };
  };

  const onHandlePointerMove = (event: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.cancelled || drag.cardId !== event.currentTarget.getAttribute("data-card-id")) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.exceeded) {
      if (!dragExceeded(dx, dy)) return;
      drag.exceeded = true;
    }
    const gesture = gestureForBoardPointer({
      tool: toolRef.current,
      locked: lockedRef.current,
      onHandle: true,
      onCard: true,
      editingText: false,
      exceeded: true,
    });
    if (gesture !== "move") return;
    drag.x = Math.max(0, Math.round(drag.originX + dx));
    drag.y = Math.max(0, Math.round(drag.originY + dy));
    setCards((list) => list.map((card) => (card.id === drag.cardId ? { ...card, x: drag.x, y: drag.y } : card)));
  };

  const onHandlePointerUp = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (!shouldWriteMove({ exceeded: drag.exceeded, cancelled: drag.cancelled, locked: lockedRef.current })) {
      if (drag.exceeded) restoreDrag(drag);
      return;
    }
    startTransition(async () => {
      const result = await moveBoardCardAction(projectId, board.id, drag.cardId, { x: drag.x, y: drag.y });
      if (!result.ok) {
        setIssues(result.issues);
        restoreDrag(drag);
        return;
      }
      setIssues([]);
      setCards((list) =>
        list.map((card) =>
          card.id === result.card.id
            ? {
                ...result.card,
                noteTitle: noteDraftsRef.current[card.id]?.title ?? result.card.noteTitle,
                noteBody: noteDraftsRef.current[card.id]?.body ?? result.card.noteBody,
                label: noteDraftsRef.current[card.id]
                  ? noteDraftsRef.current[card.id].title.trim() || "Note"
                  : result.card.label,
              }
            : card,
        ),
      );
      router.refresh();
    });
  };

  const onSurfacePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (view !== "canvas" || tool !== "pan" || event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("button, a, input, textarea, select, [data-drag-handle]")) return;
    const el = surfaceRef.current;
    if (!el) return;
    panRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      left: el.scrollLeft,
      top: el.scrollTop,
      moved: false,
    };
    el.setPointerCapture(event.pointerId);
  };

  const onSurfacePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    const el = surfaceRef.current;
    if (!pan || !el) return;
    const dx = event.clientX - pan.startX;
    const dy = event.clientY - pan.startY;
    if (!pan.moved && !dragExceeded(dx, dy)) return;
    pan.moved = true;
    suppressClick.current = true;
    el.scrollLeft = pan.left - dx;
    el.scrollTop = pan.top - dy;
  };

  const onSurfacePointerUp = () => {
    panRef.current = null;
  };

  const rememberNote = (cardId: string, draft: BoardNoteDraft) => {
    const saved = initial.cards.find((card) => card.id === cardId && card.kind === "note");
    noteDraftsRef.current = rememberNoteDraft(
      noteDraftsRef.current,
      cardId,
      draft,
      saved ? { title: saved.noteTitle, body: saved.noteBody } : draft,
    );
    setUnsaved(`board-notes-${board.id}`, Object.keys(noteDraftsRef.current).length > 0);
  };

  const beginNoteEdit = (card: BoardCardView) => {
    selectCard(card);
    requestAnimationFrame(() => noteTitleRef.current?.focus());
  };

  const hiddenByFilter = Math.max(0, cards.length - visibleCards.length);

  const dropPoint = () => {
    const el = surfaceRef.current;
    if (!el) return { x: 40, y: 40 };
    return { x: Math.round(el.scrollLeft + 48), y: Math.round(el.scrollTop + 48) };
  };

  const placeRecord = (recordId: string) => {
    if (!recordId) return;
    const { x, y } = dropPoint();
    startTransition(async () => {
      const result = await addRecordCardAction(projectId, board.id, { recordId, x, y });
      if (!result.ok) {
        setIssues(result.issues);
        return;
      }
      setIssues([]);
      setCards((list) => [...list, result.card]);
      selectCard(result.card);
      router.refresh();
    });
  };

  const placeImage = (imageId: string) => {
    if (!imageId) return;
    const { x, y } = dropPoint();
    startTransition(async () => {
      const result = await addImageCardAction(projectId, board.id, { imageId, x: x + 40, y: y + 40 });
      if (!result.ok) {
        setIssues(result.issues);
        return;
      }
      setIssues([]);
      setCards((list) => [...list, result.card]);
      selectCard(result.card);
      router.refresh();
    });
  };

  const placeNote = () => {
    const { x, y } = dropPoint();
    startTransition(async () => {
      const result = await addNoteCardAction(projectId, board.id, {
        noteTitle: WORLD.noteCard,
        noteBody: "",
        x: x + 80,
        y: y + 80,
      });
      if (!result.ok) {
        setIssues(result.issues);
        return;
      }
      setIssues([]);
      setCards((list) => [...list, result.card]);
      selectCard(result.card);
      router.refresh();
    });
  };

  const positionForm = selected ? (
    <form
      className="row"
      aria-label={WORLD.boardPosition}
      style={{ gap: "0.35rem", flexWrap: "wrap" }}
      onSubmit={(event) => {
        event.preventDefault();
        if (layoutLocked) return;
        const x = Number(posX);
        const y = Number(posY);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const cardId = selected.id;
        startTransition(async () => {
          const result = await moveBoardCardAction(projectId, board.id, cardId, { x, y });
          if (!result.ok) {
            setIssues(result.issues);
            return;
          }
          setIssues([]);
          setCards((list) => list.map((card) => (card.id === result.card.id ? result.card : card)));
          setStatus(WORLD.boardPositionSaved);
          router.refresh();
        });
      }}
    >
      <label>
        {WORLD.boardPositionX}
        <input
          type="number"
          step={1}
          value={posX}
          disabled={layoutLocked || pending}
          onChange={(event) => setPosX(event.target.value)}
        />
      </label>
      <label>
        {WORLD.boardPositionY}
        <input
          type="number"
          step={1}
          value={posY}
          disabled={layoutLocked || pending}
          onChange={(event) => setPosY(event.target.value)}
        />
      </label>
      <Button type="submit" size="sm" variant="secondary" disabled={layoutLocked || pending}>
        {WORLD.savePosition}
      </Button>
    </form>
  ) : null;

  return (
    <div className="write-layout reference-write-layout board-layout visual-canvas">
      <div className="write-main board-main">
        <IssueList issues={issues} />
        {status ? <p className="small" role="status">{status}</p> : null}
        {missingSelection ? <p className="small" role="status">{missingSelection}</p> : null}

        <CanvasToolbar label={WORLD.boardCanvas}>
          <SegmentedControl size="sm" label={WORLD.boardViews}>
            <SegmentedOption selected={view === "canvas"} onClick={() => { setView("canvas"); writeBoardView(board.id, "canvas"); }}>
              {WORLD.boardViewCanvas}
            </SegmentedOption>
            <SegmentedOption selected={view === "list"} onClick={() => { setView("list"); writeBoardView(board.id, "list"); }}>
              {WORLD.boardViewList}
            </SegmentedOption>
          </SegmentedControl>
          <SegmentedControl size="sm" label={WORLD.boardTools}>
            <SegmentedOption selected={tool === "select"} disabled={view !== "canvas"} onClick={() => setTool("select")}>
              {WORLD.boardToolSelect}
            </SegmentedOption>
            <SegmentedOption selected={tool === "pan"} disabled={view !== "canvas"} onClick={() => setTool("pan")}>
              {WORLD.boardToolPan}
            </SegmentedOption>
          </SegmentedControl>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="board-lock"
            aria-pressed={layoutLocked}
            onClick={() => {
              if (!layoutLocked) cancelActiveMove();
              setLayoutLocked((current) => !current);
            }}
          >
            {WORLD.boardLockLayout}
          </Button>
          <BoardOverflowMenu summary={WORLD.addCardMenu}>
            <label>
              <span className="sr-only">{WORLD.addRecordCard}</span>
              <select
                defaultValue=""
                disabled={pending || records.length === 0}
                onChange={(e) => {
                  const recordId = e.target.value;
                  e.target.value = "";
                  placeRecord(recordId);
                }}
              >
                <option value="">{WORLD.chooseRecord}</option>
                {records.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title} ({r.typeLabel})
                  </option>
                ))}
              </select>
            </label>
            <Button type="button" disabled={pending} onClick={placeNote} size="sm">
              {WORLD.writeNote}
            </Button>
          </BoardOverflowMenu>

          <CanvasToolbarGroup>
            <label className="small">
              <span className="sr-only">{WORLD.filterCardKind}</span>
              <select
                value={kindFilter}
                aria-label={WORLD.filterCardKind}
                onChange={(e) => {
                  const next = e.target.value as typeof kindFilter;
                  setKindFilter(next);
                  writeBoardFilter(board.id, next);
                }}
              >
                <option value="all">{WORLD.filterAllKinds}</option>
                <option value="record">{WORLD.filterRecords}</option>
                <option value="image">{WORLD.filterImages}</option>
                <option value="note">{WORLD.filterNotes}</option>
              </select>
            </label>
            <Button
              type="button"
              disabled={view !== "canvas" || !selected}
              onClick={() => selected && fitRect([selected])}
              variant="secondary"
              size="sm"
            >
              {WORLD.boardCenterSelection}
            </Button>
            <Button
              type="button"
              disabled={view !== "canvas" || !visibleCards.length}
              onClick={() => fitRect(visibleCards)}
              variant="secondary"
              size="sm"
            >
              {WORLD.boardCenterAll}
            </Button>
          </CanvasToolbarGroup>

          <BoardOverflowMenu>
              <form
                className="row"
                style={{ gap: "0.35rem", flexWrap: "wrap" }}
                onSubmit={(e) => {
                  e.preventDefault();
                  startTransition(async () => {
                    const result = await renameBoardAction(projectId, board.id, title);
                    if (!result.ok) setIssues(result.issues);
                    else {
                      setIssues([]);
                      router.refresh();
                    }
                  });
                }}
              >
                <label className="board-title-field">
                  <span className="sr-only">{WORLD.renameBoard}</span>
                  <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required />
                </label>
                <Button type="submit" disabled={pending} variant="secondary" size="sm">
                  {WORLD.renameBoard}
                </Button>
              </form>
              <label>
                <span className="sr-only">{WORLD.addImageCard}</span>
                <select
                  defaultValue=""
                  disabled={pending || images.length === 0}
                  onChange={(e) => {
                    const imageId = e.target.value;
                    e.target.value = "";
                    placeImage(imageId);
                  }}
                >
                  <option value="">{WORLD.chooseImage}</option>
                  {images.map((img) => (
                    <option key={img.id} value={img.id}>
                      {img.recordTitle}: {img.name}
                    </option>
                  ))}
                </select>
              </label>
              <AskAboutBoard projectId={projectId} boardId={board.id} />
              {!confirmDelete ? (
                <Button type="button" onClick={() => setConfirmDelete(true)} variant="secondary" size="sm">
                  {WORLD.deleteBoard}
                </Button>
              ) : (
                <Button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await deleteBoardAction(projectId, board.id);
                      if (!result.ok) {
                        setIssues(result.issues);
                        return;
                      }
                      router.push(`/projects/${encodeURIComponent(projectId)}/world/boards`);
                      router.refresh();
                    })
                  }
                  size="sm"
                >
                  {WORLD.confirmDeleteBoard(board.title)}
                </Button>
              )}
          </BoardOverflowMenu>
          <ContextRailToggle rail={rail} controls={railId} />
        </CanvasToolbar>
        <p className="board-status small muted" aria-live="polite">
          {layoutLocked
            ? WORLD.boardLayoutLocked
            : view === "list"
              ? null
              : tool === "pan"
                ? WORLD.boardPanHint
                : WORLD.boardSelectHint}{" "}
          {WORLD.boardCardCount(visibleCards.length, cards.length)}
          {hiddenByFilter > 0 ? ` ${WORLD.boardFilterHides(hiddenByFilter)}` : ""}
        </p>

        <div
          ref={surfaceRef}
          className={`board-surface board-surface-max${layoutLocked ? " board-layout-locked" : ""}${tool === "pan" ? " board-tool-pan" : ""}`}
          role="listbox"
          aria-label={WORLD.boardCanvas}
          aria-description={WORLD.keyboardBoardHint}
          aria-activedescendant={selectedId ? `${idPrefix}-card-${selectedId}` : undefined}
          tabIndex={0}
          hidden={view !== "canvas"}
          onPointerDown={onSurfacePointerDown}
          onPointerMove={onSurfacePointerMove}
          onPointerUp={onSurfacePointerUp}
          onPointerCancel={onSurfacePointerUp}
          onClick={() => {
            if (suppressClick.current) {
              suppressClick.current = false;
              return;
            }
            setSelectedId(null);
          }}
          onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => {
            if (e.key === "Escape") {
              if (cancelActiveMove()) return;
              setSelectedId(null);
              return;
            }
            if (e.key === "Home") {
              e.preventDefault();
              fitRect(visibleCards);
              return;
            }
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
            if (!visibleCards.length) return;
            e.preventDefault();
            const ordered = [...visibleCards].sort((a, b) => a.y - b.y || a.x - b.x);
            const idx = selectedId ? ordered.findIndex((c) => c.id === selectedId) : -1;
            const nextIdx =
              e.key === "ArrowRight" || e.key === "ArrowDown"
                ? idx < 0
                  ? 0
                  : Math.min(ordered.length - 1, idx + 1)
                : idx <= 0
                  ? ordered.length - 1
                  : idx - 1;
            const next = ordered[nextIdx];
            if (next) {
              selectCard(next);
              fitRect([next]);
            }
          }}
        >
          {!cards.length ? (
            <div className="board-first-actions">
              <div className="board-first-actions-card" onClick={(event) => event.stopPropagation()}>
                <strong>{WORLD.emptyBoard}</strong>
                <p className="small muted">{WORLD.emptyBoardHint}</p>
                <label>
                  {WORLD.addRecordCard}
                  <select
                    defaultValue=""
                    disabled={pending || records.length === 0}
                    aria-describedby={records.length === 0 ? `${idPrefix}-no-references` : undefined}
                    onChange={(event) => {
                      const recordId = event.target.value;
                      event.target.value = "";
                      placeRecord(recordId);
                    }}
                  >
                    <option value="">{WORLD.chooseRecord}</option>
                    {records.map((record) => (
                      <option key={record.id} value={record.id}>
                        {record.title} ({record.typeLabel})
                      </option>
                    ))}
                  </select>
                </label>
                {records.length === 0 ? (
                  <p id={`${idPrefix}-no-references`} className="small muted">
                    {WORLD.boardNoReferences}
                  </p>
                ) : null}
                <label>
                  {WORLD.addImageCard}
                  <select
                    defaultValue=""
                    disabled={pending || images.length === 0}
                    aria-describedby={images.length === 0 ? `${idPrefix}-no-images` : undefined}
                    onChange={(event) => {
                      const imageId = event.target.value;
                      event.target.value = "";
                      placeImage(imageId);
                    }}
                  >
                    <option value="">{WORLD.chooseImage}</option>
                    {images.map((image) => (
                      <option key={image.id} value={image.id}>
                        {image.recordTitle}: {image.name}
                      </option>
                    ))}
                  </select>
                </label>
                {images.length === 0 ? (
                  <p id={`${idPrefix}-no-images`} className="small muted">
                    {WORLD.boardNoImages}
                  </p>
                ) : null}
                <Button type="button" disabled={pending} aria-busy={pending} onClick={placeNote}>
                  {WORLD.writeNote}
                </Button>
              </div>
            </div>
          ) : null}
          {cards.length > 0 && visibleCards.length === 0 ? (
            <div className="board-surface-empty">
              <strong>{WORLD.filterEmptyBoard}</strong>
            </div>
          ) : null}
          {cards.map((card) => {
            const hidden = !visibleIds.has(card.id);
            return (
              <div
                key={card.id}
                id={`${idPrefix}-card-${card.id}`}
                data-card-id={card.id}
                role="option"
                aria-selected={selectedId === card.id}
                tabIndex={-1}
                className={`board-card board-card-${card.kind}${selectedId === card.id ? " selected" : ""}${hidden ? " dimmed" : ""}`}
                style={{
                  left: card.x,
                  top: card.y,
                  width: card.width,
                  minHeight: card.height,
                  zIndex: card.zIndex + (selectedId === card.id ? 1000 : 0),
                  visibility: hidden ? "hidden" : undefined,
                  pointerEvents: hidden ? "none" : undefined,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  selectCard(card);
                }}
              >
                <div className="board-card-top">
                  <button
                    type="button"
                    className="board-drag-handle"
                    data-drag-handle=""
                    data-card-id={card.id}
                    aria-label={WORLD.boardDragHandle}
                    aria-disabled={layoutLocked || tool !== "select"}
                    onClick={(event) => event.stopPropagation()}
                    onPointerDown={(event) => onHandlePointerDown(event, card)}
                    onPointerMove={onHandlePointerMove}
                    onPointerUp={onHandlePointerUp}
                    onPointerCancel={cancelActiveMove}
                  >
                    <span className="board-drag-grip" aria-hidden="true" />
                  </button>
                  <span className="board-card-kind">
                    {card.kind === "note" ? WORLD.noteCard : card.kind === "image" ? WORLD.imageCard : WORLD.recordCard}
                  </span>
                </div>
                <strong className="board-card-title">{card.label}</strong>
                {card.kind === "record" && card.recordTypeLabel ? (
                  <span className="board-card-meta">{card.recordTypeLabel}</span>
                ) : null}
                {card.kind === "note" && card.noteBody ? <p className="board-card-body">{card.noteBody}</p> : null}
                {card.kind === "image" && card.imageId ? (
                  // eslint-disable-next-line @next/next/no-img-element -- board thumbnail from project image route
                  <img
                    src={`/projects/${encodeURIComponent(projectId)}/images/${encodeURIComponent(card.imageId)}`}
                    alt={card.imageAlt || card.imageName || ""}
                    className="board-card-thumb"
                    draggable={false}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
        <div
          className="board-list"
          role="list"
          aria-label={WORLD.boardList}
          hidden={view !== "list"}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setSelectedId(null);
              return;
            }
            if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
            if (!visibleCards.length) return;
            event.preventDefault();
            const ordered = [...visibleCards].sort((a, b) => a.y - b.y || a.x - b.x);
            const idx = selectedId ? ordered.findIndex((card) => card.id === selectedId) : -1;
            const nextIdx =
              event.key === "ArrowRight" || event.key === "ArrowDown"
                ? idx < 0
                  ? 0
                  : Math.min(ordered.length - 1, idx + 1)
                : idx <= 0
                  ? ordered.length - 1
                  : idx - 1;
            const next = ordered[nextIdx];
            if (next) selectCard(next);
          }}
        >
          {!cards.length ? (
            <p className="board-status small muted">{WORLD.emptyBoard}</p>
          ) : visibleCards.length === 0 ? (
            <p className="board-status small muted">{WORLD.filterEmptyBoard}</p>
          ) : (
            visibleCards.map((card) => (
              <div
                key={card.id}
                role="listitem"
                className={`board-list-row board-card-${card.kind}${selectedId === card.id ? " selected" : ""}`}
                aria-current={selectedId === card.id ? "true" : undefined}
              >
                <span className="board-card-kind">
                  {card.kind === "note" ? WORLD.noteCard : card.kind === "image" ? WORLD.imageCard : WORLD.recordCard}
                </span>
                <span className="board-list-title">{card.label}</span>
                <div className="board-list-actions">
                  <Button type="button" size="sm" variant="secondary" onClick={() => selectCard(card)}>
                    {WORLD.boardInspect}
                  </Button>
                  {card.recordId ? (
                    <ButtonLink
                      href={withCanvasReturn(
                        `/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(card.recordId)}`,
                        canvasReturnPath(projectId, "boards", board.id, card.id),
                      )}
                      size="sm"
                      variant="secondary"
                    >
                      {WORLD.inspectorOpenRecord}
                    </ButtonLink>
                  ) : null}
                  {card.kind === "note" ? (
                    <Button type="button" size="sm" variant="secondary" onClick={() => beginNoteEdit(card)}>
                      {WORLD.editNote}
                    </Button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <ContextRail id={railId} labelledBy={titleId} rail={rail} className="reference-context visual-inspector">
        <div
          className="context-inner"
          onKeyDown={(e) => {
            if (!rail.wide && e.key === "Escape" && !e.defaultPrevented) {
              e.preventDefault();
              rail.close();
            }
          }}
        >
          <div className="context-head">
            <h2 className="context-title" id={titleId}>
              {WORLD.boardRail}
            </h2>
            {!rail.wide ? (
              <IconButton tip="end" aria-label={WRITE.closeContext} onClick={rail.close}>
                <CloseIcon />
              </IconButton>
            ) : null}
          </div>
          <div className="context-body world-context-body">
            {!selected ? (
              <p className="visual-inspector-empty">{WORLD.noCardSelected}</p>
            ) : selected.kind === "note" ? (
              <div className="stack">
                {positionForm}
                <section className="rail-section">
                  <h3>{WORLD.noteCard}</h3>
                  <label onPointerDown={(event) => event.stopPropagation()}>
                    {WRITE.noteTitle}
                    <input
                      ref={noteTitleRef}
                      type="text"
                      value={noteEdit?.title ?? selected.noteTitle}
                      onChange={(e) => {
                        const draft = { title: e.target.value, body: noteEdit?.body ?? selected.noteBody };
                        rememberNote(selected.id, draft);
                        setNoteEdit(draft);
                        setCards((list) =>
                          list.map((c) =>
                            c.id === selected.id && c.kind === "note"
                              ? { ...c, noteTitle: draft.title, label: draft.title.trim() || "Note" }
                              : c,
                          ),
                        );
                      }}
                    />
                  </label>
                  <label onPointerDown={(event) => event.stopPropagation()}>
                    {WRITE.noteText}
                    <textarea
                      rows={6}
                      value={noteEdit?.body ?? selected.noteBody}
                      onChange={(e) => {
                        const draft = { title: noteEdit?.title ?? selected.noteTitle, body: e.target.value };
                        rememberNote(selected.id, draft);
                        setNoteEdit(draft);
                        setCards((list) =>
                          list.map((c) =>
                            c.id === selected.id && c.kind === "note" ? { ...c, noteBody: draft.body } : c,
                          ),
                        );
                      }}
                    />
                  </label>
                  <Button
                    type="button"
                   
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await updateNoteCardAction(projectId, board.id, selected.id, {
                          noteTitle: noteEdit?.title ?? selected.noteTitle,
                          noteBody: noteEdit?.body ?? selected.noteBody,
                        });
                        if (!result.ok) {
                          setIssues(result.issues);
                          return;
                        }
                        delete noteDraftsRef.current[selected.id];
                        setUnsaved(`board-notes-${board.id}`, Object.keys(noteDraftsRef.current).length > 0);
                        setCards((list) => list.map((c) => (c.id === result.card.id ? result.card : c)));
                        setStatus(WORLD.noteSaved);
                        router.refresh();
                      })
                    }
                   size="sm">
                    {WORLD.saveNote}
                  </Button>
                </section>
                <section className="rail-section">
                  <p className="small muted" style={{ margin: 0 }}>
                    {WORLD.removeCardNote}
                  </p>
                  <Button
                    type="button"
                   
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await removeBoardCardAction(projectId, board.id, selected.id);
                        if (!result.ok) {
                          setIssues(result.issues);
                          return;
                        }
                        delete noteDraftsRef.current[selected.id];
                        setUnsaved(`board-notes-${board.id}`, Object.keys(noteDraftsRef.current).length > 0);
                        setCards((list) => list.filter((c) => c.id !== selected.id));
                        setSelectedId(null);
                        router.refresh();
                      })
                    }
                   variant="secondary" size="sm">
                    {WORLD.removeCard}
                  </Button>
                </section>
              </div>
            ) : (
              <div className="stack">
                {positionForm}
                <section className="rail-section">
                  {inspection?.ok ? (
                    <CanvasReferenceSummary
                      projectId={projectId}
                      model={inspection.model}
                      returnPath={canvasReturnPath(projectId, "boards", board.id, selected.id)}
                      sourceNote={selected.kind === "image" ? WORLD.openedFromImage : null}
                    />
                  ) : inspection && !inspection.ok ? (
                    <p className="error-text">{inspection.message}</p>
                  ) : (
                    <p className="small muted">{WORLD.inspectorLoading}</p>
                  )}
                </section>
                {selected.recordId ? (
                  <MarkerScenes
                    projectId={projectId}
                    locationRecordId={selected.recordId}
                    returnPath={canvasReturnPath(projectId, "boards", board.id, selected.id)}
                    refreshKey={sceneRefresh}
                  />
                ) : null}
                {inspection?.ok && isLinkableReferenceType(inspection.model.recordType) ? (
                  <LinkSceneForm
                    projectId={projectId}
                    locationRecordId={inspection.model.id}
                    protectedReference={inspection.model.protected}
                    onLinked={(message) => {
                      setStatus(message);
                      setSceneRefresh((value) => value + 1);
                    }}
                  />
                ) : null}
                <section className="rail-section">
                  <p className="small muted" style={{ margin: 0 }}>
                    {WORLD.removeCardNote}
                  </p>
                  <Button
                    type="button"
                   
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await removeBoardCardAction(projectId, board.id, selected.id);
                        if (!result.ok) {
                          setIssues(result.issues);
                          return;
                        }
                        delete noteDraftsRef.current[selected.id];
                        setUnsaved(`board-notes-${board.id}`, Object.keys(noteDraftsRef.current).length > 0);
                        setCards((list) => list.filter((c) => c.id !== selected.id));
                        setSelectedId(null);
                        router.refresh();
                      })
                    }
                   variant="secondary" size="sm">
                    {WORLD.removeCard}
                  </Button>
                </section>
              </div>
            )}
          </div>
        </div>
      </ContextRail>
    </div>
  );
}
