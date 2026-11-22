/** Project-scoped image URL for board cards and the inspector rail. */
export function boardImageSrc(projectId: string, imageId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/images/${encodeURIComponent(imageId)}`;
}

export function BoardProjectImage({
  projectId,
  imageId,
  alt,
  className,
}: {
  projectId: string;
  imageId: string;
  alt: string;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- served from the project image route
    <img src={boardImageSrc(projectId, imageId)} alt={alt} className={className} draggable={false} loading="lazy" />
  );
}