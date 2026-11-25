"use client";

import { OpenableImage } from "@/components/ui/ImageLightbox";

/** Markdown-attached image that opens the shared zoom lightbox. */
export function MarkdownOpenableImage({
  src,
  alt,
  caption,
  width,
  height,
}: {
  src: string;
  alt: string;
  caption?: string;
  width: number;
  height: number;
}) {
  return (
    <span className="md-image">
      <OpenableImage src={src} alt={alt} caption={caption ?? ""} width={width} height={height} />
      {caption ? <span className="md-image-caption">{caption}</span> : null}
    </span>
  );
}
