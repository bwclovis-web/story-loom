import { BookMarked, MapPin } from "lucide-react";
import { BoardProjectImage } from "@/components/world/BoardProjectImage";
import { TaxonomyBadges } from "@/components/world/TaxonomyBadges";
import { ButtonLink } from "@/components/ui/Atoms/Button";
import { REFERENCE_FORM, SERIES, WORLD } from "@/ui/labels";
import { withCanvasReturn } from "@/world/canvasReturn";
import type { ReferenceInspectorModel } from "@/world/inspectorModel";
import { seriesBookLabel } from "@/world/seriesHome";

/** Compact identity for a map marker or board card. The full record stays on its own page. */
export function CanvasReferenceSummary({
  projectId,
  model,
  returnPath,
  sourceNote,
  imageId = null,
  imageAlt = null,
  openRecordLabel = WORLD.openReference,
}: {
  projectId: string;
  model: ReferenceInspectorModel;
  returnPath: string;
  sourceNote?: string | null;
  imageId?: string | null;
  imageAlt?: string | null;
  openRecordLabel?: string;
}) {
  const recordPath = `/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(model.id)}`;
  return (
    <div className="canvas-reference-summary" role="group" aria-label={WORLD.referenceSummary}>
      <div className="canvas-reference-identity">
        {imageId ? (
          <BoardProjectImage
            projectId={projectId}
            imageId={imageId}
            alt={imageAlt || model.title}
            className="canvas-reference-thumb"
          />
        ) : (
          <span className="canvas-reference-icon" aria-hidden="true">
            {model.worldKindLabel ? <MapPin strokeWidth={1.6} /> : <BookMarked strokeWidth={1.6} />}
          </span>
        )}
        <div className="canvas-reference-identity-text">
          <h3 className="inspector-record-title">{model.title}</h3>
          <p className="small canvas-reference-meta">
            {model.typeLabel}
            {model.worldKindLabel ? ` · ${model.worldKindLabel}` : ""}
            {model.protected ? ` · ${WORLD.protectedLabel}` : ""}
            {model.seriesHome
              ? ` · ${SERIES.sharedFrom(seriesBookLabel(model.seriesHome))}`
              : model.worldScope === "series"
                ? ` · ${SERIES.scopeWholeSeries}`
                : model.worldScope === "book"
                  ? ` · ${SERIES.scopeThisBook}`
                  : ""}
          </p>
        </div>
      </div>
      {sourceNote ? <p className="small muted">{sourceNote}</p> : null}
      <TaxonomyBadges taxonomy={model.taxonomy} compact />
      {model.lead ? <p className="small inspector-lead">{model.lead}</p> : <p className="small muted">{WORLD.emptyDocument}</p>}
      <div className="canvas-reference-actions">
        <ButtonLink href={withCanvasReturn(recordPath, returnPath)} size="sm">
          {openRecordLabel}
        </ButtonLink>
        <ButtonLink href={withCanvasReturn(recordPath, returnPath, true)} variant="secondary" size="sm">
          {REFERENCE_FORM.editReference}
        </ButtonLink>
      </div>
    </div>
  );
}