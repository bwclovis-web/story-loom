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
}: {
  projectId: string;
  model: ReferenceInspectorModel;
  returnPath: string;
  sourceNote?: string | null;
}) {
  const recordPath = `/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(model.id)}`;
  return (
    <section className="stack" aria-label={WORLD.referenceSummary}>
      {sourceNote ? <p className="small muted">{sourceNote}</p> : null}
      <h3 className="inspector-record-title">{model.title}</h3>
      <p className="small">
        {model.typeLabel}
        {model.worldKindLabel ? ` · ${model.worldKindLabel}` : ""}
        {model.protected ? ` · ${WORLD.protectedLabel}` : ""}
      </p>
      {model.lead ? <p className="small inspector-lead">{model.lead}</p> : <p className="small muted">{WORLD.emptyDocument}</p>}
      <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
        <ButtonLink href={withCanvasReturn(recordPath, returnPath)} size="sm">
          {WORLD.openReference}
        </ButtonLink>
        <ButtonLink href={withCanvasReturn(recordPath, returnPath, true)} variant="secondary" size="sm">
          {REFERENCE_FORM.editReference}
        </ButtonLink>
      </div>
    </section>
  );
}
