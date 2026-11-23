"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { StatusBadge } from "@/components/Badges";
import { IssueList } from "@/components/IssueList";
import { BoardOverflowMenu } from "@/components/ui/BoardOverflowMenu";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Button, ButtonLink } from "@/components/ui/Button";
import { CanvasToolbar } from "@/components/ui/CanvasToolbar";
import { SegmentedControl, SegmentedOption } from "@/components/ui/SegmentedControl";
import { IconButton } from "@/components/ui/IconButton";
import { CanvasInspectorSection } from "@/components/world/CanvasInspectorSection";
import { CanvasReferenceSummary } from "@/components/world/CanvasReferenceSummary";
import { MapToolbarPopover } from "@/components/world/MapToolbarPopover";
import { Checkbox } from "@/components/ui/Checkbox";
import { LabeledSwitch } from "@/components/ui/LabeledSwitch";
import { LinkSceneForm } from "@/components/world/LinkSceneForm";
import { ContextRail, ContextRailToggle, useContextRail } from "@/components/shell/ContextRail";
import { setUnsaved } from "@/components/shell/unsaved";
import { CloseIcon } from "@/components/shell/icons";
import { errorIssue, type Issue } from "@/domain/issues";
import { isLinkableReferenceType } from "@/domain/recordTypes";
import type { LoadedInspector } from "@/server/services/referenceInspectorService";
import { layerStrokeColor, resolvePinLayerId, type WorldMapLayerView } from "@/world/mapLayers";
import type { WorldMapPinView, WorldMapView } from "@/server/services/worldMapService";
import type { MapGeographyNode } from "@/world/mapGeography";
import { SERIES, WORLD, WRITE } from "@/ui/labels";
import { seriesBookLabel } from "@/world/seriesHome";
import { canvasReturnPath, withCanvasReturn } from "@/world/canvasReturn";
import { mapDrawingHandlesKey, mapListHandlesKey } from "@/world/mapKeyboard";
import {
  editShape,
  replaceShapePoint,
  shapeReady,
  type MarkerKind,
  type ShapeDraft,
} from "@/world/mapGeometry";
import {
  appendDraftPoint,
  cancelDrawing,
  centerPointPan,
  dragExceeded,
  finishDrawing,
  fitMapView,
  gestureForPointer,
  keepDraftAfterFailure,
  layerNotice,
  nextToolAfterPin,
  sessionForTool,
  toolOnEnterEdit,
  type DrawPhase,
  type MapTool,
} from "@/world/mapInteraction";
import {
  annotatedMapSvg,
  distanceFromScale,
  formatScaleValue,
  formatTravelDuration,
  hiddenLayerIdsForPreset,
  normalizedLength,
  presetTravelSpeed,
  scaleUsesImperialUnits,
  travelHoursFromDistance,
  type ScaleReading,
  type TravelSpeedPreset,
} from "@/world/mapScale";
import type { MapPinFilterContext } from "@/server/services/mapPinFilterService";
import { pinMatchesMapFilter } from "@/world/mapPinFilter";
import {
  clampMapZoom,
  pushMapTrail,
  readHiddenLayers,
  readMapMode,
  readMapSearch,
  readMapTrail,
  readMapView,
  trailWithoutCurrent,
  writeHiddenLayers,
  writeMapMode,
  writeMapSearch,
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
  saveWorldMapLayersAction,
  setWorldMapPinGeometryAction,
  updateWorldMapPinAction,
  loadMapPinFilterContextAction,
  updateWorldMapScaleAction,
} from "./actions";
import { MapGeographyPanel } from "./MapGeographyPanel";
import { MapShapeEditor } from "./MapShapeEditor";
import { MarkerScenes } from "./MarkerScenes";
import { PlaceEvents } from "./PlaceEvents";

