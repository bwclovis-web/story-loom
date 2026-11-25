"use client";

import { OpenableImage } from "@/components/ui/ImageLightbox";

/** Project-scoped image URL for board cards and the inspector rail. */
export function boardImageSrc(projectId: string, imageId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/images/${encodeURIComponent(imageId)}`;
}

export function BoardProjectImage({
  projectId,
  imageId,
  alt,
  className,
  openable = true,
}: {
  projectId: string;
  imageId: string;
  alt: string;
  className?: string;
  /** When false, render a plain img (e.g. decorative card face while dragging). */
  openable?: boolean;
}) {
  const src = boardImageSrc(projectId, imageId);
  if (!openable) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- served from the project image route
      <img src={src} alt={alt} className={className} draggable={false} loading="lazy" />
    );
  }
  return <OpenableImage src={src} alt={alt} imgClassName={className} />;
}
