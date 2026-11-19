"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { StatusBadge } from "@/components/Badges";
import { IssueList } from "@/components/IssueList";
import { BoardOverflowMenu } from "@/components/ui/BoardOverflowMenu";
import { Button, ButtonLink } from "@/components/ui/Button";
import { CanvasToolbar, CanvasToolbarGroup } from "@/components/ui/CanvasToolbar";
import { IconButton } from "@/components/ui/IconButton";
import { ReferenceInspector } from "@/components/world/ReferenceInspector";
import { ContextRail, ContextRailToggle, useContextRail } from "@/components/shell/ContextRail";
import { CloseIcon } from "@/components/shell/icons";
import { errorIssue, type Issue } from "@/domain/issues";
import type { LoadedInspector } from "@/server/services/referenceInspectorService";
import type { WorldMapPinView, WorldMapView } from "@/server/services/worldMapService";
import { WORLD, WRITE } from "@/ui/labels";
import {
  addShapePoint,
  cancelShape,
  editShape,
  startShape,
  type MarkerKind,
  type ShapeDraft,
} from "@/world/mapGeometry";
import {
  MARKER_GROUPS,
  clampMapZoom,
  pushMapTrail,
  readHiddenGroups,
  readMapMode,
  readMapTrail,
  readMapView,
  trailWithoutCurrent,
  writeHiddenGroups,
  writeMapMode,
  writeMapTrail,
  writeMapView,
  type MapTrailItem,
  type MapViewState,
  type MarkerGroup,
} from "@/world/mapMarkers";
import { inspectReferenceAction } from "../inspectorActions";
import {
  addWorldMapPinAction,
  deleteWorldMapAction,
  moveWorldMapPinAction,
  removeWorldMapPinAction,
  renameWorldMapAction,
  setWorldMapPinGeometryAction,
  updateWorldMapPinAction,
} from "./actions";
import { MapShapeEditor } from "./MapShapeEditor";

export interface PlaceableRecord {
  id: string;
  title: string;
  typeLabel: string;
}

export interface PlaceableMap {
  id: string;
  title: string;
}

const GROUP_LABEL: Record<MarkerGroup, string> = {
  places: WORLD.markerGroupPlaces,
  waterways: WORLD.markerGroupWaterways,
  transport: WORLD.markerGroupTransport,
  story: WORLD.markerGroupStory,
};

const KIND_LABEL: Record<MarkerKind, string> = {
  point: WORLD.markerKindPoint,
  route: WORLD.markerKindRoute,
  area: WORLD.markerKindArea,
  label: WORLD.markerKindLabel,
};

const SHAPE_STROKE: Record<MarkerGroup, string> = {
  places: "var(--color-accent)",
  waterways: "var(--color-ok, #2f6f4e)",
  transport: "var(--color-warn, #a15c12)",
  story: "var(--color-violet, #5b4b8a)",
};

