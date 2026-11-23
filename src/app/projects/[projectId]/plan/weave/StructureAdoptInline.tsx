"use client";

import { useMemo, useState, useTransition } from "react";
import { IssueList } from "@/components/IssueList";
import { Button } from "@/components/ui/Atoms/Button";
import type { Issue } from "@/domain/issues";
import { WEAVE } from "@/ui/labels";
import { WEAVE_BEAT_PRESETS } from "@/world/weaveBeatPresets";
import { adoptWeaveStructuresAction } from "./actions";
import { featuredWeavePresets, StructurePresetOptions } from "./StructurePresetOptions";

export function StructureAdoptInline({
  projectId,
  gridId,
  onDone,
  onCancel,
}: {
  projectId: string;
  gridId: string;
  onDone: (structureIds: string[]) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [showAll, setShowAll] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [duplicates, setDuplicates] = useState<{ presetId: string; title: string }[]>([]);
  const [pending, startTransition] = useTransition();
  const [requestKey, setRequestKey] = useState(() => `inline-adopt-${Date.now()}`);

  const presets = useMemo(
    () => (showAll ? [...WEAVE_BEAT_PRESETS] : featuredWeavePresets()),
    [showAll],
  );
  const chosen = presets.filter((preset) => selected[preset.id]).map((preset) => preset.id);

  const submit = (confirmDuplicates: boolean) => {
    if (!chosen.length) {
      setIssues([{ code: "INVALID_CHANGE", severity: "error", message: WEAVE.structuresNeedChoice }]);
      return;
    }
    startTransition(async () => {
      const result = await adoptWeaveStructuresAction(projectId, {
        presetIds: chosen,
        gridId,
        clientRequestId: requestKey,
        confirmDuplicates,
      });
      if ("needsDuplicateConfirm" in result && result.needsDuplicateConfirm) {
        setDuplicates(result.duplicates);
        setIssues(result.issues);
        return;
      }
      if (!result.ok) {
        setIssues(result.issues);
        return;
      }
      setIssues([]);
      setDuplicates([]);
      setRequestKey(`inline-adopt-${Date.now()}`);
      onDone(result.structureIds);
    });
  };

  return (
    <div className="panel weave-structure-inline">
      <p className="small muted">{WEAVE.structuresLead}</p>
      <IssueList issues={issues} />
      {duplicates.length ? (
        <p className="small" role="status">
          {duplicates.map((d) => WEAVE.structuresDuplicateWarn(d.title)).join(" ")}
        </p>
      ) : null}
      <StructurePresetOptions
        presets={presets}
        selected={selected}
        onToggle={(presetId, checked) =>
          setSelected((current) => ({ ...current, [presetId]: checked }))
        }
      />
      <p className="small muted weave-structure-summary">
        {WEAVE.structuresFooter(chosen.length || 0, "this plan")}
      </p>
      <div className="weave-structure-actions">
        <Button type="button" size="sm" disabled={pending || !chosen.length} onClick={() => submit(false)}>
          {pending ? WEAVE.structuresAdding : WEAVE.structuresAdd}
        </Button>
        {duplicates.length ? (
          <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => submit(true)}>
            {WEAVE.structuresConfirmDuplicate}
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setShowAll((open) => !open)}>
          {showAll ? WEAVE.structuresFeaturedOnly : WEAVE.structuresBrowse}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
