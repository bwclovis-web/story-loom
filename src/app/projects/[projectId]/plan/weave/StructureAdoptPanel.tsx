"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IssueList } from "@/components/IssueList";
import { Button } from "@/components/ui/Atoms/Button";
import { Select } from "@/components/ui/Atoms/Select";
import { RadioGroup } from "@/components/ui/RadioGroup";
import { TextField } from "@/components/ui/TextField";
import type { Issue } from "@/domain/issues";
import { WEAVE_VIEW_KINDS, WEAVE_VIEW_LABELS, type WeaveViewKind } from "@/server/services/weaveService";
import { WEAVE } from "@/ui/labels";
import { adoptWeaveStructuresAction } from "./actions";
import { featuredWeavePresets, StructurePresetOptions } from "./StructurePresetOptions";

export type StructureAdoptGridOption = {
  id: string;
  title: string;
  viewKind: WeaveViewKind;
  viewLabel: string;
};

export function StructureAdoptPanel({
  projectId,
  grids,
}: {
  projectId: string;
  grids: StructureAdoptGridOption[];
}) {
  const router = useRouter();
  const formId = useId();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [destination, setDestination] = useState<"new" | "existing">(grids.length ? "existing" : "new");
  const [viewKind, setViewKind] = useState<WeaveViewKind>("original");
  const [planTitle, setPlanTitle] = useState("");
  const [gridId, setGridId] = useState(grids[0]?.id ?? "");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [duplicates, setDuplicates] = useState<{ presetId: string; title: string }[]>([]);
  const [pending, startTransition] = useTransition();
  const [requestKey, setRequestKey] = useState(() => `adopt-${Date.now()}`);

  const featured = useMemo(() => featuredWeavePresets(), []);
  const chosenIds = featured.filter((preset) => selected[preset.id]).map((preset) => preset.id);
  const existingPlan = grids.find((grid) => grid.id === gridId);
  const summary =
    !chosenIds.length
      ? null
      : destination === "existing"
        ? WEAVE.structuresFooter(chosenIds.length, existingPlan?.title ?? WEAVE.structuresExistingPlan)
        : WEAVE.structuresFooterNew(chosenIds.length, WEAVE_VIEW_LABELS[viewKind]);

  const submit = (confirmDuplicates: boolean) => {
    if (!chosenIds.length) {
      setIssues([{ code: "INVALID_CHANGE", severity: "error", message: WEAVE.structuresNeedChoice }]);
      return;
    }
    if (destination === "new" && !planTitle.trim()) {
      setIssues([{ code: "INVALID_CHANGE", severity: "error", message: WEAVE.structuresNeedName }]);
      return;
    }
    if (destination === "existing" && !gridId) {
      setIssues([{ code: "INVALID_CHANGE", severity: "error", message: "Choose a plan." }]);
      return;
    }
    startTransition(async () => {
      const result = await adoptWeaveStructuresAction(projectId, {
        presetIds: chosenIds,
        ...(destination === "existing"
          ? { gridId }
          : { viewKind, title: planTitle.trim() }),
        confirmDuplicates,
        clientRequestId: requestKey,
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
      setRequestKey(`adopt-${Date.now()}`);
      router.push(`/projects/${encodeURIComponent(projectId)}/plan/weave/${encodeURIComponent(result.gridId)}`);
    });
  };

  return (
    <section className="panel weave-structures" aria-labelledby={`${formId}-heading`}>
      <header className="weave-structures-head">
        <h2 id={`${formId}-heading`}>{WEAVE.structuresHeading}</h2>
        <p className="small muted">{WEAVE.structuresLead}</p>
      </header>
      <IssueList issues={issues} />
      {duplicates.length ? (
        <p className="small" role="status">
          {duplicates.map((d) => WEAVE.structuresDuplicateWarn(d.title)).join(" ")}
        </p>
      ) : null}
      <StructurePresetOptions
        presets={featured}
        selected={selected}
        onToggle={(presetId, checked) =>
          setSelected((current) => ({ ...current, [presetId]: checked }))
        }
      />
      <div className="weave-structure-destination">
        <RadioGroup
          legend={WEAVE.structuresDestination}
          name={`${formId}-destination`}
          layout="row"
          value={destination}
          onValueChange={(value) => setDestination(value as "new" | "existing")}
          options={[
            { value: "new", label: WEAVE.structuresNewPlan },
            ...(grids.length ? [{ value: "existing", label: WEAVE.structuresExistingPlan }] : []),
          ]}
        />
        {destination === "new" ? (
          <div className="weave-structure-fields">
            <TextField
              label={WEAVE.structuresPlanName}
              value={planTitle}
              placeholder={WEAVE.structuresPlanNamePlaceholder}
              autoComplete="off"
              onChange={(event) => setPlanTitle(event.target.value)}
            />
            <Select
              label={WEAVE.structuresPlanKind}
              value={viewKind}
              onChange={(event) => setViewKind(event.target.value as WeaveViewKind)}
            >
              {WEAVE_VIEW_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {WEAVE_VIEW_LABELS[kind]}
                </option>
              ))}
            </Select>
          </div>
        ) : (
          <Select
            className="weave-structure-fields"
            label={WEAVE.structuresChoosePlan}
            value={gridId}
            onChange={(event) => setGridId(event.target.value)}
          >
            {grids.map((grid) => (
              <option key={grid.id} value={grid.id}>
                {grid.title} ({grid.viewLabel})
              </option>
            ))}
          </Select>
        )}
      </div>
      {summary ? <p className="small muted weave-structure-summary">{summary}</p> : null}
      <div className="weave-structure-actions">
        <Button type="button" disabled={pending || !chosenIds.length} onClick={() => submit(false)}>
          {pending
            ? WEAVE.structuresAdding
            : destination === "new"
              ? WEAVE.structuresCreateBeatSheet
              : WEAVE.structuresAdd}
        </Button>
        {duplicates.length ? (
          <Button type="button" variant="secondary" disabled={pending} onClick={() => submit(true)}>
            {WEAVE.structuresConfirmDuplicate}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => router.push(`/projects/${encodeURIComponent(projectId)}/plan/weave/templates`)}
        >
          {WEAVE.structuresBrowse}
        </Button>
      </div>
    </section>
  );
}
