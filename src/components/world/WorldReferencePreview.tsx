"use client";

import { ExternalLink, FileText, Lock, X } from "lucide-react";
import { StatusBadge } from "@/components/Badges";
import { Button, ButtonLink } from "@/components/ui/Atoms/Button";
import { OpenableImage } from "@/components/ui/ImageLightbox";
import { WORLD } from "@/ui/labels";
import { categoryLabel, taxonomyPlacementLabel } from "@/ui/world";
import { seriesBookLabel } from "@/world/seriesHome";
import type { WorldHubRecord } from "@/world/hubDiscovery";
import { getTaxonomyCategory } from "@/world/taxonomy";

function subcategoryOnly(record: WorldHubRecord): string | null {
  if (!record.taxonomy.primaryCategory || !record.taxonomy.primarySubcategory) return null;
  const cat = getTaxonomyCategory(record.taxonomy.primaryCategory);
  return (
    cat?.subcategories.find((item) => item.id === record.taxonomy.primarySubcategory)?.label ??
    record.taxonomy.primarySubcategory
  );
}

function taxonomyPrimaryLabel(record: WorldHubRecord): string | null {
  if (!record.taxonomy.primaryCategory) return null;
  const primary = record.taxonomy.primarySubcategory
    ? { category: record.taxonomy.primaryCategory, subcategory: record.taxonomy.primarySubcategory }
    : { category: record.taxonomy.primaryCategory };
  return taxonomyPlacementLabel(primary);
}

export function WorldReferencePreview({
  projectId,
  record,
  imageSrc = null,
  seriesName = null,
  onClose,
}: {
  projectId: string;
  record: WorldHubRecord;
  imageSrc?: string | null;
  seriesName?: string | null;
  onClose: () => void;
}) {
  const href = `/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(record.id)}`;
  const book = record.home ? seriesBookLabel(record.home) : null;
  const seriesLine = seriesName?.trim() || book;
  const sub = subcategoryOnly(record);
  const primary = taxonomyPrimaryLabel(record);

  return (
    <aside className="world-reference-preview" aria-labelledby="world-reference-preview-title">
      <header className="world-reference-preview-head">
        <h2 id="world-reference-preview-title">{WORLD.referencePreview}</h2>
        <Button type="button" size="sm" variant="secondary" onClick={onClose} icon={<X strokeWidth={1.75} />}>
          <span className="sr-only">{WORLD.closePreview}</span>
        </Button>
      </header>
      <div className="world-reference-preview-media" aria-hidden={imageSrc ? undefined : true}>
        {imageSrc ? (
          <OpenableImage
            src={imageSrc}
            alt={record.title}
            caption={record.title}
            id={`preview-${record.id}`}
            className="world-reference-preview-open"
          />
        ) : (
          <span className="world-reference-preview-fallback">
            <FileText strokeWidth={1.5} aria-hidden="true" />
          </span>
        )}
      </div>
      <h3 className="world-reference-preview-title">{record.title}</h3>
      <div className="world-reading-card-badges">
        <StatusBadge status={record.authorityStatus} />
        {record.protected ? (
          <span className="badge protected world-reading-card-protected">
            <Lock strokeWidth={1.75} aria-hidden="true" className="world-reading-card-lock" />
            {WORLD.protectedYes}
          </span>
        ) : null}
      </div>
      <p className="world-reading-card-meta small muted">
        {seriesLine ? <span>{WORLD.seriesLine(seriesLine)}</span> : null}
        {sub || primary || categoryLabel(record.type) ? (
          <>
            {seriesLine ? <span aria-hidden="true"> · </span> : null}
            <span>{sub ?? (primary && primary !== categoryLabel(record.type) ? primary : categoryLabel(record.type))}</span>
          </>
        ) : null}
      </p>
      <p className="world-reference-preview-excerpt">{record.excerpt}</p>
      <div className="world-reference-preview-actions">
        <ButtonLink href={href} icon={<ExternalLink strokeWidth={1.75} />}>
          {WORLD.openReference}
        </ButtonLink>
        <Button type="button" variant="secondary" onClick={onClose}>
          {WORLD.closePreview}
        </Button>
      </div>
    </aside>
  );
}
