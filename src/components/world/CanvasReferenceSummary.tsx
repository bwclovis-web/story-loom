import { BookMarked, MapPin } from "lucide-react";
import { BoardProjectImage } from "@/components/world/BoardProjectImage";
import { ButtonLink } from "@/components/ui/Button";
import { REFERENCE_FORM, WORLD } from "@/ui/labels";
import { withCanvasReturn } from "@/world/canvasReturn";
import type { ReferenceInspectorModel } from "@/world/inspectorModel";

/** Compact identity for a map marker or board card. The full record stays on its own page. */
export function CanvasReferenceSummary({
  projectId,
  model,
  returnPath,
  sourceNote,
  imageId = null,
  imageAlt = null,
}: {
  projectId: string;
  model: ReferenceInspectorModel;
  returnPath: string;
  sourceNote?: string | null;
  imageId?: string | null;
  imageAlt?: string | null;
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
          </p>
        </div>
      </div>
      {sourceNote ? <p className="small muted">{sourceNote}</p> : null}
      {model.lead ? <p className="small inspector-lead">{model.lead}</p> : <p className="small muted">{WORLD.emptyDocument}</p>}
      <div className="canvas-reference-actions">
        <ButtonLink href={withCanvasReturn(recordPath, returnPath)} size="sm">
          {WORLD.openReference}
        </ButtonLink>
        <ButtonLink href={withCanvasReturn(recordPath, returnPath, true)} variant="secondary" size="sm">
          {REFERENCE_FORM.editReference}
        </ButtonLink>
      </div>
    </div>
  );
}