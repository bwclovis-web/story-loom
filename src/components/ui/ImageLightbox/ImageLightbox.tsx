"use client";

import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { ChevronRightIcon, CloseIcon } from "@/components/shell/icons";
import { IconButton } from "@/components/ui/IconButton";
import { Button } from "@/components/ui/Atoms/Button";
import { IMAGES } from "@/ui/labels";

export interface LightboxImage {
  id: string;
  src: string;
  alt: string;
  caption: string;
}

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;

function clampZoom(value: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value / ZOOM_STEP) * ZOOM_STEP));
}

/** Full-size view of one attached image, with previous/next and zoom. */
export function ImageLightbox({
  images,
  openId,
  onOpenId,
  onClose,
}: {
  images: LightboxImage[];
  openId: string | null;
  onOpenId: (id: string) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const index = openId ? images.findIndex((image) => image.id === openId) : -1;
  const image = index >= 0 ? images[index] : null;
  const title = image ? image.caption || image.alt || IMAGES.lightboxUntitled : IMAGES.lightboxUntitled;

  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(
    null,
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (image && !dialog.open) dialog.showModal();
    else if (!image && dialog.open) dialog.close();
  }, [image]);

  useEffect(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    dragRef.current = null;
  }, [openId]);

  const step = (delta: number) => {
    if (images.length < 2 || index < 0) return;
    const next = images[(index + delta + images.length) % images.length];
    if (next) onOpenId(next.id);
  };

  const adjustZoom = (next: number) => {
    const clamped = clampZoom(next);
    setZoom(clamped);
    if (clamped <= 1) setOffset({ x: 0, y: 0 });
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!image) return;
    event.preventDefault();
    const direction = event.deltaY < 0 ? 1 : -1;
    adjustZoom(zoom + direction * ZOOM_STEP);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (zoom <= 1) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setOffset({
      x: drag.originX + (event.clientX - drag.startX),
      y: drag.originY + (event.clientY - drag.startY),
    });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  return (
    <dialog
      ref={dialogRef}
      className="image-lightbox"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) dialogRef.current?.close();
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") {
          event.preventDefault();
          step(1);
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          step(-1);
        } else if (event.key === "+" || event.key === "=") {
          event.preventDefault();
          adjustZoom(zoom + ZOOM_STEP);
        } else if (event.key === "-" || event.key === "_") {
          event.preventDefault();
          adjustZoom(zoom - ZOOM_STEP);
        } else if (event.key === "0") {
          event.preventDefault();
          adjustZoom(1);
        }
      }}
    >
      {image ? (
        <>
          <div className="image-lightbox-bar">
            <p id={titleId} className="image-lightbox-title">
              {title}
            </p>
            <div className="image-lightbox-tools">
              <div className="image-lightbox-zoom" role="group" aria-label={IMAGES.lightboxZoomReadout(Math.round(zoom * 100))}>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  aria-label={IMAGES.lightboxZoomOut}
                  disabled={zoom <= ZOOM_MIN}
                  onClick={() => adjustZoom(zoom - ZOOM_STEP)}
                  icon={<ZoomOut strokeWidth={1.75} />}
                />
                <span className="image-lightbox-zoom-readout" aria-live="polite">
                  {IMAGES.lightboxZoomReadout(Math.round(zoom * 100))}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  aria-label={IMAGES.lightboxZoomIn}
                  disabled={zoom >= ZOOM_MAX}
                  onClick={() => adjustZoom(zoom + ZOOM_STEP)}
                  icon={<ZoomIn strokeWidth={1.75} />}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={zoom <= 1 && offset.x === 0 && offset.y === 0}
                  onClick={() => adjustZoom(1)}
                >
                  {IMAGES.lightboxZoomReset}
                </Button>
              </div>
              <IconButton tip="end" aria-label={IMAGES.lightboxClose} onClick={() => dialogRef.current?.close()}>
                <CloseIcon />
              </IconButton>
            </div>
          </div>
          <div
            ref={stageRef}
            className={`image-lightbox-stage${zoom > 1 ? " is-zoomed" : ""}`}
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- project image route */}
            <img
              src={image.src}
              alt={image.alt || title}
              className="image-lightbox-photo"
              draggable={false}
              style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}
            />
          </div>
          {images.length > 1 ? (
            <div className="image-lightbox-nav">
              <IconButton tip="none" aria-label={IMAGES.lightboxPrevious} onClick={() => step(-1)}>
                <span className="image-lightbox-prev">
                  <ChevronRightIcon />
                </span>
              </IconButton>
              <p className="small muted">{IMAGES.lightboxPosition(index + 1, images.length)}</p>
              <IconButton tip="none" aria-label={IMAGES.lightboxNext} onClick={() => step(1)}>
                <ChevronRightIcon />
              </IconButton>
            </div>
          ) : null}
        </>
      ) : null}
    </dialog>
  );
}
