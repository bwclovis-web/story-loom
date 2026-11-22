"use client";

import { useActionState } from "react";
import { IssueList } from "@/components/IssueList";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { submitWithoutReset } from "@/components/submitWithoutReset";
import { COMPILE_PROFILE } from "@/ui/labels";
import { isFormatterReadyProfile, isStandardManuscriptProfile } from "@/writing/exportPresets";
import type { CompileProfileView } from "@/server/services/compileProfileService";
import { applyExportPresetAction, type CompileProfileFormResult } from "./actions";

function Result({ state }: { state: CompileProfileFormResult }) {
  if (!state.ok && state.issues?.length) return <IssueList issues={state.issues} />;
  if (state.message) return <Banner tone={state.ok ? "ok" : "error"}>{state.message}</Banner>;
  return null;
}

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
  const standardActive = isStandardManuscriptProfile(profile);
  const formatterActive = isFormatterReadyProfile(profile);

  return (
    <div className="stack">
      <p className="small muted">{COMPILE_PROFILE.presetsIntro}</p>
      <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
        <form onSubmit={submitWithoutReset(apply)}>
          <input type="hidden" name="preset" value="standard_manuscript" />
          <Button type="submit" disabled={pending} variant={standardActive ? "primary" : "secondary"}>
            {COMPILE_PROFILE.presetStandard}
            {standardActive ? ` ${COMPILE_PROFILE.presetActive}` : ""}
          </Button>
        </form>
        <form onSubmit={submitWithoutReset(apply)}>
          <input type="hidden" name="preset" value="formatter_ready" />
          <Button type="submit" disabled={pending} variant={formatterActive ? "primary" : "secondary"}>
            {COMPILE_PROFILE.presetFormatter}
            {formatterActive ? ` ${COMPILE_PROFILE.presetActive}` : ""}
          </Button>
        </form>
      </div>
      <p className="small muted">{COMPILE_PROFILE.presetsNote}</p>
      <Result state={state} />
    </div>
  );
}
