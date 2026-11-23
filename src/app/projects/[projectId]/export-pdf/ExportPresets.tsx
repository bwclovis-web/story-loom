"use client";

import { useActionState } from "react";
import { IssueList } from "@/components/IssueList";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Atoms/Button";
import { submitWithoutReset } from "@/components/submitWithoutReset";
import { COMPILE_PROFILE } from "@/ui/labels";
import { activeExportPresetId, type ExportPresetId } from "@/writing/exportPresets";
import type { CompileProfileView } from "@/server/services/compileProfileService";
import { applyExportPresetAction, type CompileProfileFormResult } from "./actions";

function Result({ state }: { state: CompileProfileFormResult }) {
  if (!state.ok && state.issues?.length) return <IssueList issues={state.issues} />;
  if (state.message) return <Banner tone={state.ok ? "ok" : "error"}>{state.message}</Banner>;
  return null;
}

const PRESETS: { id: ExportPresetId; label: string }[] = [
  { id: "standard_manuscript", label: COMPILE_PROFILE.presetStandard },
  { id: "formatter_ready", label: COMPILE_PROFILE.presetFormatter },
  { id: "paperback", label: COMPILE_PROFILE.presetPaperback },
  { id: "ebook", label: COMPILE_PROFILE.presetEbook },
  { id: "beta_reader", label: COMPILE_PROFILE.presetBeta },
  { id: "world_guide", label: COMPILE_PROFILE.presetWorldGuide },
];

export function ExportPresets({
  projectId,
  profile,
}: {
  projectId: string;
  profile: CompileProfileView;
}) {
  const [state, apply, pending] = useActionState<CompileProfileFormResult, FormData>(
    applyExportPresetAction.bind(null, projectId),
    { ok: true },
  );
  const active = activeExportPresetId(profile);

  return (
    <div className="stack">
      <p className="small muted">{COMPILE_PROFILE.presetsIntro}</p>
      <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
        {PRESETS.map((preset) => (
          <form key={preset.id} onSubmit={submitWithoutReset(apply)}>
            <input type="hidden" name="preset" value={preset.id} />
            <Button type="submit" disabled={pending} variant={active === preset.id ? "primary" : "secondary"}>
              {preset.label}
              {active === preset.id ? ` ${COMPILE_PROFILE.presetActive}` : ""}
            </Button>
          </form>
        ))}
      </div>
      <p className="small muted">{COMPILE_PROFILE.presetsNote}</p>
      <Result state={state} />
    </div>
  );
}