export interface PlaceableRecord {
  id: string;
  title: string;
  typeLabel: string;
  homeLabel?: string | null;
  worldScope?: string | null;
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

function effectiveLayerId(pin: WorldMapPinView, layers: readonly WorldMapLayerView[]): string | null {
  return resolvePinLayerId(pin, layers);
}

function pinLayerTitle(pin: WorldMapPinView, layers: readonly WorldMapLayerView[]): string {
  const id = effectiveLayerId(pin, layers);
  const layer = id ? layers.find((item) => item.id === id) : undefined;
  return layer?.title ?? GROUP_LABEL[pin.markerGroup];
}

function pinLayerIndex(pin: WorldMapPinView, layers: readonly WorldMapLayerView[]): number {
  const id = effectiveLayerId(pin, layers);
  const index = id ? layers.findIndex((item) => item.id === id) : -1;
  return index >= 0 ? index : 0;
}

export function MapCanvas({
  projectId,
  map: initial,
  records,
  otherMaps,
  geography,
  initialPinId = null,
}: {
  projectId: string;
  map: WorldMapView;
  records: PlaceableRecord[];
  otherMaps: PlaceableMap[];
  geography: readonly MapGeographyNode[];
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
  const [status, setStatus] = useState("");
  const [sceneRefresh, setSceneRefresh] = useState(0);
  const [missingSelection, setMissingSelection] = useState("");
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(initial.title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [mode, setMode] = useState<"browse" | "edit">("browse");
  const [view, setView] = useState<MapViewState>({ zoom: 1, x: 0, y: 0 });
  const [trail, setTrail] = useState<MapTrailItem[]>([]);
  const [hiddenLayerIds, setHiddenLayerIds] = useState<string[]>([]);
  const [measuring, setMeasuring] = useState(false);
  const [measurePoints, setMeasurePoints] = useState<{ x: number; y: number }[]>([]);
  const [query, setQuery] = useState("");
  const [pendingPlaceId, setPendingPlaceId] = useState("");
  const [pendingMapId, setPendingMapId] = useState("");
  const [pendingLayerId, setPendingLayerId] = useState(initial.layers[0]?.id ?? "");
  const [scaleLabel, setScaleLabel] = useState(initial.scaleLabel);
  const [scaleBarPercent, setScaleBarPercent] = useState(
    initial.scaleBarLength != null ? String(Math.round(initial.scaleBarLength * 1000) / 10) : "",
  );
  const [layerTitles, setLayerTitles] = useState(initial.layers.map((layer) => layer.title));
  const [pendingLabel, setPendingLabel] = useState("");
  const [tool, setTool] = useState<MapTool>("select");
  const [draft, setDraft] = useState<ShapeDraft | null>(null);
  const [drawPhase, setDrawPhase] = useState<DrawPhase>("drawing");
  const [keepPlacing, setKeepPlacing] = useState(false);
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null);
  const [pinFilter, setPinFilter] = useState({ era: "all", draft: "all", book: "all" });
  const [pinFilterContext, setPinFilterContext] = useState<MapPinFilterContext | null>(null);
  const [travelPreset, setTravelPreset] = useState<TravelSpeedPreset>("walk");
  const [travelCustomSpeed, setTravelCustomSpeed] = useState("");
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
    exceeded: boolean;
  } | null>(null);
  const vertexRef = useRef<{
    index: number;
    origin: { x: number; y: number };
    startX: number;
    startY: number;
    exceeded: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const drawStart = useRef<{ x: number; y: number } | null>(null);
  const panRef = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const draftActions = useRef({ cancel: () => {}, save: () => {} });

  useEffect(() => {
    setMap(initial);
    setPins(initial.pins);
    setTitle(initial.title);
    setScaleLabel(initial.scaleLabel);
    setScaleBarPercent(initial.scaleBarLength != null ? String(Math.round(initial.scaleBarLength * 1000) / 10) : "");
    setLayerTitles(initial.layers.map((layer) => layer.title));
    if (initial.layers[0]) setPendingLayerId((current) => current || initial.layers[0]!.id);
  }, [initial]);

  useEffect(() => {
    skipSave.current = true;
    setView(readMapView(initial.id));
    setMode(readMapMode());
    setTool(toolOnEnterEdit());
    setDraft(null);
    setDrawPhase("drawing");
    setKeepPlacing(false);
    setHiddenLayerIds(readHiddenLayers(initial.id));
    setQuery(readMapSearch(initial.id));
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
  const pinFilterActive = pinFilter.era !== "all" || pinFilter.draft !== "all" || pinFilter.book !== "all";
  const pinPassesFilter = (pin: WorldMapPinView) =>
    pinMatchesMapFilter(pin.recordId, pinFilter, pin.recordId ? pinFilterContext?.byRecordId[pin.recordId] : undefined);
  const pinFilterClass = (pin: WorldMapPinView) =>
    pinFilterActive ? (pinPassesFilter(pin) ? " filter-match" : " filter-dimmed") : "";
  const shown = pins.filter((pin) => {
    const layerId = effectiveLayerId(pin, map.layers);
    return !layerId || !hiddenLayerIds.includes(layerId);
  });
  const needle = query.trim().toLowerCase();
  const listed = shown.filter((pin) => {
    if (!needle) return true;
    return `${pin.title} ${pin.typeLabel} ${pinLayerTitle(pin, map.layers)}`.toLowerCase().includes(needle);
  });
  const markerNotice = layerNotice({
    total: pins.length,
    visible: shown.length,
    listed: listed.length,
    searching: needle.length > 0,
  });
  const previewPoints =
    !draft ? [] : drawPhase === "drawing" && hoverPoint ? [...draft.points, hoverPoint] : draft.points;

  useEffect(() => {
    const key = `map-geometry-${map.id}`;
    setUnsaved(key, draft !== null);
    return () => setUnsaved(key, false);
  }, [map.id, draft]);

  useEffect(() => {
    if (!initialPinId) {
      setMissingSelection("");
      return;
    }
    if (!initial.pins.some((pin) => pin.id === initialPinId)) {
      setMissingSelection(WORLD.markerMissing);
      return;
    }
    setMissingSelection("");
    if (!didDeepLink.current) {
      didDeepLink.current = true;
      setSelectedId(initialPinId);
      if (!railRef.current.visible) railRef.current.toggle();
    }
  }, [initialPinId, initial.pins]);

  useEffect(() => {
    const recordIds = pins.flatMap((pin) => (pin.recordId && !pin.unavailable ? [pin.recordId] : []));
    let cancelled = false;
    void loadMapPinFilterContextAction(projectId, recordIds).then((result) => {
      if (cancelled || !result.ok) return;
      setPinFilterContext(result.context);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, pins]);

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
    if (next === "edit" && mode === "edit") return;
    setDraft(null);
    setDrawPhase("drawing");
    setHoverPoint(null);
    if (next === "edit") setTool(toolOnEnterEdit());
  };

  const chooseTool = (next: MapTool) => {
    setTool(next);
    setHoverPoint(null);
    const session = sessionForTool(next);
    setDraft(session?.draft ?? null);
    setDrawPhase(session?.phase ?? "drawing");
  };

  const cancelDraft = () => {
    if (draft) {
      const result = cancelDrawing(draft);
      if (result.wrote) return;
    }
    setDraft(null);
    setDrawPhase("drawing");
    setHoverPoint(null);
    setTool(toolOnEnterEdit());
  };

  const finishActiveDrawing = () => {
    if (!draft || drawPhase !== "drawing") return;
    const result = finishDrawing(draft);
    if (!result.ok) {
      setIssues([errorIssue("INVALID_REFERENCE", result.message)]);
      return;
    }
    setIssues([]);
    setDrawPhase("review");
    setHoverPoint(null);
  };

  const toggleLayer = (layerId: string) => {
    setHiddenLayerIds((current) => {
      const next = current.includes(layerId) ? current.filter((item) => item !== layerId) : [...current, layerId];
      writeHiddenLayers(map.id, next);
      return next;
    });
  };

  const applyLayerPreset = (preset: "all" | "none" | { group: string }) => {
    const next = hiddenLayerIdsForPreset(map.layers, preset);
    setHiddenLayerIds(next);
    writeHiddenLayers(map.id, next);
  };

  const measureReading =
    measurePoints.length === 2
      ? distanceFromScale(
          normalizedLength(measurePoints, { width: map.imageWidth, height: map.imageHeight }),
          map.scaleBarLength,
          map.scaleLabel,
        )
      : null;
  const routeReading =
    selected && selected.kind === "route" && selected.points.length >= 2
      ? distanceFromScale(
          normalizedLength(selected.points, { width: map.imageWidth, height: map.imageHeight }),
          map.scaleBarLength,
          map.scaleLabel,
        )
      : null;

  const exportAnnotatedSvg = () => {
    const svg = annotatedMapSvg({
      title: map.title,
      pins: shown.map((pin) => ({ title: pin.title, kind: pin.kind, x: pin.xNorm, y: pin.yNorm, points: pin.points })),
      scaleLabel: map.scaleLabel,
      scaleBarLength: map.scaleBarLength,
    });
    downloadText(`${map.title}.svg`, svg, "image/svg+xml");
  };

  const exportAnnotatedPng = () => {
    const image = imageRef.current;
    if (!image) return;
    const canvas = document.createElement("canvas");
    canvas.width = map.imageWidth || image.naturalWidth || 1000;
    canvas.height = map.imageHeight || image.naturalHeight || 1000;
    const context = canvas.getContext("2d");
    if (!context) return;
    try {
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      context.strokeStyle = "#1c1917";
      context.fillStyle = "#1c1917";
      context.lineWidth = Math.max(2, canvas.width / 400);
      for (const pin of shown) {
        if ((pin.kind === "route" || pin.kind === "area") && pin.points.length >= 2) {
          context.beginPath();
          pin.points.forEach((point, index) => {
            const x = point.x * canvas.width;
            const y = point.y * canvas.height;
            if (index === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
          });
          if (pin.kind === "area") context.closePath();
          context.stroke();
        } else {
          context.beginPath();
          context.arc(pin.xNorm * canvas.width, pin.yNorm * canvas.height, Math.max(4, canvas.width / 150), 0, Math.PI * 2);
          context.fill();
          context.font = `${Math.max(12, Math.round(canvas.width / 50))}px sans-serif`;
          context.fillText(pin.title, pin.xNorm * canvas.width + 8, pin.yNorm * canvas.height);
        }
      }
      if (map.scaleLabel && map.scaleBarLength != null) {
        const y = canvas.height - 24;
        context.beginPath();
        context.moveTo(16, y);
        context.lineTo(16 + map.scaleBarLength * canvas.width, y);
        context.stroke();
        context.font = `${Math.max(12, Math.round(canvas.width / 60))}px sans-serif`;
        context.fillText(`${map.scaleLabel} · ${WORLD.mapMeasureDerived}`, 16, y - 8);
      }
      canvas.toBlob((blob) => {
        if (!blob) {
          setIssues([errorIssue("INVALID_REFERENCE", WORLD.mapExportPngFailed)]);
          return;
        }
        downloadBlob(`${map.title}.png`, blob);
      });
    } catch {
      setIssues([errorIssue("INVALID_REFERENCE", WORLD.mapExportPngFailed)]);
    }
  };

  const jumpToPin = (pinId: string) => {
    const pin = pins.find((item) => item.id === pinId);
    if (pin) selectPin(pin);
  };

  const normFromClient = (clientX: number, clientY: number) => {
    const el = imageRef.current;
    if (!el) return { xNorm: 0.5, yNorm: 0.5 };
    const rect = el.getBoundingClientRect();
    const xNorm = rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0.5;
    const yNorm = rect.height > 0 ? Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)) : 0.5;
    return { xNorm, yNorm };
  };

  const cancelMarkerDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setPins((list) => list.map((pin) => (pin.id === drag.pinId ? { ...pin, xNorm: drag.originX, yNorm: drag.originY } : pin)));
  };

  const cancelVertexDrag = () => {
    const vertex = vertexRef.current;
    vertexRef.current = null;
    if (!vertex) return;
    setDraft((current) => (current ? replaceShapePoint(current, vertex.index, vertex.origin) : current));
  };

  const onPinPointerDown = (e: ReactPointerEvent, pin: WorldMapPinView) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    selectPin(pin);
    const gesture = gestureForPointer({ mode, tool, phase: draft ? drawPhase : null, onMarker: true, exceeded: false });
    if (gesture !== "select" || mode !== "edit" || tool !== "select") return;
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
      exceeded: false,
    };
  };

  const onPinPointerMove = (e: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag || mode !== "edit" || tool !== "select" || drag.pinId !== e.currentTarget.getAttribute("data-pin-id")) return;
    if (!dragExceeded(e.clientX - drag.startX, e.clientY - drag.startY)) return;
    drag.exceeded = true;
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
    if (!drag.exceeded) return;
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
      setStatus(WORLD.mapSaved);
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
        layerId: pendingLayerId || null,
        label: pendingLabel,
        xNorm,
        yNorm,
      });
      if (!result.ok) {
        setIssues(result.issues);
        return;
      }
      setIssues([]);
      setStatus(WORLD.mapSaved);
      setPins((list) => [...list, result.pin]);
      selectPin(result.pin);
      setTool(nextToolAfterPin(keepPlacing));
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
          setDraft((current) => (current ? keepDraftAfterFailure(current) : current));
          if (result.issues.some((issue) => issue.code === "STALE_REVISION")) router.refresh();
          return;
        }
        setIssues([]);
        setStatus(WORLD.geometrySaved);
        setDraft(null);
        setDrawPhase("drawing");
        setTool(toolOnEnterEdit());
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
        layerId: pendingLayerId || null,
        label: pendingLabel,
      });
      if (!result.ok) {
        setIssues(result.issues);
        setDraft((current) => (current ? keepDraftAfterFailure(current) : current));
        return;
      }
      setIssues([]);
      setStatus(WORLD.geometrySaved);
      setDraft(null);
      setDrawPhase("drawing");
      setTool(toolOnEnterEdit());
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

  draftActions.current.cancel = cancelDraft;
  draftActions.current.save = finishActiveDrawing;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!mapDrawingHandlesKey(event.target)) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("button, [role='listbox']")) return;
      if (event.key === "Escape") {
        if (dragRef.current) {
          event.preventDefault();
          cancelMarkerDrag();
          return;
        }
        if (vertexRef.current) {
          event.preventDefault();
          cancelVertexDrag();
          return;
        }
        if (draft) {
          event.preventDefault();
          draftActions.current.cancel();
        }
      } else if (event.key === "Enter" && draft && drawPhase === "drawing") {
        event.preventDefault();
        draftActions.current.save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft, drawPhase]);

  const drawingGesture = gestureForPointer({
    mode,
    tool,
    phase: draft ? drawPhase : null,
    onMarker: false,
    exceeded: false,
  });

  const onSurfacePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-pin-id], [data-vertex]")) return;
    if (measuring) return;
    suppressClick.current = false;
    if (drawingGesture === "draw") {
      drawStart.current = { x: e.clientX, y: e.clientY };
      return;
    }
    const canPan = mode === "browse" || tool === "select" || drawPhase === "review";
    if (!canPan) return;
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
    if (drawStart.current && dragExceeded(e.clientX - drawStart.current.x, e.clientY - drawStart.current.y)) {
      suppressClick.current = true;
    }
    if (drawingGesture === "draw") {
      const point = normFromClient(e.clientX, e.clientY);
      setHoverPoint({ x: point.xNorm, y: point.yNorm });
    }
    const pan = panRef.current;
    if (!pan) return;
    if (dragExceeded(e.clientX - pan.startX, e.clientY - pan.startY)) {
      pan.moved = true;
      suppressClick.current = true;
    }
    const x = pan.originX + (e.clientX - pan.startX);
    const y = pan.originY + (e.clientY - pan.startY);
    setView((current) => ({ ...current, x, y }));
  };

  const onSurfacePointerUp = () => {
    panRef.current = null;
    drawStart.current = null;
  };

  const onVertexPointerDown = (event: ReactPointerEvent, index: number) => {
    if (event.button !== 0 || !draft) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = draft.points[index];
    if (!point) return;
    vertexRef.current = { index, origin: { x: point.x, y: point.y }, startX: event.clientX, startY: event.clientY, exceeded: false };
  };

  const onVertexPointerMove = (event: ReactPointerEvent) => {
    const vertex = vertexRef.current;
    if (!vertex) return;
    if (!vertex.exceeded && !dragExceeded(event.clientX - vertex.startX, event.clientY - vertex.startY)) return;
    vertex.exceeded = true;
    const point = normFromClient(event.clientX, event.clientY);
    setDraft((current) => (current ? replaceShapePoint(current, vertex.index, { x: point.xNorm, y: point.yNorm }) : current));
  };

  const onVertexPointerUp = () => {
    vertexRef.current = null;
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
    if (!mapListHandlesKey(event.target, event.currentTarget)) return;
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

  const returnPath = canvasReturnPath(projectId, "maps", map.id, selected?.id ?? null);
  const inspectorTitle = draft
    ? draft.kind === "route"
      ? WORLD.mapNewRoute
      : draft.kind === "area"
        ? WORLD.mapNewArea
        : WORLD.mapNewLabel
    : selected
      ? selected.title
      : WORLD.mapRail;

  return (
    <div className="write-layout reference-write-layout board-layout visual-canvas">
      <div className="write-main board-main">
        {trail.length > 0 ? (
          <Breadcrumbs
            className="map-trail"
            label={WORLD.mapBreadcrumb}
            items={[
              ...trail.map((item, index) => ({
                label: item.title,
                onSelect: () => returnToTrail(index),
              })),
              { label: map.title, current: true },
            ]}
          />
        ) : null}

        <CanvasToolbar label={WORLD.mapCanvas} className="map-toolbar visual-canvas-toolbar">
          <SegmentedControl size="sm" label={`${WORLD.mapModeBrowse} / ${WORLD.mapModeEdit}`}>
            <SegmentedOption selected={mode === "browse"} onClick={() => changeMode("browse")}>
              {WORLD.mapModeBrowse}
            </SegmentedOption>
            <SegmentedOption selected={mode === "edit"} onClick={() => changeMode("edit")}>
              {WORLD.mapModeEdit}
            </SegmentedOption>
          </SegmentedControl>
          {mode === "edit" ? (
            <SegmentedControl size="sm" label={WORLD.markerTools}>
              {(["select", "point", "route", "area", "label"] as const).map((kind) => (
                <SegmentedOption key={kind} selected={tool === kind} onClick={() => chooseTool(kind)}>
                  {kind === "select" ? WORLD.mapToolSelect : kind === "point" ? WORLD.mapToolPin : KIND_LABEL[kind]}
                </SegmentedOption>
              ))}
            </SegmentedControl>
          ) : null}
          <MapToolbarPopover label={WORLD.mapPinFilter} className="map-pin-filter-popover" align="start">
            <p className="small muted">{WORLD.mapPinFilterHint}</p>
            <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
              <label className="world-toolbar-field">
                {WORLD.mapPinFilterEra}
                <select value={pinFilter.era} onChange={(event) => setPinFilter((f) => ({ ...f, era: event.target.value }))}>
                  <option value="all">{WORLD.mapPinFilterAllEras}</option>
                  {(pinFilterContext?.choices.eras ?? []).map((era) => (
                    <option key={era.id} value={era.id}>
                      {era.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="world-toolbar-field">
                {WORLD.sceneDraftFilter}
                <select value={pinFilter.draft} onChange={(event) => setPinFilter((f) => ({ ...f, draft: event.target.value }))}>
                  <option value="all">{WORLD.allDrafts}</option>
                  <option value="unscoped">{WORLD.unscopedDraft}</option>
                  {(pinFilterContext?.choices.drafts ?? []).map((draft) => (
                    <option key={draft.id} value={draft.id}>
                      {draft.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="world-toolbar-field">
                {WORLD.sceneBookFilter}
                <select value={pinFilter.book} onChange={(event) => setPinFilter((f) => ({ ...f, book: event.target.value }))}>
                  <option value="all">{WORLD.allBooks}</option>
                  <option value="ungrouped">{WORLD.ungroupedBook}</option>
                  {(pinFilterContext?.choices.books ?? []).map((book) => (
                    <option key={book.id} value={book.id}>
                      {book.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </MapToolbarPopover>
          <MapToolbarPopover label={WORLD.mapLayers} className="map-layers-popover" align="start">
            <fieldset className="map-legend">
              <legend className="sr-only">{WORLD.mapLayerLegend}</legend>
              <div className="map-layer-presets">
                <Button type="button" size="sm" variant="secondary" onClick={() => applyLayerPreset("all")}>
                  {WORLD.mapLayersShowAll}
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => applyLayerPreset("none")}>
                  {WORLD.mapLayersHideAll}
                </Button>
                {map.layers
                  .filter((layer, index, all) => layer.legacyGroup && all.findIndex((item) => item.legacyGroup === layer.legacyGroup) === index)
                  .map((layer) => (
                    <Button
                      key={layer.legacyGroup}
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => applyLayerPreset({ group: layer.legacyGroup! })}
                    >
                      {WORLD.mapLayerPreset(layer.title)}
                    </Button>
                  ))}
              </div>
              {map.layers.map((layer, index) => {
                const count = pins.filter((pin) => effectiveLayerId(pin, map.layers) === layer.id).length;
                return (
                <div key={layer.id} className={`map-layer-row${hiddenLayerIds.includes(layer.id) ? " is-hidden" : ""}`}>
                  <span
                    className="map-legend-swatch"
                    style={{ background: layerStrokeColor(index), borderColor: "var(--color-surface)" }}
                    aria-hidden="true"
                  />
                  <span className="map-layer-name">{layer.title}</span>
                  <span className="map-layer-count">{count}</span>
                  <LabeledSwitch
                    className="map-layer-visibility-switch"
                    label={layer.title}
                    checked={!hiddenLayerIds.includes(layer.id)}
                    onCheckedChange={() => toggleLayer(layer.id)}
                  />
                </div>
                );
              })}
            </fieldset>
            {mode === "edit" ? (
              <form
                className="stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  startTransition(async () => {
                    const result = await saveWorldMapLayersAction(
                      projectId,
                      map.id,
                      layerTitles.map((layerTitle) => ({ title: layerTitle })),
                    );
                    if (!result.ok) setIssues(result.issues);
                    else {
                      setIssues([]);
                      setMap(result.map);
                      setPins(result.map.pins);
                      setLayerTitles(result.map.layers.map((layer) => layer.title));
                      if (result.map.layers[0]) setPendingLayerId(result.map.layers[0].id);
                      router.refresh();
                    }
                  });
                }}
              >
                <h3>{WORLD.mapLayers}</h3>
                {layerTitles.map((layerTitle, index) => (
                  <div key={index} className="row" style={{ gap: "0.35rem", flexWrap: "wrap" }}>
                    <label className="grow">
                      <span className="sr-only">
                        {WORLD.mapLayer} {index + 1}
                      </span>
                      <input
                        value={layerTitle}
                        maxLength={80}
                        onChange={(e) =>
                          setLayerTitles((current) => current.map((row, rowIndex) => (rowIndex === index ? e.target.value : row)))
                        }
                      />
                    </label>
                    {layerTitles.length > 1 ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => setLayerTitles((current) => current.filter((_, rowIndex) => rowIndex !== index))}
                      >
                        {WORLD.removeMapLayer}
                      </Button>
                    ) : null}
                  </div>
                ))}
                {layerTitles.length < 16 ? (
                  <Button type="button" size="sm" variant="secondary" onClick={() => setLayerTitles((current) => [...current, ""])}>
                    {WORLD.addMapLayer}
                  </Button>
                ) : null}
                <Button type="submit" size="sm" disabled={pending}>
                  {WORLD.saveMapLayers}
                </Button>
              </form>
            ) : null}
          </MapToolbarPopover>
          <MapToolbarPopover
            className="map-markers-popover"
            align="end"
            label={shown.length === pins.length ? `${WORLD.pinList} (${pins.length})` : `${WORLD.pinList} (${shown.length}/${pins.length})`}
          >
            <div className="visual-menu-scroll">
              <h2 id={pinListId} className="sr-only">{WORLD.pinList}</h2>
              <p className="small muted">{WORLD.mapMarkerCount(shown.length, pins.length)}</p>
              <label>
                {WORLD.markerSearch}
                <input
                  id={searchId}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    writeMapSearch(map.id, e.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown" && listed[0]) {
                      event.preventDefault();
                      selectPin(listed[0]);
                      document.getElementById(listboxId)?.focus();
                    }
                  }}
                />
              </label>
              {markerNotice.kind === "empty" ? (
                <p className="muted">{WORLD.mapNoMarkers}</p>
              ) : markerNotice.kind === "hidden" ? (
                <p className="muted">{WORLD.mapAllHidden}</p>
              ) : markerNotice.kind === "no-match" ? (
                <p className="muted">{WORLD.noMarkerMatch}</p>
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
                        className={`map-pin-list-item${selectedId === pin.id ? " selected" : ""}${pinFilterClass(pin)}`}
                        onClick={() => selectPin(pin)}
                      >
                        <span>{pin.title}</span>
                        <span className="small muted">
                          {pin.kind === "point"
                            ? pinLayerTitle(pin, map.layers)
                            : `${KIND_LABEL[pin.kind]} · ${pinLayerTitle(pin, map.layers)}`}
                          {pin.typeLabel ? ` · ${pin.typeLabel}` : ""}
                          {pin.unavailable ? ` · ${WORLD.pinUnavailable}` : ""}
                          {pin.targetUnavailable ? ` · ${WORLD.targetMapUnavailable}` : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <MapGeographyPanel projectId={projectId} mapId={map.id} geography={geography} onJumpToPin={jumpToPin} />
            </div>
          </MapToolbarPopover>
          <BoardOverflowMenu>
              <div className="row" style={{ gap: "0.35rem", flexWrap: "wrap" }}>
                <Button
                  type="button"
                  size="sm"
                  variant={measuring ? "primary" : "secondary"}
                  aria-pressed={measuring}
                  onClick={() => {
                    setMeasuring((current) => !current);
                    setMeasurePoints([]);
                  }}
                >
                  {WORLD.mapMeasure}
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={exportAnnotatedSvg}>
                  {WORLD.mapExportSvg}
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={exportAnnotatedPng}>
                  {WORLD.mapExportPng}
                </Button>
              </div>
              <form
                className="stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  const parsed = scaleBarPercent.trim() === "" ? null : Number(scaleBarPercent) / 100;
                  startTransition(async () => {
                    const result = await updateWorldMapScaleAction(projectId, map.id, {
                      scaleLabel: scaleLabel.trim(),
                      scaleBarLength: parsed != null && Number.isFinite(parsed) ? parsed : null,
                    });
                    if (!result.ok) setIssues(result.issues);
                    else {
                      setIssues([]);
                      setMap(result.map);
                      router.refresh();
                    }
                  });
                }}
              >
                <p className="small muted">{WORLD.geometryNote}</p>
                <label>
                  {WORLD.mapScaleLabel}
                  <input value={scaleLabel} maxLength={120} onChange={(e) => setScaleLabel(e.target.value)} />
                </label>
                <label>
                  {WORLD.mapScaleBarLength}
                  <input
                    type="number"
                    min={2}
                    max={100}
                    step={0.1}
                    value={scaleBarPercent}
                    onChange={(e) => setScaleBarPercent(e.target.value)}
                  />
                </label>
                <Button type="submit" disabled={pending} variant="secondary" size="sm">
                  {WORLD.saveMapScale}
                </Button>
              </form>
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
          <div className="map-zoom">
            <Button type="button" size="sm" variant="secondary" aria-label={WORLD.mapZoomOut} onClick={() => setView((current) => ({ ...current, zoom: clampMapZoom(current.zoom / 1.25) }))}>
              −
            </Button>
            <span className="map-zoom-readout" aria-live="polite">
              {Math.round(view.zoom * 100)}%
            </span>
            <Button type="button" size="sm" variant="secondary" aria-label={WORLD.mapZoomIn} onClick={() => setView((current) => ({ ...current, zoom: clampMapZoom(current.zoom * 1.25) }))}>
              +
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setView(fitMapView())}>
              {WORLD.mapFit}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!selected}
              onClick={() => {
                const image = imageRef.current;
                const viewport = viewportRef.current;
                if (!selected || !image || !viewport) return;
                const imageRect = image.getBoundingClientRect();
                const viewRect = viewport.getBoundingClientRect();
                const pointX = imageRect.left + selected.xNorm * imageRect.width;
                const pointY = imageRect.top + selected.yNorm * imageRect.height;
                setView((current) =>
                  centerPointPan(
                    current,
                    viewRect.left + viewRect.width / 2 - pointX,
                    viewRect.top + viewRect.height / 2 - pointY,
                  ),
                );
              }}
            >
              {WORLD.mapCenterSelection}
            </Button>
          </div>
          <ContextRailToggle rail={rail} controls={railId} />
        </CanvasToolbar>
        <IssueList issues={issues} />
        {status ? <p className="small" role="status">{status}</p> : null}
        {missingSelection ? <p className="small" role="status">{missingSelection}</p> : null}
        {measuring ? <p className="small muted map-measure-readout">{WORLD.mapMeasureHint}</p> : null}
        {measurePoints.length === 2 ? (
          <div className="map-measure-readout stack" style={{ gap: "0.25rem" }}>
            <p className="small" style={{ margin: 0 }}>
              {measureReading
                ? `${formatScaleValue(measureReading.value)} ${measureReading.unit}`.trim()
                : WORLD.mapMeasureNeedScale}
              {measureReading ? ` · ${WORLD.mapMeasureDerived}` : ""}
            </p>
            {measureReading ? (
              <MapTravelEstimator
                reading={measureReading}
                preset={travelPreset}
                onPreset={setTravelPreset}
                customSpeed={travelCustomSpeed}
                onCustomSpeed={setTravelCustomSpeed}
              />
            ) : null}
          </div>
        ) : null}
        {routeReading ? (
          <div className="map-measure-readout stack" style={{ gap: "0.25rem" }}>
            <p className="small" style={{ margin: 0 }}>
              {WORLD.mapRouteLength}: {formatScaleValue(routeReading.value)} {routeReading.unit} · {WORLD.mapMeasureDerived}
            </p>
            <MapTravelEstimator
              reading={routeReading}
              preset={travelPreset}
              onPreset={setTravelPreset}
              customSpeed={travelCustomSpeed}
              onCustomSpeed={setTravelCustomSpeed}
            />
          </div>
        ) : null}
        {draft ? (
          <div className="map-draw-bar">
            <p className="small" role="status">
              {draft.kind === "route" ? WORLD.drawRouteHint : draft.kind === "area" ? WORLD.drawAreaHint : WORLD.drawLabelHint}
            </p>
            {drawPhase === "drawing" ? (
              <Button type="button" size="sm" disabled={!shapeReady(draft)} onClick={finishActiveDrawing}>
                {WORLD.mapFinishDrawing}
              </Button>
            ) : null}
            <Button type="button" size="sm" variant="secondary" onClick={cancelDraft}>
              {WORLD.drawCancel}
            </Button>
          </div>
        ) : null}

        <div
          ref={viewportRef}
          className={`map-viewport map-mode-${mode} map-tool-${tool}`}
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
                if (measuring) {
                  const { xNorm, yNorm } = normFromClient(e.clientX, e.clientY);
                  const point = { x: xNorm, y: yNorm };
                  setMeasurePoints((current) => (current.length >= 2 ? [point] : [...current, point]));
                  return;
                }
                if (mode !== "edit") return;
                if ((e.target as HTMLElement).closest("[data-pin-id], [data-vertex], .map-shape")) return;
                if (suppressClick.current) {
                  suppressClick.current = false;
                  return;
                }
                const gesture = gestureForPointer({
                  mode,
                  tool,
                  phase: draft ? drawPhase : null,
                  onMarker: false,
                  exceeded: false,
                });
                if (gesture !== "draw") return;
                const { xNorm, yNorm } = normFromClient(e.clientX, e.clientY);
                if (tool === "point") {
                  placePin(xNorm, yNorm);
                  return;
                }
                if (tool !== "route" && tool !== "area" && tool !== "label") return;
                const base = draft && draft.kind === tool ? draft : sessionForTool(tool)!.draft;
                const next = appendDraftPoint(base, draft ? drawPhase : "drawing", { x: xNorm, y: yNorm });
                setDraft(next.draft);
                setDrawPhase(next.phase);
                setHoverPoint(null);
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
                      style={{ stroke: layerStrokeColor(pinLayerIndex(pin, map.layers)) }}
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
                      style={{ stroke: layerStrokeColor(pinLayerIndex(pin, map.layers)) }}
                      onClick={(event) => {
                        event.stopPropagation();
                        selectPin(pin);
                      }}
                    />
                  ))}
                {draft && previewPoints.length >= 2 ? (
                  draft.kind === "area" && previewPoints.length >= 3 ? (
                    <polygon
                      className="map-shape map-shape-area draft"
                      points={previewPoints.map((point) => `${point.x * 100},${point.y * 100}`).join(" ")}
                    />
                  ) : (
                    <polyline
                      className="map-shape draft"
                      points={previewPoints.map((point) => `${point.x * 100},${point.y * 100}`).join(" ")}
                    />
                  )
                ) : null}
                {measurePoints.length === 2 ? (
                  <polyline
                    className="map-shape map-measure"
                    points={measurePoints.map((point) => `${point.x * 100},${point.y * 100}`).join(" ")}
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
                  className={`map-pin${selectedId === pin.id ? " selected" : ""}${pin.unavailable || pin.targetUnavailable ? " unavailable" : ""}${pinFilterClass(pin)}`}
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
                  onPointerCancel={cancelMarkerDrag}
                  onClick={(e) => {
                    e.stopPropagation();
                    selectPin(pin);
                  }}
                >
                  <span className="map-pin-dot" aria-hidden="true" />
                  <span className="map-pin-label">{pin.title}</span>
                </button>
              ))}
              {draft
                ? draft.points.map((point, index) => (
                    <button
                      key={`${draft.kind}-${index}`}
                      type="button"
                      className="map-vertex"
                      data-vertex={index}
                      style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
                      aria-label={`${WORLD.drawPointX} ${index + 1}, ${WORLD.drawPointY} ${index + 1}`}
                      onPointerDown={(event) => onVertexPointerDown(event, index)}
                      onPointerMove={onVertexPointerMove}
                      onPointerUp={onVertexPointerUp}
                      onPointerCancel={cancelVertexDrag}
                      onClick={(event) => event.stopPropagation()}
                    />
                  ))
                : null}
              {map.scaleLabel && map.scaleBarLength ? (
                <div className="map-scale" aria-label={WORLD.mapScale}>
                  <div className="map-scale-bar" style={{ width: `${map.scaleBarLength * 100}%` }}>
                    <span>{map.scaleLabel}</span>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <footer className="visual-canvas-footer map-status">
          <p className="visual-canvas-footer-status">
            {mode === "browse"
              ? WORLD.mapModeBrowseHint
              : tool === "select"
                ? WORLD.mapSelectHint
                : tool === "point"
                  ? WORLD.mapPinHint
                  : WORLD.mapModeEditHint}
            {" · "}
            {markerNotice.kind === "empty" ? WORLD.mapNoMarkers : markerNotice.kind === "hidden" ? WORLD.mapAllHidden : WORLD.mapMarkerCount(shown.length, pins.length)}
          </p>
          {shown.length < pins.length ? (
            <span className="map-status-hidden">
              <Button type="button" size="sm" variant="secondary" onClick={() => applyLayerPreset("all")}>
                {WORLD.mapLayersShowAll}
              </Button>
            </span>
          ) : null}
        </footer>

      </div>

      <ContextRail id={railId} labelledBy={titleId} rail={rail} className="visual-inspector" focusOnOverlayOpen>
        <div className="context-head">
          <h2 className="context-title" id={titleId}>
            {inspectorTitle}
          </h2>
          {!rail.wide ? (
            <IconButton tip="none" aria-label={WRITE.hideContext} onClick={rail.close}>
              <CloseIcon />
            </IconButton>
          ) : null}
        </div>
        <div className="context-body">
          {draft ? (
            <div className="stack">
              {!draft.pinId ? (
                <>
                  <label>
                    {WORLD.markerLabel}
                    <input value={pendingLabel} maxLength={120} onChange={(e) => setPendingLabel(e.target.value)} />
                  </label>
                  <label>
                    {WORLD.mapLayer}
                    <select value={pendingLayerId} onChange={(e) => setPendingLayerId(e.target.value)}>
                      {map.layers.map((layer) => (
                        <option key={layer.id} value={layer.id}>
                          {layer.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {WORLD.choosePlace}
                    <select value={pendingPlaceId} disabled={pending} onChange={(e) => setPendingPlaceId(e.target.value)}>
                      <option value="">{WORLD.choosePlace}</option>
                      {records.map((record) => (
                        <option key={record.id} value={record.id}>
                          {record.title} ({record.typeLabel}
                          {record.homeLabel ? ` · ${record.homeLabel}` : ""})
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="small muted">{WORLD.mapDraftNote}</p>
                </>
              ) : null}
              <MapShapeEditor
                draft={draft}
                pending={pending}
                onChange={setDraft}
                onCancel={cancelDraft}
                onSave={saveDraft}
                saveLabel={draft.kind === "route" ? WORLD.mapSaveRoute : draft.kind === "area" ? WORLD.mapSaveArea : WORLD.mapSaveLabel}
                onDelete={draft.pinId ? deleteDraftShape : null}
              />
            </div>
          ) : !selected ? (
            mode === "edit" && tool === "point" ? (
              <form
                className="stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  placePin(0.5, 0.5);
                }}
              >
                <label>
                  {WORLD.markerLabel}
                  <input value={pendingLabel} maxLength={120} onChange={(e) => setPendingLabel(e.target.value)} />
                </label>
                <label>
                  {WORLD.mapLayer}
                  <select value={pendingLayerId} onChange={(e) => setPendingLayerId(e.target.value)}>
                    {map.layers.map((layer) => (
                      <option key={layer.id} value={layer.id}>
                        {layer.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {WORLD.choosePlace}
                  <select value={pendingPlaceId} disabled={pending} onChange={(e) => setPendingPlaceId(e.target.value)}>
                    <option value="">{WORLD.choosePlace}</option>
                    {records.map((record) => (
                      <option key={record.id} value={record.id}>
                        {record.title} ({record.typeLabel}
                        {record.homeLabel ? ` · ${record.homeLabel}` : ""})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {WORLD.chooseDetailedMap}
                  <select value={pendingMapId} disabled={pending} onChange={(e) => setPendingMapId(e.target.value)}>
                    <option value="">{otherMaps.length ? WORLD.chooseDetailedMap : WORLD.noDetailedMap}</option>
                    {otherMaps.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                </label>
                <Checkbox
                  className="map-keep-placing"
                  checked={keepPlacing}
                  onChange={(event) => setKeepPlacing(event.target.checked)}
                  label={WORLD.mapKeepPlacing}
                />
                <Button type="submit" size="sm" disabled={pending || (!pendingPlaceId && !pendingMapId)}>
                  {WORLD.addPin}
                </Button>
                <p className="visual-inspector-empty">{WORLD.noPinSelected}</p>
              </form>
            ) : (
              <p className="visual-inspector-empty">{WORLD.noPinSelected}</p>
            )
          ) : (
            <MarkerRail
              projectId={projectId}
              mapId={map.id}
              pin={selected}
              layers={map.layers}
              records={records}
              otherMaps={otherMaps}
              mode={mode}
              pending={pending}
              inspection={inspection}
              returnPath={returnPath}
              onOpenMap={openDetailedMap}
              onIssues={setIssues}
              onStatus={setStatus}
              sceneRefresh={sceneRefresh}
              onLinked={() => setSceneRefresh((value) => value + 1)}
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
                setDrawPhase("drawing");
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

const TRAVEL_LABEL: Record<TravelSpeedPreset, string> = {
  walk: WORLD.mapTravelWalking,
  horse: WORLD.mapTravelHorse,
  wagon: WORLD.mapTravelWagon,
  ship: WORLD.mapTravelShip,
  custom: WORLD.mapTravelCustom,
};

function MapTravelEstimator({
  reading,
  preset,
  onPreset,
  customSpeed,
  onCustomSpeed,
}: {
  reading: ScaleReading;
  preset: TravelSpeedPreset;
  onPreset: (value: TravelSpeedPreset) => void;
  customSpeed: string;
  onCustomSpeed: (value: string) => void;
}) {
  const imperial = scaleUsesImperialUnits(reading.unit);
  const speedUnit = imperial ? "mph" : "km/h";
  const presetSpeed = preset !== "custom" ? presetTravelSpeed(preset, imperial) : Number(customSpeed);
  const hours =
    preset === "custom"
      ? travelHoursFromDistance(reading, Number(customSpeed), imperial)
      : travelHoursFromDistance(reading, presetSpeed, imperial);
  const duration = hours != null ? formatTravelDuration(hours) : "";
  const modeLabel = TRAVEL_LABEL[preset].toLowerCase();
  return (
    <div className="map-travel-estimates">
      <label className="small">
        {WORLD.mapTravelSpeed}
        <select value={preset} onChange={(event) => onPreset(event.target.value as TravelSpeedPreset)}>
          {(Object.keys(TRAVEL_LABEL) as TravelSpeedPreset[]).map((key) => (
            <option key={key} value={key}>
              {TRAVEL_LABEL[key]}
            </option>
          ))}
        </select>
      </label>
      {preset === "custom" ? (
        <label className="small">
          {WORLD.mapTravelCustomSpeed}
          <input
            type="number"
            min={0.1}
            step={0.1}
            value={customSpeed}
            onChange={(event) => onCustomSpeed(event.target.value)}
            aria-describedby="map-travel-unit"
          />
          <span id="map-travel-unit" className="muted">
            {" "}
            {WORLD.mapTravelPerHour(speedUnit)}
          </span>
        </label>
      ) : null}
      {duration ? (
        <p className="small" style={{ margin: 0 }} role="status">
          {WORLD.mapTravelEstimate(duration, modeLabel)} · {WORLD.mapTravelNote}
        </p>
      ) : null}
    </div>
  );
}

function MarkerRail({
  projectId,
  mapId,
  pin,
  layers,
  records,
  otherMaps,
  mode,
  pending,
  inspection,
  returnPath,
  sceneRefresh,
  onLinked,
  onOpenMap,
  onIssues,
  onStatus,
  onUpdated,
  onRemoved,
  onEditShape,
}: {
  projectId: string;
  mapId: string;
  pin: WorldMapPinView;
  layers: WorldMapLayerView[];
  records: PlaceableRecord[];
  otherMaps: PlaceableMap[];
  mode: "browse" | "edit";
  pending: boolean;
  inspection: LoadedInspector | null;
  returnPath: string;
  sceneRefresh: number;
  onLinked: () => void;
  onOpenMap: (mapId: string) => void;
  onIssues: (issues: Issue[]) => void;
  onStatus: (message: string) => void;
  onUpdated: (pin: WorldMapPinView) => void;
  onRemoved: () => void;
  onEditShape: () => void;
}) {
  const [recordId, setRecordId] = useState(pin.recordId ?? "");
  const [targetMapId, setTargetMapId] = useState(pin.targetMapId ?? "");
  const [layerId, setLayerId] = useState(effectiveLayerId(pin, layers) ?? layers[0]?.id ?? "");
  const [label, setLabel] = useState(pin.label);
  const [xPercent, setXPercent] = useState(String(Math.round(pin.xNorm * 1000) / 10));
  const [yPercent, setYPercent] = useState(String(Math.round(pin.yNorm * 1000) / 10));
  const [, startTransition] = useTransition();

  useEffect(() => {
    setRecordId(pin.recordId ?? "");
    setTargetMapId(pin.targetMapId ?? "");
    setLayerId(effectiveLayerId(pin, layers) ?? layers[0]?.id ?? "");
    setLabel(pin.label);
    setXPercent(String(Math.round(pin.xNorm * 1000) / 10));
    setYPercent(String(Math.round(pin.yNorm * 1000) / 10));
  }, [pin.id, pin.recordId, pin.targetMapId, pin.layerId, pin.markerGroup, pin.label, pin.xNorm, pin.yNorm, pin.revision, layers]);

  return (
    <div className="stack canvas-marker-rail">
      <p className="small muted canvas-inspector-kind">
        {pin.typeLabel || pinLayerTitle(pin, layers)}
        {pin.kind === "route" || pin.kind === "area" ? ` · ${KIND_LABEL[pin.kind]} · ${pin.points.length} points` : ""}
        {pin.authorityStatus ? (
          <>
            {" · "}
            <StatusBadge status={pin.authorityStatus} />
          </>
        ) : null}
      </p>
      {pin.unavailable ? <p className="small muted">{WORLD.pinUnavailable}</p> : null}
      {pin.home ? (
        <p className="small muted">{SERIES.homeBadge(seriesBookLabel(pin.home))}</p>
      ) : pin.worldScope === "series" ? (
        <p className="small muted">{SERIES.scopeWholeSeries}</p>
      ) : null}
      {pin.targetUnavailable ? <p className="small muted">{WORLD.targetMapUnavailable}</p> : null}
      {pin.targetMapId && !pin.targetUnavailable ? (
        <div className="map-drill-callout">
          <Button type="button" variant="primary" size="sm" onClick={() => onOpenMap(pin.targetMapId!)}>
            {WORLD.mapDrillIn}
          </Button>
          <p className="small muted" style={{ margin: "0.35rem 0 0" }}>
            {WORLD.openDetailedMap}
          </p>
        </div>
      ) : null}
      {pin.recordId && !pin.unavailable ? (
        inspection?.ok ? (
          <CanvasInspectorSection title={WORLD.referenceSummary}>
            <CanvasReferenceSummary projectId={projectId} model={inspection.model} returnPath={returnPath} />
          </CanvasInspectorSection>
        ) : inspection && !inspection.ok ? (
          <p className="muted">{inspection.message}</p>
        ) : pin.recordId ? (
          <p className="muted">{WORLD.inspectorLoading}</p>
        ) : null
      ) : null}
      {pin.recordId ? (
        <CanvasInspectorSection title={WORLD.eventsAtPlace} defaultOpen={false}>
          <PlaceEvents projectId={projectId} locationRecordId={pin.recordId} compact />
        </CanvasInspectorSection>
      ) : null}
      {pin.recordId ? (
        <CanvasInspectorSection title={WORLD.linkedScenes} defaultOpen>
          <MarkerScenes
            projectId={projectId}
            locationRecordId={pin.recordId}
            returnPath={returnPath}
            refreshKey={sceneRefresh}
            compact
          />
          {inspection?.ok && isLinkableReferenceType(inspection.model.recordType) ? (
            <LinkSceneForm
              projectId={projectId}
              locationRecordId={inspection.model.id}
              protectedReference={inspection.model.protected}
              onLinked={(message) => {
                onStatus(message);
                onLinked();
              }}
            />
          ) : null}
        </CanvasInspectorSection>
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
                layerId: layerId || null,
                label,
                expectedRevision: pin.revision,
              });
              if (!result.ok) {
                onIssues(result.issues);
                return;
              }
              onIssues([]);
              onStatus(WORLD.mapSaved);
              onUpdated(result.pin);
            });
          }}
        >
          <label>
            {WORLD.mapLayer}
            <select value={layerId} onChange={(e) => setLayerId(e.target.value)}>
              {layers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
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
            {WORLD.mapLinkDetailMap}
            <select value={targetMapId} onChange={(e) => setTargetMapId(e.target.value)}>
              <option value="">{WORLD.chooseDetailedMap}</option>
              {otherMaps.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          {targetMapId && otherMaps.some((item) => item.id === targetMapId) ? (
            <Button type="button" variant="primary" size="sm" onClick={() => onOpenMap(targetMapId)}>
              {WORLD.mapDrillIn}
            </Button>
          ) : null}
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
              onStatus(WORLD.mapSaved);
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

function downloadText(filename: string, text: string, type: string) {
  downloadBlob(filename, new Blob([text], { type }));
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
