"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition, type PointerEvent as ReactPointerEvent } from "react";
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

  useEffect(() => {
    setBoard(initial);
    setCards(initial.cards);
    setTitle(initial.title);
  }, [initial]);

  const selected = cards.find((c) => c.id === selectedId) ?? null;

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

  const selectCard = (card: BoardCardView) => {
    setSelectedId(card.id);
    if (!rail.visible) rail.toggle();
  };

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

        <p className="small muted">{WORLD.dragHint}</p>
        <IssueList issues={issues} />
        <AskAboutBoard projectId={projectId} boardId={board.id} />

        <div className="board-toolbar row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
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

        <div
          ref={surfaceRef}
          className="board-surface"
          role="region"
          aria-label={WORLD.boardCanvas}
          onClick={() => setSelectedId(null)}
        >
          {cards.map((card) => (
            <div
              key={card.id}
              data-card-id={card.id}
              className={`board-card board-card-${card.kind}${selectedId === card.id ? " selected" : ""}`}
              style={{
                left: card.x,
                top: card.y,
                width: card.width,
                minHeight: card.height,
                zIndex: card.zIndex + (selectedId === card.id ? 1000 : 0),
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
              <span className="board-card-kind small muted">
                {card.kind === "note" ? WORLD.noteCard : card.kind === "image" ? WORLD.imageCard : WORLD.recordCard}
              </span>
              <strong className="board-card-title">{card.label}</strong>
              {card.kind === "record" && card.recordTypeLabel ? (
                <span className="small muted">{card.recordTypeLabel}</span>
              ) : null}
              {card.kind === "note" && card.noteBody ? <p className="small board-card-body">{card.noteBody}</p> : null}
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
          ))}
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
                <h3>{WORLD.noteCard}</h3>
                <label>
                  {WRITE.noteTitle}
                  <input
                    type="text"
                    value={noteEdit?.title ?? selected.noteTitle}
                    onChange={(e) => setNoteEdit((n) => ({ title: e.target.value, body: n?.body ?? selected.noteBody }))}
                  />
                </label>
                <label>
                  {WRITE.noteText}
                  <textarea
                    rows={6}
                    value={noteEdit?.body ?? selected.noteBody}
                    onChange={(e) => setNoteEdit((n) => ({ title: n?.title ?? selected.noteTitle, body: e.target.value }))}
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
                      setCards((list) => list.map((c) => (c.id === result.card.id ? result.card : c)));
                      router.refresh();
                    })
                  }
                >
                  {WORLD.saveNote}
                </button>
                <p className="small muted">{WORLD.removeCardNote}</p>
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
              </div>
            ) : (
              <div className="stack">
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
                <p className="small muted">{WORLD.removeCardNote}</p>
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
              </div>
            )}
          </div>
        </div>
      </ContextRail>
    </div>
  );
}