export function MapCanvas({
  projectId,
  map: initial,
  records,
  otherMaps,
  initialPinId = null,
}: {
  projectId: string;
  map: WorldMapView;
  records: PlaceableRecord[];
  otherMaps: PlaceableMap[];
  initialPinId?: string | null;
}) {
  const router = useRouter();
  const idPrefix = useId();
  const railId = `${idPrefix}-map-rail`;
  const titleId = `${railId}-title`;
  const pinListId = `${idPrefix}-pin-list`;
  const listboxId = `${idPrefix}-pin-listbox`;
  const searchId = `${idPrefix}-marker-search`;
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
  const [mode, setMode] = useState<"browse" | "edit">("browse");
  const [view, setView] = useState<MapViewState>({ zoom: 1, x: 0, y: 0 });
  const [trail, setTrail] = useState<MapTrailItem[]>([]);
  const [hiddenGroups, setHiddenGroups] = useState<MarkerGroup[]>([]);
  const [query, setQuery] = useState("");
  const [pendingPlaceId, setPendingPlaceId] = useState("");
  const [pendingMapId, setPendingMapId] = useState("");
  const [pendingGroup, setPendingGroup] = useState<MarkerGroup>("places");
  const [pendingLabel, setPendingLabel] = useState("");
  const [tool, setTool] = useState<MarkerKind>("point");
  const [draft, setDraft] = useState<ShapeDraft | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const skipSave = useRef(true);
  const dragRef = useRef<{
    pinId: string;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    xNorm: number;
    yNorm: number;
    revision: number;
  } | null>(null);
  const panRef = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);

  useEffect(() => {
    setMap(initial);
    setPins(initial.pins);
    setTitle(initial.title);
  }, [initial]);

  useEffect(() => {
    skipSave.current = true;
    setView(readMapView(initial.id));
    setMode(readMapMode());
    setHiddenGroups(readHiddenGroups());
    setTrail(trailWithoutCurrent(readMapTrail(projectId), initial.id));
  }, [initial.id, projectId]);

  useEffect(() => {
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    writeMapView(map.id, view);
  }, [view, map.id]);

  const selected = pins.find((p) => p.id === selectedId) ?? null;
  const inspectRecordId = selected?.recordId && !selected.unavailable ? selected.recordId : null;
  const shown = pins.filter((pin) => !hiddenGroups.includes(pin.markerGroup));
  const needle = query.trim().toLowerCase();
  const listed = shown.filter((pin) => {
    if (!needle) return true;
    return `${pin.title} ${pin.typeLabel} ${GROUP_LABEL[pin.markerGroup]}`.toLowerCase().includes(needle);
  });

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

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
      const rect = el.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      setView((current) => {
        const zoom = clampMapZoom(current.zoom * factor);
        const scale = zoom / current.zoom;
        return { zoom, x: px - (px - current.x) * scale, y: py - (py - current.y) * scale };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const selectPin = (pin: WorldMapPinView) => {
    setSelectedId(pin.id);
    if (!rail.visible) rail.toggle();
  };

  const changeMode = (next: "browse" | "edit") => {
    setMode(next);
    writeMapMode(next);
    if (next === "browse") setDraft(null);
  };

  const chooseTool = (next: MarkerKind) => {
    setTool(next);
    setDraft(next === "point" ? null : startShape(next));
  };

  const cancelDraft = () => {
    if (!draft) return;
    const result = cancelShape(draft);
    if (result.wrote) return;
    setDraft(draft.pinId ? null : startShape(draft.kind));
  };

  const toggleGroup = (group: MarkerGroup) => {
    setHiddenGroups((current) => {
      const next = current.includes(group) ? current.filter((item) => item !== group) : [...current, group];
      writeHiddenGroups(next);
      return next;
    });
  };

  const normFromClient = (clientX: number, clientY: number) => {
    const el = imageRef.current;
    if (!el) return { xNorm: 0.5, yNorm: 0.5 };
    const rect = el.getBoundingClientRect();
    const xNorm = rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0.5;
    const yNorm = rect.height > 0 ? Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)) : 0.5;
    return { xNorm, yNorm };
  };

  const onPinPointerDown = (e: ReactPointerEvent, pin: WorldMapPinView) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    selectPin(pin);
    if (mode !== "edit") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (pin.kind === "route" || pin.kind === "area" || draft) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      pinId: pin.id,
      startX: e.clientX,
      startY: e.clientY,
      originX: pin.xNorm,
      originY: pin.yNorm,
      xNorm: pin.xNorm,
      yNorm: pin.yNorm,
      revision: pin.revision,
    };
  };

  const onPinPointerMove = (e: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag || mode !== "edit" || drag.pinId !== e.currentTarget.getAttribute("data-pin-id")) return;
    const el = imageRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const dx = rect.width > 0 ? (e.clientX - drag.startX) / rect.width : 0;
    const dy = rect.height > 0 ? (e.clientY - drag.startY) / rect.height : 0;
    drag.xNorm = Math.min(1, Math.max(0, drag.originX + dx));
    drag.yNorm = Math.min(1, Math.max(0, drag.originY + dy));
    setPins((list) => list.map((p) => (p.id === drag.pinId ? { ...p, xNorm: drag.xNorm, yNorm: drag.yNorm } : p)));
  };

  const onPinPointerUp = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    const moved = drag.xNorm !== drag.originX || drag.yNorm !== drag.originY;
    if (!moved) return;
    startTransition(async () => {
      const result = await moveWorldMapPinAction(projectId, map.id, drag.pinId, {
        xNorm: drag.xNorm,
        yNorm: drag.yNorm,
        expectedRevision: drag.revision,
      });
      if (!result.ok) {
        setIssues(result.issues);
        setPins((list) =>
          list.map((pin) => (pin.id === drag.pinId ? { ...pin, xNorm: drag.originX, yNorm: drag.originY } : pin)),
        );
        if (result.issues.some((issue) => issue.code === "STALE_REVISION")) router.refresh();
        return;
      }
      setPins((list) => list.map((p) => (p.id === result.pin.id ? result.pin : p)));
      router.refresh();
    });
  };

  const placePin = (xNorm: number, yNorm: number) => {
    if (!pendingPlaceId && !pendingMapId) {
      setIssues([errorIssue("INVALID_REFERENCE", WORLD.markerNeedsLink)]);
      return;
    }
    startTransition(async () => {
      const result = await addWorldMapPinAction(projectId, map.id, {
        recordId: pendingPlaceId || null,
        targetMapId: pendingMapId || null,
        markerGroup: pendingGroup,
        label: pendingLabel,
        xNorm,
        yNorm,
      });
      if (!result.ok) {
        setIssues(result.issues);
        return;
      }
      setIssues([]);
      setPins((list) => [...list, result.pin]);
      selectPin(result.pin);
      router.refresh();
    });
  };

  const saveDraft = () => {
    if (!draft) return;
    if (draft.kind === "label" && !draft.pinId && !pendingLabel.trim()) {
      setIssues([errorIssue("INVALID_REFERENCE", WORLD.labelNeedsText)]);
      return;
    }
    startTransition(async () => {
      if (draft.pinId) {
        const current = pins.find((pin) => pin.id === draft.pinId);
        if (!current) return;
        const result = await setWorldMapPinGeometryAction(projectId, map.id, draft.pinId, {
          expectedRevision: current.revision,
          points: draft.points,
        });
        if (!result.ok) {
          setIssues(result.issues);
          if (result.issues.some((issue) => issue.code === "STALE_REVISION")) {
            setDraft(null);
            router.refresh();
          }
          return;
        }
        setIssues([]);
        setDraft(null);
        setPins((list) => list.map((pin) => (pin.id === result.pin.id ? result.pin : pin)));
        router.refresh();
        return;
      }
      const anchor = draft.points[0] ?? { x: 0.5, y: 0.5 };
      const result = await addWorldMapPinAction(projectId, map.id, {
        kind: draft.kind,
        points: draft.points,
        xNorm: anchor.x,
        yNorm: anchor.y,
        recordId: pendingPlaceId || null,
        targetMapId: pendingMapId || null,
        markerGroup: pendingGroup,
        label: pendingLabel,
      });
      if (!result.ok) {
        setIssues(result.issues);
        return;
      }
      setIssues([]);
      setDraft(null);
      setTool("point");
      setPins((list) => [...list, result.pin]);
      selectPin(result.pin);
      router.refresh();
    });
  };

  const deleteDraftShape = () => {
    if (!draft?.pinId) return;
    const current = pins.find((pin) => pin.id === draft.pinId);
    if (!current) return;
    startTransition(async () => {
      const result = await removeWorldMapPinAction(projectId, map.id, current.id, current.revision);
      if (!result.ok) {
        setIssues(result.issues);
        if (result.issues.some((issue) => issue.code === "STALE_REVISION")) router.refresh();
        return;
      }
      setIssues([]);
      setDraft(null);
      setPins((list) => list.filter((pin) => pin.id !== current.id));
      setSelectedId(null);
      router.refresh();
    });
  };

  const onSurfacePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-pin-id]")) return;
    if (mode !== "browse") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    panRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: viewRef.current.x,
      originY: viewRef.current.y,
      moved: false,
    };
  };

  const onSurfacePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (!pan) return;
    const x = pan.originX + (e.clientX - pan.startX);
    const y = pan.originY + (e.clientY - pan.startY);
    if (Math.abs(e.clientX - pan.startX) + Math.abs(e.clientY - pan.startY) > 3) pan.moved = true;
    setView((current) => ({ ...current, x, y }));
  };

  const onSurfacePointerUp = () => {
    panRef.current = null;
  };

  const openDetailedMap = (targetId: string) => {
    const next = pushMapTrail(trailWithoutCurrent(readMapTrail(projectId), map.id), { id: map.id, title: map.title });
    writeMapTrail(projectId, next);
    writeMapView(map.id, viewRef.current);
    router.push(`/projects/${encodeURIComponent(projectId)}/world/maps/${encodeURIComponent(targetId)}`);
  };

  const returnToTrail = (index: number) => {
    const item = trail[index];
    if (!item) return;
    writeMapTrail(projectId, trail.slice(0, index));
    writeMapView(map.id, viewRef.current);
    router.push(`/projects/${encodeURIComponent(projectId)}/world/maps/${encodeURIComponent(item.id)}`);
  };

  const onListKey = (event: ReactKeyboardEvent<HTMLUListElement>) => {
    if (!listed.length) return;
    const index = listed.findIndex((pin) => pin.id === selectedId);
    const move = (next: number) => {
      event.preventDefault();
      const pin = listed[next];
      if (pin) selectPin(pin);
    };
    if (event.key === "ArrowDown") move(Math.min(listed.length - 1, index < 0 ? 0 : index + 1));
    if (event.key === "ArrowUp") move(Math.max(0, index < 0 ? 0 : index - 1));
    if (event.key === "Home") move(0);
    if (event.key === "End") move(listed.length - 1);
    if (event.key === "Enter" && index >= 0) {
      event.preventDefault();
      selectPin(listed[index]!);
    }
  };

  const recordHref = (recordId: string) =>
    `/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(recordId)}`;

  return (
    <div className="write-layout reference-write-layout board-layout">
      <div className="write-main board-main">
        {trail.length > 0 ? (
          <nav className="map-trail" aria-label={WORLD.mapBreadcrumb}>
            <ol>
              {trail.map((item, index) => (
                <li key={item.id}>
                  <button type="button" onClick={() => returnToTrail(index)}>
                    {item.title}
                  </button>
                </li>
              ))}
              <li aria-current="page">{map.title}</li>
            </ol>
          </nav>
        ) : null}

        <div className="doc-toolbar">
          <h2 className="board-title-display">{title}</h2>
          <div className="doc-toolbar-end">
            <ContextRailToggle rail={rail} controls={railId} />
          </div>
        </div>

        <div className="map-mode" role="group" aria-label={`${WORLD.mapModeBrowse} / ${WORLD.mapModeEdit}`}>
          <Button type="button" size="sm" variant={mode === "browse" ? "primary" : "secondary"} aria-pressed={mode === "browse"} onClick={() => changeMode("browse")}>
            {WORLD.mapModeBrowse}
          </Button>
          <Button type="button" size="sm" variant={mode === "edit" ? "primary" : "secondary"} aria-pressed={mode === "edit"} onClick={() => changeMode("edit")}>
            {WORLD.mapModeEdit}
          </Button>
          <p className="small muted">{mode === "browse" ? WORLD.mapModeBrowseHint : WORLD.mapModeEditHint}</p>
        </div>

        <p className="board-meta small muted">
          <span>{WORLD.pinClickHint}</span>
          <span>
            Backdrop: {map.imageName} on {map.hostRecordTitle}
          </span>
        </p>
        <IssueList issues={issues} />

        <CanvasToolbar label={WORLD.mapCanvas}>
          <CanvasToolbarGroup>
            <Button type="button" size="sm" variant="secondary" onClick={() => setView((current) => ({ ...current, zoom: clampMapZoom(current.zoom * 1.25) }))}>
              {WORLD.mapZoomIn}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setView((current) => ({ ...current, zoom: clampMapZoom(current.zoom / 1.25) }))}>
              {WORLD.mapZoomOut}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setView({ zoom: 1, x: 0, y: 0 })}>
              {WORLD.mapZoomReset}
            </Button>
          </CanvasToolbarGroup>
          {mode === "edit" ? (
            <CanvasToolbarGroup>
              <span className="sr-only">{WORLD.markerTools}</span>
              {(["point", "route", "area", "label"] as const).map((kind) => (
                <Button
                  key={kind}
                  type="button"
                  size="sm"
                  variant={tool === kind ? "primary" : "secondary"}
                  aria-pressed={tool === kind}
                  onClick={() => chooseTool(kind)}
                >
                  {KIND_LABEL[kind]}
                </Button>
              ))}
            </CanvasToolbarGroup>
          ) : null}
          {mode === "edit" ? (
            <CanvasToolbarGroup className="map-place-fields">
              <label>
                <span className="sr-only">{WORLD.markerGroup}</span>
                <select value={pendingGroup} onChange={(e) => setPendingGroup(e.target.value as MarkerGroup)}>
                  {MARKER_GROUPS.map((group) => (
                    <option key={group} value={group}>
                      {GROUP_LABEL[group]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="sr-only">{WORLD.choosePlace}</span>
                <select value={pendingPlaceId} disabled={pending} onChange={(e) => setPendingPlaceId(e.target.value)}>
                  <option value="">{WORLD.choosePlace}</option>
                  {records.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title} ({r.typeLabel})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="sr-only">{WORLD.chooseDetailedMap}</span>
                <select value={pendingMapId} disabled={pending} onChange={(e) => setPendingMapId(e.target.value)}>
                  <option value="">{otherMaps.length ? WORLD.chooseDetailedMap : WORLD.noDetailedMap}</option>
                  {otherMaps.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="sr-only">{WORLD.markerLabel}</span>
                <input value={pendingLabel} maxLength={120} placeholder={WORLD.markerLabel} onChange={(e) => setPendingLabel(e.target.value)} />
              </label>
              {tool === "point" ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={pending || (!pendingPlaceId && !pendingMapId)}
                  onClick={() => placePin(0.5, 0.5)}
                >
                  {WORLD.addPin}
                </Button>
              ) : null}
            </CanvasToolbarGroup>
          ) : null}
          <BoardOverflowMenu>
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
                  size="sm"
                >
                  {WORLD.confirmDeleteMap(map.title)}
                </Button>
              )}
          </BoardOverflowMenu>
        </CanvasToolbar>
        {draft ? (
          <MapShapeEditor
            draft={draft}
            pending={pending}
            onChange={setDraft}
            onCancel={cancelDraft}
            onSave={saveDraft}
            onDelete={draft.pinId ? deleteDraftShape : null}
          />
        ) : null}

        <fieldset className="map-legend">
          <legend>{WORLD.markerLegend}</legend>
          {MARKER_GROUPS.map((group) => (
            <label key={group}>
              <input
                type="checkbox"
                checked={!hiddenGroups.includes(group)}
                onChange={() => toggleGroup(group)}
              />
              <span className={`map-legend-swatch map-group-${group}`} aria-hidden="true" />
              {GROUP_LABEL[group]}
            </label>
          ))}
        </fieldset>

        <div
          ref={viewportRef}
          className={`map-viewport map-mode-${mode}`}
          onPointerDown={onSurfacePointerDown}
          onPointerMove={onSurfacePointerMove}
          onPointerUp={onSurfacePointerUp}
          onPointerCancel={onSurfacePointerUp}
        >
          <div
            className="map-stage"
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
          >
            <div
              className="map-surface"
              role="region"
              aria-label={WORLD.mapCanvas}
              onClick={(e) => {
                if (mode !== "edit") return;
                if ((e.target as HTMLElement).closest("[data-pin-id], .map-shape")) return;
                const { xNorm, yNorm } = normFromClient(e.clientX, e.clientY);
                if (tool === "point") {
                  if (!pendingPlaceId && !pendingMapId) {
                    setSelectedId(null);
                    return;
                  }
                  placePin(xNorm, yNorm);
                  return;
                }
                setDraft((current) => {
                  const base = current && current.kind === tool && !current.pinId ? current : startShape(tool);
                  return addShapePoint(base, { x: xNorm, y: yNorm });
                });
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imageRef}
                className="map-backdrop"
                src={`/projects/${encodeURIComponent(projectId)}/images/${encodeURIComponent(map.imageId)}`}
                alt={map.imageName}
                draggable={false}
              />
              <svg className="map-geometry" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                {shown
                  .filter((pin) => pin.kind === "area" && pin.points.length >= 3 && draft?.pinId !== pin.id)
                  .map((pin) => (
                    <polygon
                      key={pin.id}
                      className={`map-shape map-shape-area${selectedId === pin.id ? " selected" : ""}`}
                      points={pin.points.map((point) => `${point.x * 100},${point.y * 100}`).join(" ")}
                      style={{ stroke: SHAPE_STROKE[pin.markerGroup] }}
                      onClick={(event) => {
                        event.stopPropagation();
                        selectPin(pin);
                      }}
                    />
                  ))}
                {shown
                  .filter((pin) => pin.kind === "route" && pin.points.length >= 2 && draft?.pinId !== pin.id)
                  .map((pin) => (
                    <polyline
                      key={pin.id}
                      className={`map-shape${selectedId === pin.id ? " selected" : ""}`}
                      points={pin.points.map((point) => `${point.x * 100},${point.y * 100}`).join(" ")}
                      style={{ stroke: SHAPE_STROKE[pin.markerGroup] }}
                      onClick={(event) => {
                        event.stopPropagation();
                        selectPin(pin);
                      }}
                    />
                  ))}
                {draft && draft.kind === "area" && draft.points.length >= 3 ? (
                  <polygon
                    className="map-shape map-shape-area draft"
                    points={draft.points.map((point) => `${point.x * 100},${point.y * 100}`).join(" ")}
                  />
                ) : null}
                {draft && draft.kind === "route" && draft.points.length >= 2 ? (
                  <polyline
                    className="map-shape draft"
                    points={draft.points.map((point) => `${point.x * 100},${point.y * 100}`).join(" ")}
                  />
                ) : null}
              </svg>
              {shown.map((pin) => (
                <button
                  key={pin.id}
                  type="button"
                  data-pin-id={pin.id}
                  data-group={pin.markerGroup}
                  data-kind={pin.kind}
                  className={`map-pin${selectedId === pin.id ? " selected" : ""}${pin.unavailable || pin.targetUnavailable ? " unavailable" : ""}`}
                  style={{ left: `${pin.xNorm * 100}%`, top: `${pin.yNorm * 100}%` }}
                  aria-label={
                    pin.unavailable
                      ? `${pin.title}, ${KIND_LABEL[pin.kind]} (${WORLD.pinUnavailable})`
                      : `${pin.title}, ${KIND_LABEL[pin.kind]}`
                  }
                  aria-pressed={selectedId === pin.id}
                  onPointerDown={(e) => onPinPointerDown(e, pin)}
                  onPointerMove={onPinPointerMove}
                  onPointerUp={onPinPointerUp}
                  onClick={(e) => {
                    e.stopPropagation();
                    selectPin(pin);
                  }}
                >
                  <span className="map-pin-dot" aria-hidden="true" />
                  <span className="map-pin-label">{pin.title}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <section className="panel" aria-labelledby={pinListId}>
          <h2 id={pinListId}>{WORLD.pinList}</h2>
          <p className="small muted">{WORLD.pinsCount(shown.length)}</p>
          <p className="small muted">{WORLD.keyboardMarkerHint}</p>
          <label>
            {WORLD.markerSearch}
            <input
              id={searchId}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" && listed[0]) {
                  event.preventDefault();
                  selectPin(listed[0]);
                  document.getElementById(listboxId)?.focus();
                }
              }}
            />
          </label>
          {listed.length === 0 ? (
            <p className="muted">{needle ? WORLD.noMarkerMatch : WORLD.noPinSelected}</p>
          ) : (
            <ul
              id={listboxId}
              className="map-pin-list"
              role="listbox"
              aria-labelledby={pinListId}
              tabIndex={0}
              aria-activedescendant={selectedId ? `${idPrefix}-marker-${selectedId}` : undefined}
              onKeyDown={onListKey}
            >
              {listed.map((pin) => (
                <li key={pin.id} role="presentation">
                  <button
                    id={`${idPrefix}-marker-${pin.id}`}
                    type="button"
                    role="option"
                    aria-selected={selectedId === pin.id}
                    className={`map-pin-list-item${selectedId === pin.id ? " selected" : ""}`}
                    onClick={() => selectPin(pin)}
                  >
                    <span>{pin.title}</span>
                    <span className="small muted">
                      {pin.kind === "point" ? GROUP_LABEL[pin.markerGroup] : `${KIND_LABEL[pin.kind]} · ${GROUP_LABEL[pin.markerGroup]}`}
                      {pin.typeLabel ? ` · ${pin.typeLabel}` : ""}
                      {pin.unavailable ? ` · ${WORLD.pinUnavailable}` : ""}
                      {pin.targetUnavailable ? ` · ${WORLD.targetMapUnavailable}` : ""}
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
            <MarkerRail
              projectId={projectId}
              mapId={map.id}
              pin={selected}
              records={records}
              otherMaps={otherMaps}
              mode={mode}
              pending={pending}
              inspection={inspection}
              recordHref={recordHref}
              onOpenMap={openDetailedMap}
              onIssues={setIssues}
              onUpdated={(pin) => {
                setPins((list) => list.map((item) => (item.id === pin.id ? pin : item)));
                router.refresh();
              }}
              onRemoved={() => {
                setPins((list) => list.filter((item) => item.id !== selected.id));
                setSelectedId(null);
                setDraft(null);
                router.refresh();
              }}
              onEditShape={() => {
                if (selected.kind !== "route" && selected.kind !== "area") return;
                setTool(selected.kind);
                setDraft(editShape(selected.kind, selected.id, selected.points));
                setMode("edit");
                writeMapMode("edit");
              }}
            />
          )}
        </div>
      </ContextRail>
    </div>
  );
}

function MarkerRail({
  projectId,
  mapId,
  pin,
  records,
  otherMaps,
  mode,
  pending,
  inspection,
  recordHref,
  onOpenMap,
  onIssues,
  onUpdated,
  onRemoved,
  onEditShape,
}: {
  projectId: string;
  mapId: string;
  pin: WorldMapPinView;
  records: PlaceableRecord[];
  otherMaps: PlaceableMap[];
  mode: "browse" | "edit";
  pending: boolean;
  inspection: LoadedInspector | null;
  recordHref: (recordId: string) => string;
  onOpenMap: (mapId: string) => void;
  onIssues: (issues: Issue[]) => void;
  onUpdated: (pin: WorldMapPinView) => void;
  onRemoved: () => void;
  onEditShape: () => void;
}) {
  const [recordId, setRecordId] = useState(pin.recordId ?? "");
  const [targetMapId, setTargetMapId] = useState(pin.targetMapId ?? "");
  const [group, setGroup] = useState<MarkerGroup>(pin.markerGroup);
  const [label, setLabel] = useState(pin.label);
  const [xPercent, setXPercent] = useState(String(Math.round(pin.xNorm * 1000) / 10));
  const [yPercent, setYPercent] = useState(String(Math.round(pin.yNorm * 1000) / 10));
  const [, startTransition] = useTransition();

  useEffect(() => {
    setRecordId(pin.recordId ?? "");
    setTargetMapId(pin.targetMapId ?? "");
    setGroup(pin.markerGroup);
    setLabel(pin.label);
    setXPercent(String(Math.round(pin.xNorm * 1000) / 10));
    setYPercent(String(Math.round(pin.yNorm * 1000) / 10));
  }, [pin.id, pin.recordId, pin.targetMapId, pin.markerGroup, pin.label, pin.xNorm, pin.yNorm, pin.revision]);

  return (
    <div className="stack">
      <div>
        <p className="board-card-kind">{pin.typeLabel || GROUP_LABEL[pin.markerGroup]}</p>
        <p className="board-card-title">{pin.title}</p>
        {pin.authorityStatus ? <StatusBadge status={pin.authorityStatus} /> : null}
        {pin.unavailable ? <p className="small muted">{WORLD.pinUnavailable}</p> : null}
        {pin.targetUnavailable ? <p className="small muted">{WORLD.targetMapUnavailable}</p> : null}
        {pin.kind === "route" || pin.kind === "area" ? (
          <p className="small muted">
            {KIND_LABEL[pin.kind]} · {pin.points.length} points
          </p>
        ) : null}
      </div>
      <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
        {pin.recordId && !pin.unavailable ? (
          <ButtonLink href={recordHref(pin.recordId)} variant="secondary" size="sm">
            {WORLD.openReference}
          </ButtonLink>
        ) : null}
        {pin.targetMapId && !pin.targetUnavailable ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => onOpenMap(pin.targetMapId!)}>
            {WORLD.openDetailedMap}
          </Button>
        ) : null}
      </div>
      {pin.recordId && !pin.unavailable ? (
        inspection?.ok ? (
          <ReferenceInspector projectId={projectId} model={inspection.model} established={inspection.established} linkMode="remote" />
        ) : inspection && !inspection.ok ? (
          <p className="muted">{inspection.message}</p>
        ) : (
          <p className="muted">{WORLD.inspectorLoading}</p>
        )
      ) : null}
      {mode === "edit" ? (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(async () => {
              const result = await updateWorldMapPinAction(projectId, mapId, pin.id, {
                recordId: recordId || null,
                targetMapId: targetMapId || null,
                markerGroup: group,
                label,
                expectedRevision: pin.revision,
              });
              if (!result.ok) {
                onIssues(result.issues);
                return;
              }
              onIssues([]);
              onUpdated(result.pin);
            });
          }}
        >
          <label>
            {WORLD.markerGroup}
            <select value={group} onChange={(e) => setGroup(e.target.value as MarkerGroup)}>
              {MARKER_GROUPS.map((item) => (
                <option key={item} value={item}>
                  {GROUP_LABEL[item]}
                </option>
              ))}
            </select>
          </label>
          <label>
            {WORLD.choosePlace}
            <select value={recordId} onChange={(e) => setRecordId(e.target.value)}>
              <option value="">{WORLD.choosePlace}</option>
              {records.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            {WORLD.chooseDetailedMap}
            <select value={targetMapId} onChange={(e) => setTargetMapId(e.target.value)}>
              <option value="">{WORLD.chooseDetailedMap}</option>
              {otherMaps.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            {WORLD.markerLabel}
            <input value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <Button
            type="submit"
            size="sm"
            disabled={pending || (pin.kind === "point" && !recordId && !targetMapId) || (pin.kind === "label" && !label.trim())}
          >
            {WORLD.saveMarker}
          </Button>
        </form>
      ) : null}
      {mode === "edit" && (pin.kind === "point" || pin.kind === "label") ? (
        <form
          className="row"
          style={{ gap: "0.35rem", flexWrap: "wrap" }}
          onSubmit={(event) => {
            event.preventDefault();
            const x = Number(xPercent);
            const y = Number(yPercent);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return;
            startTransition(async () => {
              const result = await moveWorldMapPinAction(projectId, mapId, pin.id, {
                xNorm: x / 100,
                yNorm: y / 100,
                expectedRevision: pin.revision,
              });
              if (!result.ok) {
                onIssues(result.issues);
                return;
              }
              onIssues([]);
              onUpdated(result.pin);
            });
          }}
        >
          <label>
            {WORLD.drawPointX}
            <input type="number" min={0} max={100} step={0.1} value={xPercent} onChange={(event) => setXPercent(event.target.value)} />
          </label>
          <label>
            {WORLD.drawPointY}
            <input type="number" min={0} max={100} step={0.1} value={yPercent} onChange={(event) => setYPercent(event.target.value)} />
          </label>
          <Button type="submit" size="sm" variant="secondary" disabled={pending}>
            {WORLD.savePosition}
          </Button>
        </form>
      ) : null}
      {mode === "edit" && (pin.kind === "route" || pin.kind === "area") ? (
        <Button type="button" size="sm" variant="secondary" onClick={onEditShape}>
          {WORLD.editShape}
        </Button>
      ) : null}
      <p className="small muted">{WORLD.removePinNote}</p>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await removeWorldMapPinAction(projectId, mapId, pin.id, pin.revision);
            if (!result.ok) {
              onIssues(result.issues);
              return;
            }
            onRemoved();
          })
        }
      >
        {WORLD.removePin}
      </Button>
    </div>
  );
}
