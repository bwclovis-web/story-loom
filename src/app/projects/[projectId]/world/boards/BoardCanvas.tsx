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
import { Button } from "@/components/ui/Button";
import { CanvasToolbar, CanvasToolbarGroup } from "@/components/ui/CanvasToolbar";
import { IconButton } from "@/components/ui/IconButton";
import { ReferenceInspector } from "@/components/world/ReferenceInspector";
import { ContextRail, ContextRailToggle, useContextRail } from "@/components/shell/ContextRail";
import { CloseIcon } from "@/components/shell/icons";
import type { Issue } from "@/domain/issues";
import type { BoardCardView, BoardView } from "@/server/services/boardService";
import type { LoadedInspector } from "@/server/services/referenceInspectorService";
import { WORLD, WRITE } from "@/ui/labels";
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

  const inspectRecordId = selected && selected.kind !== "note" ? selected.recordId : null;

  useEffect(() => {
    if (!didDeepLink.current && initialCardId && initial.cards.some((card) => card.id === initialCardId)) {
      didDeepLink.current = true;
      setSelectedId(initialCardId);
      if (!railRef.current.visible) railRef.current.toggle();
    }
  }, [initialCardId, initial.cards]);

  useEffect(() => {
    if (selected?.kind === "note") {
      setNoteEdit({ title: selected.noteTitle, body: selected.noteBody });
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
  }, [projectId, inspectRecordId, selected?.kind, selected?.noteTitle, selected?.noteBody]);

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

  return (
    <div className="write-layout reference-write-layout board-layout visual-canvas">
      <div className="write-main board-main">
        <IssueList issues={issues} />

        <CanvasToolbar label={WORLD.boardCanvas}>
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
                onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)}
              >
                <option value="all">{WORLD.filterAllKinds}</option>
                <option value="record">{WORLD.filterRecords}</option>
                <option value="image">{WORLD.filterImages}</option>
                <option value="note">{WORLD.filterNotes}</option>
              </select>
            </label>
            <Button
              type="button"
              disabled={!selected}
              onClick={() => selected && fitRect([selected])}
              variant="secondary"
              size="sm"
            >
              {WORLD.fitSelection}
            </Button>
            <Button
              type="button"
              disabled={!visibleCards.length}
              onClick={() => fitRect(visibleCards)}
              variant="secondary"
              size="sm"
            >
              {WORLD.fitAll}
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

        <div
          ref={surfaceRef}
          className="board-surface board-surface-max"
          role="listbox"
          aria-label={WORLD.boardCanvas}
          aria-description={WORLD.keyboardBoardHint}
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
                        dirtyNoteIdRef.current = null;
                        setCards((list) => list.map((c) => (c.id === result.card.id ? result.card : c)));
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
                <section className="rail-section">
                  {inspection?.ok ? (
                    <ReferenceInspector
                      projectId={projectId}
                      model={inspection.model}
                      established={inspection.established}
                      linkMode="remote"
                      sourceNote={selected.kind === "image" ? WORLD.openedFromImage : null}
                    />
                  ) : inspection && !inspection.ok ? (
                    <p className="error-text">{inspection.message}</p>
                  ) : (
                    <p className="small muted">{WORLD.inspectorLoading}</p>
                  )}
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
