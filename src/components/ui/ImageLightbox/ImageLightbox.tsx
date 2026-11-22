"use client";

import { useEffect, useId, useRef } from "react";
import { ChevronRightIcon, CloseIcon } from "@/components/shell/icons";
import { IconButton } from "@/components/ui/IconButton";
import { IMAGES } from "@/ui/labels";

export interface LightboxImage {
  id: string;
  src: string;
  alt: string;
  caption: string;
}

/** Full-size view of one attached image, with previous and next when several are open. */
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
  const titleId = useId();
  const index = openId ? images.findIndex((image) => image.id === openId) : -1;
  const image = index >= 0 ? images[index] : null;
  const title = image ? image.caption || image.alt || IMAGES.lightboxUntitled : IMAGES.lightboxUntitled;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (image && !dialog.open) dialog.showModal();
    else if (!image && dialog.open) dialog.close();
  }, [image]);

  const step = (delta: number) => {
    if (images.length < 2 || index < 0) return;
    const next = images[(index + delta + images.length) % images.length];
    if (next) onOpenId(next.id);
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
        }
      }}
    >
      {image ? (
        <>
          <div className="image-lightbox-bar">
            <p id={titleId} className="image-lightbox-title">
              {title}
            </p>
            <IconButton tip="end" aria-label={IMAGES.lightboxClose} onClick={() => dialogRef.current?.close()}>
              <CloseIcon />
            </IconButton>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element -- project image route */}
          <img src={image.src} alt={image.alt || title} className="image-lightbox-photo" />
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
