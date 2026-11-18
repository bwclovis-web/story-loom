"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition, type PointerEvent as ReactPointerEvent } from "react";
import { IssueList } from "@/components/IssueList";
import { ContextRail, ContextRailToggle, useContextRail } from "@/components/shell/ContextRail";
import { CloseIcon } from "@/components/shell/icons";
import type { Issue } from "@/domain/issues";
import {
  WEAVE_DECISIONS,
  WEAVE_DECISION_LABELS,
  type WeaveBeatView,
  type WeaveGridView,
} from "@/server/services/weaveService";
import { WEAVE, WRITE } from "@/ui/labels";
import {
  addWeaveBeatAction,
  addWeaveBeatWorldRefAction,
  addWeaveSetupPayoffAction,
  deleteWeaveGridAction,
  moveWeaveBeatAction,
  removeWeaveBeatAction,
  removeWeaveBeatWorldRefAction,
  removeWeaveSetupPayoffAction,
  renameWeaveGridAction,
  saveWeaveGridAsTemplateAction,
  updateWeaveBeatAction,
} from "./actions";

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

export function WeaveCanvas({
  projectId,
  grid: initial,
  manuscriptChoices,
  worldChoices,
  seriesBeats,
}: {
  projectId: string;
  grid: WeaveGridView;
  manuscriptChoices: ManuscriptChoice[];
  worldChoices: WorldChoice[];
  seriesBeats: SeriesBeatChoice[];
}) {
  const router = useRouter();
  const idPrefix = useId();
  const railId = `${idPrefix}-weave-rail`;
  const titleId = `${railId}-title`;
  const rail = useContextRail();
  const [grid, setGrid] = useState(initial);
  const [beats, setBeats] = useState(initial.beats);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(initial.title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [templateTitle, setTemplateTitle] = useState("");
  const [setupFrom, setSetupFrom] = useState("");
  const [setupTo, setSetupTo] = useState("");
  const surfaceRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    beatId: string;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  useEffect(() => {
    setGrid(initial);
    setBeats(initial.beats);
    setTitle(initial.title);
  }, [initial]);

  const selected = beats.find((b) => b.id === selectedId) ?? null;

  const selectBeat = (beat: WeaveBeatView) => {
    setSelectedId(beat.id);
    if (!rail.visible) rail.toggle();
  };

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
        return;
      }
      setBeats((list) => list.map((b) => (b.id === result.beat.id ? result.beat : b)));
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
          <div className="doc-toolbar-end">
            <ContextRailToggle rail={rail} controls={railId} />
          </div>
        </div>

        <p className="small muted">
          {grid.viewLabel}. {WEAVE.dragBeatHint}
        </p>
        <IssueList issues={issues} />

        <div className="board-toolbar row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
          <button
            type="button"
            className="secondary small-button"
            disabled={pending}
            onClick={() => {
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
            }}
          >
            {WEAVE.addBeat}
          </button>
          <form
            className="row"
            style={{ gap: "0.35rem" }}
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

        <div
          ref={surfaceRef}
          className="board-surface"
          role="region"
          aria-label={WEAVE.beatCanvas}
          onClick={() => setSelectedId(null)}
        >
          {beats.map((beat) => (
            <div
              key={beat.id}
              data-beat-id={beat.id}
              className={`board-card${selectedId === beat.id ? " selected" : ""}`}
              style={{
                left: beat.x,
                top: beat.y,
                width: beat.width,
                minHeight: beat.height,
                zIndex: beat.zIndex + (selectedId === beat.id ? 1000 : 0),
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
                <p className="small muted">
                  {beat.manuscriptTitle}
                  {beat.manuscriptUnavailable ? " (Trash)" : ""}
                </p>
              ) : null}
            </div>
          ))}
        </div>

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
      </div>

      <ContextRail id={railId} labelledBy={titleId} rail={rail} focusOnOverlayOpen>
        <div className="context-head">
          <h2 id={titleId}>{WEAVE.beatRail}</h2>
          {!rail.wide ? (
            <button type="button" className="icon-button" aria-label={WRITE.hideContext} onClick={rail.close}>
              <CloseIcon />
            </button>
          ) : null}
        </div>
        {!selected ? (
          <p className="muted">{WEAVE.noBeatSelected}</p>
        ) : (
          <div className="stack">
            <label>
              {WEAVE.beatTitle}
              <input
                value={selected.title}
                onChange={(e) =>
                  setBeats((list) => list.map((b) => (b.id === selected.id ? { ...b, title: e.target.value } : b)))
                }
                onBlur={() =>
                  startTransition(async () => {
                    const result = await updateWeaveBeatAction(projectId, grid.id, selected.id, {
                      title: selected.title,
                    });
                    if (!result.ok) setIssues(result.issues);
                    else router.refresh();
                  })
                }
              />
            </label>
            <label>
              {WEAVE.beatBody}
              <textarea
                rows={4}
                value={selected.body}
                onChange={(e) =>
                  setBeats((list) => list.map((b) => (b.id === selected.id ? { ...b, body: e.target.value } : b)))
                }
                onBlur={() =>
                  startTransition(async () => {
                    const result = await updateWeaveBeatAction(projectId, grid.id, selected.id, {
                      body: selected.body,
                    });
                    if (!result.ok) setIssues(result.issues);
                    else router.refresh();
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
                      setBeats((list) =>
                        list.map((b) => (b.id === selected.id && result.ok ? result.beat : b)),
                      );
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
                      setBeats((list) =>
                        list.map((b) => (b.id === selected.id && result.ok ? result.beat : b)),
                      );
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
                href={`/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(selected.manuscriptRecordId)}`}
              >
                Open linked manuscript
              </Link>
            ) : null}

            <div>
              <p className="small">{WEAVE.worldRefs}</p>
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
              <select
                defaultValue=""
                disabled={pending}
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
      </ContextRail>
    </div>
  );
}
