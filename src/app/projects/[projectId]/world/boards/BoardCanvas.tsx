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
import { StatusBadge } from "@/components/Badges";
import { IssueList } from "@/components/IssueList";
import { ContextRail, ContextRailToggle, useContextRail } from "@/components/shell/ContextRail";
import { CloseIcon } from "@/components/shell/icons";
import type { Issue } from "@/domain/issues";
import type { BoardCardView, BoardView } from "@/server/services/boardService";
import { WORLD, WRITE } from "@/ui/labels";
import { previewReferenceAction, type ReferencePreview } from "../../write/actions";
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
}: {
  projectId: string;
  board: BoardView;
  records: PlaceableRecord[];
  images: PlaceableImage[];
}) {
  const router = useRouter();
  const idPrefix = useId();
  const railId = `${idPrefix}-board-rail`;
  const titleId = `${railId}-title`;
  const rail = useContextRail();
  const [board, setBoard] = useState(initial);
  const [cards, setCards] = useState(initial.cards);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ReferencePreview | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(initial.title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [noteEdit, setNoteEdit] = useState<{ title: string; body: string } | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    cardId: string;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const [kindFilter, setKindFilter] = useState<"all" | "record" | "image" | "note">("all");
  const dirtyNoteIdRef = useRef<string | null>(null);

  useEffect(() => {
    setBoard(initial);
    setTitle(initial.title);
    setCards((prev) => {
      const dirtyId = dirtyNoteIdRef.current;
      if (!dirtyId) return initial.cards;
      const local = prev.find((c) => c.id === dirtyId);
      if (!local || local.kind !== "note") return initial.cards;
      return initial.cards.map((c) =>
        c.id === dirtyId && c.kind === "note"
          ? { ...c, noteTitle: local.noteTitle, noteBody: local.noteBody, x: local.x, y: local.y }
          : c,
      );
    });
  }, [initial]);

  const selected = cards.find((c) => c.id === selectedId) ?? null;

  const visibleCards = useMemo(() => {
    if (kindFilter === "all") return cards;
    return cards.filter((c) => c.kind === kindFilter);
  }, [cards, kindFilter]);
  const visibleIds = useMemo(() => new Set(visibleCards.map((c) => c.id)), [visibleCards]);

  useEffect(() => {
    if (!selected || selected.kind === "note" || !selected.recordId) {
      setPreview(null);
      setNoteEdit(selected?.kind === "note" ? { title: selected.noteTitle, body: selected.noteBody } : null);
      return;
    }
    setNoteEdit(null);
    let cancelled = false;
    void previewReferenceAction(projectId, selected.recordId).then((result) => {
      if (!cancelled) setPreview(result);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, selected]);

  const selectCard = useCallback(
    (card: BoardCardView) => {
      setSelectedId(card.id);
      if (!rail.visible) rail.toggle();
    },
    [rail],
  );

  const fitRect = useCallback((targets: BoardCardView[]) => {
    const el = surfaceRef.current;
    if (!el || !targets.length) return;
    const minX = Math.min(...targets.map((c) => c.x));
    const minY = Math.min(...targets.map((c) => c.y));
    const maxX = Math.max(...targets.map((c) => c.x + c.width));
    const maxY = Math.max(...targets.map((c) => c.y + c.height));
    el.scrollTo({
      left: Math.max(0, (minX + maxX) / 2 - el.clientWidth / 2),
      top: Math.max(0, (minY + maxY) / 2 - el.clientHeight / 2),
      behavior: "smooth",
    });
  }, []);

  const onPointerDown = (e: ReactPointerEvent, card: BoardCardView) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      cardId: card.id,
      startX: e.clientX,
      startY: e.clientY,
      originX: card.x,
      originY: card.y,
    };
    selectCard(card);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.cardId !== e.currentTarget.getAttribute("data-card-id")) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const x = Math.max(0, Math.round(drag.originX + dx));
    const y = Math.max(0, Math.round(drag.originY + dy));
    setCards((list) => list.map((c) => (c.id === drag.cardId ? { ...c, x, y } : c)));
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    const card = cards.find((c) => c.id === drag.cardId);
    if (!card) return;
    const moved = card.x !== drag.originX || card.y !== drag.originY;
    if (!moved) return;
    startTransition(async () => {
      const result = await moveBoardCardAction(projectId, board.id, card.id, { x: card.x, y: card.y });
      if (!result.ok) {
        setIssues(result.issues);
        setCards(initial.cards);
        return;
      }
      setCards((list) => list.map((c) => (c.id === result.card.id ? result.card : c)));
      router.refresh();
    });
  };

  const dropPoint = () => {
    const el = surfaceRef.current;
    if (!el) return { x: 40, y: 40 };
    return { x: Math.round(el.scrollLeft + 48), y: Math.round(el.scrollTop + 48) };
  };

  return (
    <div className="write-layout reference-write-layout board-layout">
      <div className="write-main board-main">
        <div className="doc-toolbar">
          <form
            className="row"
            style={{ flex: 1, gap: "0.5rem", flexWrap: "wrap" }}
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
            <button type="submit" className="secondary small-button" disabled={pending}>
              {WORLD.renameBoard}
            </button>
          </form>
          <div className="doc-toolbar-end">
            <ContextRailToggle rail={rail} controls={railId} />
          </div>
        </div>

        <p className="board-meta small muted">
          <span>{WORLD.dragHint}</span>
        </p>
        <IssueList issues={issues} />
        <AskAboutBoard projectId={projectId} boardId={board.id} />

        <div className="board-toolbar" role="toolbar" aria-label={WORLD.boardCanvas}>
          <div className="board-toolbar-group">
            <span className="board-toolbar-label">{WORLD.toolbarPlace}</span>
            <label>
              <span className="sr-only">{WORLD.addRecordCard}</span>
              <select
                defaultValue=""
                disabled={pending}
                onChange={(e) => {
                  const recordId = e.target.value;
                  e.target.value = "";
                  if (!recordId) return;
                  const { x, y } = dropPoint();
                  startTransition(async () => {
                    const result = await addRecordCardAction(projectId, board.id, { recordId, x, y });
                    if (!result.ok) {
                      setIssues(result.issues);
                      return;
                    }
                    setCards((list) => [...list, result.card]);
                    selectCard(result.card);
                    router.refresh();
                  });
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
            <label>
              <span className="sr-only">{WORLD.addImageCard}</span>
              <select
                defaultValue=""
                disabled={pending || images.length === 0}
                onChange={(e) => {
                  const imageId = e.target.value;
                  e.target.value = "";
                  if (!imageId) return;
                  const { x, y } = dropPoint();
                  startTransition(async () => {
                    const result = await addImageCardAction(projectId, board.id, { imageId, x: x + 40, y: y + 40 });
                    if (!result.ok) {
                      setIssues(result.issues);
                      return;
                    }
                    setCards((list) => [...list, result.card]);
                    selectCard(result.card);
                    router.refresh();
                  });
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
            <button
              type="button"
              className="secondary small-button"
              disabled={pending}
              onClick={() => {
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
                  setCards((list) => [...list, result.card]);
                  selectCard(result.card);
                  router.refresh();
                });
              }}
            >
              {WORLD.addNoteCard}
            </button>
          </div>

          <div className="board-toolbar-group">
            <span className="board-toolbar-label">{WORLD.toolbarView}</span>
            <label className="small">
              <span className="sr-only">{WORLD.filterCardKind}</span>
              <select
                value={kindFilter}
                aria-label={WORLD.filterCardKind}
                onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)}
              >
                <option value="all">{WORLD.filterAllKinds}</option>
                <option value="record">{WORLD.filterRecords}</option>
                <option value="image">{WORLD.filterImages}</option>
                <option value="note">{WORLD.filterNotes}</option>
              </select>
            </label>
            <button
              type="button"
              className="secondary small-button"
              disabled={!selected}
              onClick={() => selected && fitRect([selected])}
            >
              {WORLD.fitSelection}
            </button>
            <button
              type="button"
              className="secondary small-button"
              disabled={!visibleCards.length}
              onClick={() => fitRect(visibleCards)}
            >
              {WORLD.fitAll}
            </button>
          </div>

          <div className="board-toolbar-group">
            <span className="board-toolbar-label">{WORLD.toolbarMaintain}</span>
            {!confirmDelete ? (
              <button type="button" className="secondary small-button" onClick={() => setConfirmDelete(true)}>
                {WORLD.deleteBoard}
              </button>
            ) : (
              <button
                type="button"
                className="small-button"
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
              >
                {WORLD.confirmDeleteBoard(board.title)}
              </button>
            )}
          </div>
        </div>

        <p className="small muted" style={{ margin: 0 }}>
          {WORLD.keyboardBoardHint}
        </p>

        <div
          ref={surfaceRef}
          className="board-surface"
          role="listbox"
          aria-label={WORLD.boardCanvas}
          aria-activedescendant={selectedId ? `${idPrefix}-card-${selectedId}` : undefined}
          tabIndex={0}
          onClick={() => setSelectedId(null)}
          onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => {
            if (e.key === "Escape") {
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
            <div className="board-surface-empty">
              <strong>{WORLD.emptyBoard}</strong>
              <p className="small muted" style={{ margin: 0 }}>
                {WORLD.emptyBoardHint}
              </p>
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
                onPointerDown={(e) => onPointerDown(e, card)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              >
                <span className="board-card-kind">
                  {card.kind === "note" ? WORLD.noteCard : card.kind === "image" ? WORLD.imageCard : WORLD.recordCard}
                </span>
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
      </div>

      <ContextRail id={railId} labelledBy={titleId} rail={rail} className="reference-context">
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
              <button
                type="button"
                className="icon-button tip tip-end"
                aria-label={WRITE.closeContext}
                data-tooltip={WRITE.closeContext}
                onClick={rail.close}
              >
                <CloseIcon />
              </button>
            ) : null}
          </div>
          <div className="context-body world-context-body">
            {!selected ? (
              <p className="small muted">{WORLD.noCardSelected}</p>
            ) : selected.kind === "note" ? (
              <div className="stack">
                <section className="rail-section">
                  <h3>{WORLD.noteCard}</h3>
                  <label>
                    {WRITE.noteTitle}
                    <input
                      type="text"
                      value={noteEdit?.title ?? selected.noteTitle}
                      onChange={(e) => {
                        dirtyNoteIdRef.current = selected.id;
                        setNoteEdit((n) => ({ title: e.target.value, body: n?.body ?? selected.noteBody }));
                      setCards((list) =>
                        list.map((c) =>
                          c.id === selected.id && c.kind === "note"
                            ? {
                                ...c,
                                noteTitle: e.target.value,
                                label: e.target.value.trim() || "Note",
                              }
                            : c,
                        ),
                      );
                      }}
                    />
                  </label>
                  <label>
                    {WRITE.noteText}
                    <textarea
                      rows={6}
                      value={noteEdit?.body ?? selected.noteBody}
                      onChange={(e) => {
                        dirtyNoteIdRef.current = selected.id;
                        setNoteEdit((n) => ({ title: n?.title ?? selected.noteTitle, body: e.target.value }));
                        setCards((list) =>
                          list.map((c) =>
                            c.id === selected.id && c.kind === "note" ? { ...c, noteBody: e.target.value } : c,
                          ),
                        );
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="small-button"
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
                        dirtyNoteIdRef.current = null;
                        setCards((list) => list.map((c) => (c.id === result.card.id ? result.card : c)));
                        router.refresh();
                      })
                    }
                  >
                    {WORLD.saveNote}
                  </button>
                </section>
                <section className="rail-section">
                  <p className="small muted" style={{ margin: 0 }}>
                    {WORLD.removeCardNote}
                  </p>
                  <button
                    type="button"
                    className="secondary small-button"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await removeBoardCardAction(projectId, board.id, selected.id);
                        if (!result.ok) {
                          setIssues(result.issues);
                          return;
                        }
                        setCards((list) => list.filter((c) => c.id !== selected.id));
                        setSelectedId(null);
                        router.refresh();
                      })
                    }
                  >
                    {WORLD.removeCard}
                  </button>
                </section>
              </div>
            ) : (
              <div className="stack">
                <section className="rail-section">
                  {preview?.ok ? (
                    <>
                      <h3>{preview.title}</h3>
                      <p className="row small muted">
                        {preview.typeLabel} <StatusBadge status={preview.authorityStatus} /> revision {preview.revision}
                      </p>
                      {selected.kind === "image" && selected.imageId ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/projects/${encodeURIComponent(projectId)}/images/${encodeURIComponent(selected.imageId)}`}
                          alt={selected.imageAlt || selected.imageName || ""}
                          style={{ maxWidth: "100%", borderRadius: "var(--radius-sm)" }}
                        />
                      ) : null}
                      <div className="reference-text document" style={{ maxHeight: "40vh", overflow: "auto" }}>
                        {preview.body || <span className="muted">(empty)</span>}
                      </div>
                      <Link
                        href={`/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(preview.id)}`}
                        className="small"
                      >
                        {WRITE.openFull}
                      </Link>
                    </>
                  ) : preview && !preview.ok ? (
                    <p className="error-text">{preview.message}</p>
                  ) : (
                    <p className="small muted">…</p>
                  )}
                </section>
                <section className="rail-section">
                  <p className="small muted" style={{ margin: 0 }}>
                    {WORLD.removeCardNote}
                  </p>
                  <button
                    type="button"
                    className="secondary small-button"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await removeBoardCardAction(projectId, board.id, selected.id);
                        if (!result.ok) {
                          setIssues(result.issues);
                          return;
                        }
                        setCards((list) => list.filter((c) => c.id !== selected.id));
                        setSelectedId(null);
                        router.refresh();
                      })
                    }
                  >
                    {WORLD.removeCard}
                  </button>
                </section>
              </div>
            )}
          </div>
        </div>
      </ContextRail>
    </div>
  );
}
