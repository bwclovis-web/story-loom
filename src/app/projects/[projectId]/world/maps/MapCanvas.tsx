"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition, type PointerEvent as ReactPointerEvent } from "react";
import { StatusBadge } from "@/components/Badges";
import { IssueList } from "@/components/IssueList";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { ReferenceInspector } from "@/components/world/ReferenceInspector";
import { ContextRail, ContextRailToggle, useContextRail } from "@/components/shell/ContextRail";
import { CloseIcon } from "@/components/shell/icons";
import type { Issue } from "@/domain/issues";
import type { WorldMapPinView, WorldMapView } from "@/server/services/worldMapService";
import { SHELL, WORLD, WRITE } from "@/ui/labels";
import type { LoadedInspector } from "@/server/services/referenceInspectorService";
import { inspectReferenceAction } from "../inspectorActions";
import {
  addWorldMapPinAction,
  deleteWorldMapAction,
  moveWorldMapPinAction,
  removeWorldMapPinAction,
  renameWorldMapAction,
} from "./actions";

export interface PlaceableRecord {
  id: string;
  title: string;
  typeLabel: string;
}

export function MapCanvas({
  projectId,
  map: initial,
  records,
  initialPinId = null,
}: {
  projectId: string;
  map: WorldMapView;
  records: PlaceableRecord[];
  initialPinId?: string | null;
}) {
  const router = useRouter();
  const idPrefix = useId();
  const railId = `${idPrefix}-map-rail`;
  const titleId = `${railId}-title`;
  const pinListId = `${idPrefix}-pin-list`;
  const rail = useContextRail();
  const [map, setMap] = useState(initial);
  const [pins, setPins] = useState(initial.pins);
  const [selectedId, setSelectedId] = useState<string | null>(initialPinId);
  const [inspection, setInspection] = useState<LoadedInspector | null>(null);
  const didDeepLink = useRef(false);
  const railRef = useRef(rail);
  railRef.current = rail;
  const [issues, setIssues] = useState<Issue[]>([]);
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(initial.title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingPlaceId, setPendingPlaceId] = useState("");
  const imageWrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pinId: string;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  useEffect(() => {
    setMap(initial);
    setPins(initial.pins);
    setTitle(initial.title);
  }, [initial]);

  const selected = pins.find((p) => p.id === selectedId) ?? null;

  const inspectRecordId = selected && !selected.unavailable ? selected.recordId : null;

  useEffect(() => {
    if (!didDeepLink.current && initialPinId && initial.pins.some((pin) => pin.id === initialPinId)) {
      didDeepLink.current = true;
      setSelectedId(initialPinId);
      if (!railRef.current.visible) railRef.current.toggle();
    }
  }, [initialPinId, initial.pins]);

  useEffect(() => {
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
  }, [projectId, inspectRecordId]);

  const selectPin = (pin: WorldMapPinView) => {
    setSelectedId(pin.id);
    if (!rail.visible) rail.toggle();
  };

  const normFromClient = (clientX: number, clientY: number) => {
    const el = imageWrapRef.current;
    if (!el) return { xNorm: 0.5, yNorm: 0.5 };
    const rect = el.getBoundingClientRect();
    const xNorm = rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0.5;
    const yNorm = rect.height > 0 ? Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)) : 0.5;
    return { xNorm, yNorm };
  };

  const onPointerDown = (e: ReactPointerEvent, pin: WorldMapPinView) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      pinId: pin.id,
      startX: e.clientX,
      startY: e.clientY,
      originX: pin.xNorm,
      originY: pin.yNorm,
    };
    selectPin(pin);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pinId !== e.currentTarget.getAttribute("data-pin-id")) return;
    const el = imageWrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const dx = rect.width > 0 ? (e.clientX - drag.startX) / rect.width : 0;
    const dy = rect.height > 0 ? (e.clientY - drag.startY) / rect.height : 0;
    const xNorm = Math.min(1, Math.max(0, drag.originX + dx));
    const yNorm = Math.min(1, Math.max(0, drag.originY + dy));
    setPins((list) => list.map((p) => (p.id === drag.pinId ? { ...p, xNorm, yNorm } : p)));
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    const pin = pins.find((p) => p.id === drag.pinId);
    if (!pin) return;
    const moved = pin.xNorm !== drag.originX || pin.yNorm !== drag.originY;
    if (!moved) return;
    startTransition(async () => {
      const result = await moveWorldMapPinAction(projectId, map.id, pin.id, {
        xNorm: pin.xNorm,
        yNorm: pin.yNorm,
      });
      if (!result.ok) {
        setIssues(result.issues);
        setPins(initial.pins);
        return;
      }
      setPins((list) => list.map((p) => (p.id === result.pin.id ? result.pin : p)));
      router.refresh();
    });
  };

  const placePin = (recordId: string, xNorm: number, yNorm: number) => {
    startTransition(async () => {
      const result = await addWorldMapPinAction(projectId, map.id, { recordId, xNorm, yNorm });
      if (!result.ok) {
        setIssues(result.issues);
        return;
      }
      setPins((list) => [...list, result.pin]);
      selectPin(result.pin);
      setPendingPlaceId("");
      router.refresh();
    });
  };

  return (
    <div className="write-layout reference-write-layout board-layout">
      <div className="write-main board-main">
        <div className="doc-toolbar">
          <h2 className="board-title-display">{title}</h2>
          <div className="doc-toolbar-end">
            <ContextRailToggle rail={rail} controls={railId} />
          </div>
        </div>

        <p className="board-meta small muted">
          <span>{WORLD.pinClickHint}</span>
          <span>
            Backdrop: {map.imageName} on {map.hostRecordTitle}
          </span>
        </p>
        <IssueList issues={issues} />

        <div className="board-toolbar board-toolbar-compact" role="toolbar" aria-label={WORLD.mapCanvas}>
          <div className="board-toolbar-group">
            <label>
              <span className="sr-only">{WORLD.addPin}</span>
              <select
                value={pendingPlaceId}
                disabled={pending}
                onChange={(e) => setPendingPlaceId(e.target.value)}
              >
                <option value="">{WORLD.choosePlace}</option>
                {records.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title} ({r.typeLabel})
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="button"
             
              disabled={pending || !pendingPlaceId}
              onClick={() => {
                if (!pendingPlaceId) return;
                placePin(pendingPlaceId, 0.5, 0.5);
              }}
             size="sm">
              {WORLD.addPin}
            </Button>
          </div>
          <details className="board-overflow">
            <summary>{SHELL.moreActions}</summary>
            <div className="board-overflow-body">
              <form
                className="row"
                style={{ gap: "0.35rem", flexWrap: "wrap" }}
                onSubmit={(e) => {
                  e.preventDefault();
                  startTransition(async () => {
                    const result = await renameWorldMapAction(projectId, map.id, title);
                    if (!result.ok) setIssues(result.issues);
                    else {
                      setIssues([]);
                      router.refresh();
                    }
                  });
                }}
              >
                <label className="board-title-field">
                  <span className="sr-only">{WORLD.renameMap}</span>
                  <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required />
                </label>
                <Button type="submit" disabled={pending} variant="secondary" size="sm">
                  {WORLD.renameMap}
                </Button>
              </form>
              {!confirmDelete ? (
                <Button type="button" onClick={() => setConfirmDelete(true)} variant="secondary" size="sm">
                  {WORLD.deleteMap}
                </Button>
              ) : (
                <Button
                  type="button"
                 
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await deleteWorldMapAction(projectId, map.id);
                      if (!result.ok) {
                        setIssues(result.issues);
                        return;
                      }
                      router.push(`/projects/${encodeURIComponent(projectId)}/world/maps`);
                      router.refresh();
                    })
                  }
                 size="sm">
                  {WORLD.confirmDeleteMap(map.title)}
                </Button>
              )}
            </div>
          </details>
        </div>

        <div
          ref={imageWrapRef}
          className="map-surface board-surface-max"
          role="region"
          aria-label={WORLD.mapCanvas}
          onClick={(e) => {
            if (!pendingPlaceId) {
              setSelectedId(null);
              return;
            }
            const { xNorm, yNorm } = normFromClient(e.clientX, e.clientY);
            placePin(pendingPlaceId, xNorm, yNorm);
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="map-backdrop"
            src={`/projects/${encodeURIComponent(projectId)}/images/${encodeURIComponent(map.imageId)}`}
            alt={map.imageName}
            draggable={false}
          />
          {pins.map((pin) => (
            <button
              key={pin.id}
              type="button"
              data-pin-id={pin.id}
              className={`map-pin${selectedId === pin.id ? " selected" : ""}${pin.unavailable ? " unavailable" : ""}`}
              style={{ left: `${pin.xNorm * 100}%`, top: `${pin.yNorm * 100}%` }}
              aria-label={pin.unavailable ? `${pin.title} (${WORLD.pinUnavailable})` : pin.title}
              aria-pressed={selectedId === pin.id}
              onPointerDown={(e) => onPointerDown(e, pin)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onClick={(e) => {
                e.stopPropagation();
                selectPin(pin);
              }}
            >
              <span className="map-pin-dot" aria-hidden="true" />
            </button>
          ))}
        </div>

        <section className="panel" aria-labelledby={pinListId}>
          <h2 id={pinListId}>{WORLD.pinList}</h2>
          <p className="small muted">{WORLD.pinsCount(pins.length)}</p>
          {pins.length === 0 ? (
            <p className="muted">{WORLD.noPinSelected}</p>
          ) : (
            <ul className="map-pin-list">
              {pins.map((pin) => (
                <li key={pin.id}>
                  <button
                    type="button"
                    className={`map-pin-list-item${selectedId === pin.id ? " selected" : ""}`}
                    aria-current={selectedId === pin.id ? "true" : undefined}
                    onClick={() => selectPin(pin)}
                  >
                    <span>{pin.title}</span>
                    <span className="small muted">
                      {pin.typeLabel}
                      {pin.unavailable ? ` · ${WORLD.pinUnavailable}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <ContextRail id={railId} labelledBy={titleId} rail={rail} focusOnOverlayOpen>
        <div className="context-head">
          <h2 id={titleId}>{WORLD.mapRail}</h2>
          {!rail.wide ? (
            <IconButton tip="none" aria-label={WRITE.hideContext} onClick={rail.close}>
              <CloseIcon />
            </IconButton>
          ) : null}
        </div>
        <div className="context-body">
        {!selected ? (
          <p className="muted">{WORLD.noPinSelected}</p>
        ) : (
          <div className="stack">
            <div>
              <p className="board-card-kind">{selected.typeLabel}</p>
              <p className="board-card-title">{selected.title}</p>
              <StatusBadge status={selected.authorityStatus} />
              {selected.unavailable ? <p className="small muted">{WORLD.pinUnavailable}</p> : null}
            </div>
            {selected.unavailable ? null : inspection?.ok ? (
              <ReferenceInspector
                projectId={projectId}
                model={inspection.model}
                established={inspection.established}
                linkMode="remote"
              />
            ) : inspection && !inspection.ok ? (
              <p className="muted">{inspection.message}</p>
            ) : (
              <p className="muted">{WORLD.inspectorLoading}</p>
            )}
            <p className="small muted">{WORLD.removePinNote}</p>
            <Button
              type="button"
             
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await removeWorldMapPinAction(projectId, map.id, selected.id);
                  if (!result.ok) {
                    setIssues(result.issues);
                    return;
                  }
                  setPins((list) => list.filter((p) => p.id !== selected.id));
                  setSelectedId(null);
                  router.refresh();
                })
              }
             variant="secondary" size="sm">
              {WORLD.removePin}
            </Button>
          </div>
        )}
        </div>
      </ContextRail>
    </div>
  );
}
