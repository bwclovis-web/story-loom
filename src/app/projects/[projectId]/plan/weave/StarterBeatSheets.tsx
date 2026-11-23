"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { IssueList } from "@/components/IssueList";
import { Button } from "@/components/ui/Atoms/Button";
import type { Issue } from "@/domain/issues";
import { WEAVE_VIEW_KINDS, WEAVE_VIEW_LABELS, type WeaveViewKind } from "@/server/services/weaveService";
import { WEAVE } from "@/ui/labels";
import { WEAVE_BEAT_PRESETS } from "@/world/weaveBeatPresets";
import { importWeavePresetTemplateAction, instantiateWeavePresetAction } from "./actions";

export function StarterBeatSheets({
  projectId,
  compact = false,
}: {
  projectId: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [pending, startTransition] = useTransition();
  const [viewKind, setViewKind] = useState<Record<string, WeaveViewKind>>({});

  const startGrid = (presetId: string) => {
    startTransition(async () => {
      const result = await instantiateWeavePresetAction(projectId, presetId, {
        viewKind: viewKind[presetId] ?? "original",
      });
      if (!result.ok) {
        setIssues(result.issues);
        return;
      }
      router.push(`/projects/${encodeURIComponent(projectId)}/plan/weave/${encodeURIComponent(result.gridId)}`);
    });
  };

  return (
    <section className="panel" aria-labelledby="starter-beat-sheets">
      <h2 id="starter-beat-sheets">{WEAVE.presetHeading}</h2>
      {compact ? null : <p className="small muted">{WEAVE.presetLead}</p>}
      <IssueList issues={issues} />
      <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {WEAVE_BEAT_PRESETS.map((preset) => (
          <li key={preset.id} className="stack" style={{ gap: "0.35rem" }}>
            <div>
              <strong>{preset.title}</strong>
              <p className="small muted" style={{ margin: "0.15rem 0 0" }}>
                {preset.description} {WEAVE.beatsCount(preset.beats.length)}.
                {preset.attribution ? ` ${preset.attribution}.` : null}
              </p>
              {preset.sourceUrl ? (
                <p className="small" style={{ margin: "0.15rem 0 0" }}>
                  <a href={preset.sourceUrl} target="_blank" rel="noreferrer">
                    {WEAVE.presetSource}
                  </a>
                </p>
              ) : null}
            </div>
            <div className="row" style={{ gap: "0.35rem", flexWrap: "wrap", alignItems: "end" }}>
              <label className="small">
                {WEAVE.applyAsView}
                <select
                  value={viewKind[preset.id] ?? "original"}
                  aria-label={`${WEAVE.applyAsView}: ${preset.title}`}
                  onChange={(e) => setViewKind((current) => ({ ...current, [preset.id]: e.target.value as WeaveViewKind }))}
                >
                  {WEAVE_VIEW_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {WEAVE_VIEW_LABELS[kind]}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="button" size="sm" disabled={pending} onClick={() => startGrid(preset.id)}>
                {WEAVE.presetStartGrid}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await importWeavePresetTemplateAction(projectId, preset.id);
                    if (!result.ok) setIssues(result.issues);
                    else if (compact) router.push(`/projects/${encodeURIComponent(projectId)}/plan/weave/templates`);
                    else router.refresh();
                  })
                }
              >
                {WEAVE.presetSaveTemplate}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
