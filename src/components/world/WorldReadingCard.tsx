"use client";

import Link from "next/link";
import { ExternalLink, FileText, Lock } from "lucide-react";
import { StatusBadge } from "@/components/Badges";
import { Button, ButtonLink } from "@/components/ui/Atoms/Button";
import { OpenableImage } from "@/components/ui/ImageLightbox";
import { WORLD } from "@/ui/labels";
import { categoryLabel, taxonomyPlacementLabel } from "@/ui/world";
import { seriesBookLabel } from "@/world/seriesHome";
import type { WorldHubRecord } from "@/world/hubDiscovery";
import type { CustomTaxonomyCategoryOption } from "@/world/customCategories";
import { getTaxonomyCategory } from "@/world/taxonomy";

function taxonomyPrimaryLabel(record: WorldHubRecord): string | null {
  if (!record.taxonomy.primaryCategory) return null;
  const primary = record.taxonomy.primarySubcategory
    ? { category: record.taxonomy.primaryCategory, subcategory: record.taxonomy.primarySubcategory }
    : { category: record.taxonomy.primaryCategory };
  return taxonomyPlacementLabel(primary);
}

function subcategoryOnly(record: WorldHubRecord): string | null {
  if (!record.taxonomy.primaryCategory || !record.taxonomy.primarySubcategory) return null;
  const cat = getTaxonomyCategory(record.taxonomy.primaryCategory);
  return (
    cat?.subcategories.find((item) => item.id === record.taxonomy.primarySubcategory)?.label ??
    record.taxonomy.primarySubcategory
  );
}

export function WorldReadingCard({
  projectId,
  record,
  imageSrc = null,
  seriesName = null,
  selected = false,
  onPreview,
}: {
  projectId: string;
  record: WorldHubRecord;
  imageSrc?: string | null;
  /** Project series name for the Series: line when set. */
  seriesName?: string | null;
  selected?: boolean;
  onPreview?: () => void;
  customCategories?: readonly CustomTaxonomyCategoryOption[];
}) {
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const href = `${base}/records/${encodeURIComponent(record.id)}`;
  const primary = taxonomyPrimaryLabel(record);
  const sub = subcategoryOnly(record);
  const book = record.home ? seriesBookLabel(record.home) : null;
  const seriesLine = seriesName?.trim() || book;

  return (
    <article
      className={`world-reading-card${selected ? " is-selected" : ""}`}
      aria-current={selected ? "true" : undefined}
    >
      <div className="world-reading-card-body">
        <div className="world-reading-card-thumb" aria-hidden={imageSrc ? undefined : true}>
          {imageSrc ? (
            <OpenableImage
              src={imageSrc}
              alt={record.title}
              caption={record.title}
              id={`hub-${record.id}`}
              className="world-reading-card-thumb-open"
              width={64}
              height={64}
            />
          ) : (
            <span className="world-reading-card-thumb-fallback">
              <FileText strokeWidth={1.5} aria-hidden="true" />
            </span>
          )}
        </div>
        <div className="world-reading-card-main">
          <div className="world-reading-card-head">
            <h3 className="world-reading-card-title">
              <Link href={href}>{record.title}</Link>
            </h3>
            <div className="world-reading-card-badges">
              <StatusBadge status={record.authorityStatus} />
              {record.protected ? (
                <span className="badge protected world-reading-card-protected">
                  <Lock strokeWidth={1.75} aria-hidden="true" className="world-reading-card-lock" />
                  {WORLD.protectedYes}
                </span>
              ) : null}
            </div>
          </div>
          <p className="world-reading-card-meta small muted">
            {seriesLine ? <span>{WORLD.seriesLine(seriesLine)}</span> : null}
            {sub ? (
              <>
                {seriesLine ? <span aria-hidden="true"> · </span> : null}
                <span>{sub}</span>
              </>
            ) : primary && primary !== categoryLabel(record.type) ? (
              <>
                {seriesLine ? <span aria-hidden="true"> · </span> : null}
                <span>{primary}</span>
              </>
            ) : (
              <>
                {seriesLine ? <span aria-hidden="true"> · </span> : null}
                <span>{categoryLabel(record.type)}</span>
              </>
            )}
          </p>
          <p className="world-reading-card-excerpt">{record.excerpt}</p>
          <footer className="world-reading-card-foot">
            <ButtonLink href={href} size="sm" variant="secondary" icon={<ExternalLink strokeWidth={1.75} />}>
              {WORLD.openReference}
            </ButtonLink>
            {onPreview ? (
              <Button type="button" size="sm" variant="secondary" onClick={onPreview} aria-pressed={selected}>
                {WORLD.previewReference}
              </Button>
            ) : null}
          </footer>
        </div>
      </div>
    </article>
  );
}
