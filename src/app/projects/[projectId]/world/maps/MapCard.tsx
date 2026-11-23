"use client";

import Link from "next/link";
import { ArrowRight, BookMarked, MapPin, MoreHorizontal } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BoardOverflowMenu } from "@/components/ui/BoardOverflowMenu";
import { Button } from "@/components/ui/Atoms/Button";
import { IconAnchor } from "@/components/ui/IconButton";
import { REFERENCE_FORM, SHELL, WORLD } from "@/ui/labels";
import { MAP_CLASSIFICATION_LABEL } from "@/world/mapClassification";
import type { MapLibraryItem } from "@/world/mapLibrary";
import { deleteWorldMapAction } from "./actions";

function MapOverflowActions({
  projectId,
  map,
  onEditDetails,
}: {
  projectId: string;
  map: MapLibraryItem;
  onEditDetails: (map: MapLibraryItem) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const href = `/projects/${encodeURIComponent(projectId)}/world/maps/${encodeURIComponent(map.id)}`;

  return (
    <BoardOverflowMenu
      className="map-library-overflow"
      summary={<MoreHorizontal aria-hidden="true" strokeWidth={2} />}
      summaryLabel={SHELL.moreActions}
    >
      <div className="stack" style={{ gap: "0.35rem" }}>
        <Button type="button" size="sm" variant="secondary" onClick={() => router.push(href)}>
          {WORLD.openMap}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => onEditDetails(map)}>
          {WORLD.mapEditDetails}
        </Button>
        {!confirmDelete ? (
          <Button type="button" size="sm" variant="danger" onClick={() => setConfirmDelete(true)} disabled={pending}>
            {WORLD.deleteMap}
          </Button>
        ) : (
          <>
            <p className="small muted" style={{ margin: 0 }}>
              {WORLD.deleteMapKeepsReference}
            </p>
            <Button
              type="button"
              size="sm"
              variant="danger"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await deleteWorldMapAction(projectId, map.id);
                  if (result.ok) router.refresh();
                  else setConfirmDelete(false);
                })
              }
            >
              {WORLD.confirmDeleteMap(map.title)}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setConfirmDelete(false)} disabled={pending}>
              {REFERENCE_FORM.cancel}
            </Button>
          </>
        )}
      </div>
    </BoardOverflowMenu>
  );
}

export function MapCard({
  projectId,
  map,
  onEditDetails,
}: {
  projectId: string;
  map: MapLibraryItem;
  onEditDetails: (map: MapLibraryItem) => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const href = `/projects/${encodeURIComponent(projectId)}/world/maps/${encodeURIComponent(map.id)}`;
  const imageSrc = `/projects/${encodeURIComponent(projectId)}/images/${encodeURIComponent(map.imageId)}`;
  const typeLabel = map.classification ? MAP_CLASSIFICATION_LABEL[map.classification] : null;

  return (
    <article className="map-library-card">
      <div className="map-library-card-media">
        <Link href={href} className="map-library-card-thumb" aria-label={`${WORLD.openMap} ${map.title}`}>
          {imageFailed ? (
            <span className="map-library-thumb-fallback">{WORLD.mapsImageUnavailable}</span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- author-uploaded map backdrop
            <img src={imageSrc} alt={`${map.title} backdrop`} onError={() => setImageFailed(true)} />
          )}
        </Link>
        {typeLabel ? <span className="map-library-type-badge">{typeLabel}</span> : null}
      </div>
      <div className="map-library-card-body">
        <h3 className="map-library-card-title">{map.title}</h3>
        <p className="map-library-card-meta">
          <BookMarked aria-hidden="true" strokeWidth={1.75} />
          <span className="map-library-card-ref">{map.hostRecordTitle}</span>
        </p>
        <p className="map-library-card-meta">
          <MapPin aria-hidden="true" strokeWidth={1.75} />
          <span>{WORLD.pinsCount(map.pinCount)}</span>
        </p>
        <div className="map-library-card-actions">
          <IconAnchor href={href} aria-label={`${WORLD.openMap} ${map.title}`} tooltip={WORLD.openMap}>
            <ArrowRight aria-hidden="true" strokeWidth={2} />
          </IconAnchor>
          <MapOverflowActions projectId={projectId} map={map} onEditDetails={onEditDetails} />
        </div>
      </div>
    </article>
  );
}

export function MapListRow({
  projectId,
  map,
  onEditDetails,
}: {
  projectId: string;
  map: MapLibraryItem;
  onEditDetails: (map: MapLibraryItem) => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const href = `/projects/${encodeURIComponent(projectId)}/world/maps/${encodeURIComponent(map.id)}`;
  const imageSrc = `/projects/${encodeURIComponent(projectId)}/images/${encodeURIComponent(map.imageId)}`;
  const typeLabel = map.classification ? MAP_CLASSIFICATION_LABEL[map.classification] : WORLD.mapClassificationNone;

  return (
    <li className="map-library-row">
      <Link href={href} className="map-library-row-thumb" aria-label={`${WORLD.openMap} ${map.title}`}>
        {imageFailed ? (
          <span className="map-library-thumb-fallback map-library-thumb-fallback-sm">{WORLD.mapsImageUnavailable}</span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- author-uploaded map backdrop
          <img src={imageSrc} alt={`${map.title} backdrop`} onError={() => setImageFailed(true)} />
        )}
      </Link>
      <div className="map-library-row-main">
        <p className="map-library-row-title">{map.title}</p>
        <p className="map-library-row-meta">
          <span>{typeLabel}</span>
          <span aria-hidden="true">·</span>
          <span>{map.hostRecordTitle}</span>
          <span aria-hidden="true">·</span>
          <span>{WORLD.pinsCount(map.pinCount)}</span>
        </p>
      </div>
      <div className="map-library-row-actions">
        <IconAnchor href={href} aria-label={`${WORLD.openMap} ${map.title}`} tooltip={WORLD.openMap}>
          <ArrowRight aria-hidden="true" strokeWidth={2} />
        </IconAnchor>
        <MapOverflowActions projectId={projectId} map={map} onEditDetails={onEditDetails} />
      </div>
    </li>
  );
}
