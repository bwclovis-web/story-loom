"use client";

import { useState, type ReactNode } from "react";
import { ImageLightbox, type LightboxImage } from "@/components/ui/ImageLightbox/ImageLightbox";
import { IMAGES } from "@/ui/labels";
import { cn } from "@/ui/cn";

/** Clickable image that opens the shared lightbox (with zoom). */
export function OpenableImage({
  src,
  alt,
  caption = "",
  id,
  images,
  className,
  imgClassName,
  width,
  height,
  children,
}: {
  src: string;
  alt: string;
  caption?: string;
  id?: string;
  /** Optional gallery; defaults to this single image. */
  images?: LightboxImage[];
  className?: string;
  imgClassName?: string;
  width?: number;
  height?: number;
  /** Optional overlay content inside the trigger (e.g. fallback icon when parent supplies layout). */
  children?: ReactNode;
}) {
  const imageId = id ?? src;
  const gallery =
    images && images.length > 0
      ? images
      : [{ id: imageId, src, alt, caption: caption || alt || IMAGES.lightboxUntitled }];
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        className={cn("image-open-trigger image-open-framed", className)}
        onClick={() => setOpenId(imageId)}
        aria-label={alt ? IMAGES.open(alt) : IMAGES.openInLightbox}
      >
        {children ?? (
          // eslint-disable-next-line @next/next/no-img-element -- project / attachment image route
          <img
            src={src}
            alt={alt}
            width={width}
            height={height}
            className={imgClassName}
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        )}
      </button>
      <ImageLightbox images={gallery} openId={openId} onOpenId={setOpenId} onClose={() => setOpenId(null)} />
    </>
  );
}
