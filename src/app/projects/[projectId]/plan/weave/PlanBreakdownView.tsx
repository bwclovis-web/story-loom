"use client";

import { Button } from "@/components/ui/Atoms/Button";
import type { WeaveBeatView } from "@/server/services/weaveService";
import type { WeaveStructureView } from "@/server/services/weaveStructureService";
import { WEAVE } from "@/ui/labels";

export function PlanBreakdownView({
  structures,
  beats,
}: {
  structures: WeaveStructureView[];
  beats: WeaveBeatView[];
}) {
  const beatById = new Map(beats.map((beat) => [beat.id, beat]));

  return (
    <section className="panel weave-breakdown" aria-labelledby="breakdown-heading">
      <div className="weave-breakdown-toolbar">
        <div>
          <h2 id="breakdown-heading">{WEAVE.breakdownHeading}</h2>
          <p className="small muted">{WEAVE.breakdownLead}</p>
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={() => window.print()}>
          {WEAVE.breakdownPrint}
        </Button>
      </div>

      {!structures.length ? (
        <p className="small muted">{WEAVE.beatSheetEmpty}</p>
      ) : (
        structures.map((structure) => (
          <div key={structure.id} className="weave-breakdown-structure">
            <h3>{structure.title}</h3>
            {structure.attribution ? <p className="small muted">{structure.attribution}</p> : null}
            <div className="weave-breakdown-scroll">
              <table className="weave-breakdown-table">
                <thead>
                  <tr>
                    <th scope="col">{WEAVE.breakdownStage}</th>
                    <th scope="col">{WEAVE.breakdownDescription}</th>
                    <th scope="col">{WEAVE.breakdownLinks}</th>
                    <th scope="col">{WEAVE.breakdownNotes}</th>
                  </tr>
                </thead>
                <tbody>
                  {structure.stages.map((stage) => {
                    if (!stage.ideas.length) {
                      return (
                        <tr key={stage.id}>
                          <th scope="row">
                            {stage.groupTitle ? (
                              <span className="small muted">{stage.groupTitle} · </span>
                            ) : null}
                            {stage.title}
                          </th>
                          <td>
                            <span className="muted">{WEAVE.breakdownEmptyDescription}</span>
                          </td>
                          <td>{WEAVE.breakdownNotLinked}</td>
                          <td>{stage.notes.trim() || "—"}</td>
                        </tr>
                      );
                    }
                    return stage.ideas.map((idea) => {
                      const beat = beatById.get(idea.beatId);
                      const linkLabel = beat?.manuscriptTitle?.trim()
                        ? beat.manuscriptUnavailable
                          ? `${beat.manuscriptTitle} (Trash)`
                          : beat.manuscriptTitle
                        : WEAVE.breakdownNotLinked;
                      return (
                        <tr key={`${stage.id}:${idea.linkId}`}>
                          <th scope="row">
                            {stage.groupTitle ? (
                              <span className="small muted">{stage.groupTitle} · </span>
                            ) : null}
                            {stage.title}
                          </th>
                          <td>
                            {idea.body.trim() || idea.title.trim() || (
                              <span className="muted">{WEAVE.breakdownEmptyDescription}</span>
                            )}
                          </td>
                          <td>{linkLabel}</td>
                          <td>{stage.notes.trim() || "—"}</td>
                        </tr>
                      );
                    });
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </section>
  );
}
