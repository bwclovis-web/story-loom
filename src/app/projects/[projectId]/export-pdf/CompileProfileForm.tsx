"use client";

import { useActionState } from "react";
import { IssueList } from "@/components/IssueList";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { submitWithoutReset } from "@/components/submitWithoutReset";
import type { CompileProfileView } from "@/server/services/compileProfileService";
import { CHAPTER_HEADING_STYLE } from "@/server/services/compileProfileService";
import { COMPILE_PROFILE } from "@/ui/labels";
import { saveCompileProfileAction, type CompileProfileFormResult } from "./actions";

function Result({ state }: { state: CompileProfileFormResult }) {
  if (!state.ok && state.issues?.length) return <IssueList issues={state.issues} />;
  if (state.message) return <Banner tone={state.ok ? "ok" : "error"}>{state.message}</Banner>;
  return null;
}

export function CompileProfileForm({ projectId, profile }: { projectId: string; profile: CompileProfileView }) {
  const [state, save, pending] = useActionState<CompileProfileFormResult, FormData>(
    saveCompileProfileAction.bind(null, projectId),
    { ok: true },
  );

  return (
    <form onSubmit={submitWithoutReset(save)} className="stack panel">
      <p className="small muted">{COMPILE_PROFILE.intro}</p>
      <label className="stack">
        {COMPILE_PROFILE.titlePage}
        <textarea name="titlePageBody" rows={4} defaultValue={profile.titlePageBody} />
      </label>
      <label className="stack">
        {COMPILE_PROFILE.dedication}
        <textarea name="dedicationBody" rows={3} defaultValue={profile.dedicationBody} />
      </label>
      <label className="stack">
        {COMPILE_PROFILE.copyright}
        <textarea name="copyrightPageBody" rows={3} defaultValue={profile.copyrightPageBody} />
      </label>
      <label className="stack">
        {COMPILE_PROFILE.acknowledgements}
        <textarea name="acknowledgementsBody" rows={3} defaultValue={profile.acknowledgementsBody} />
      </label>
      <div className="row" style={{ flexWrap: "wrap", gap: "1rem" }}>
        <label>
          {COMPILE_PROFILE.sceneBreakGlyph}
          <input name="sceneBreakGlyph" type="text" defaultValue={profile.sceneBreakGlyph} maxLength={80} />
        </label>
        <label>
          {COMPILE_PROFILE.chapterHeadingStyle}
          <select name="chapterHeadingStyle" defaultValue={profile.chapterHeadingStyle}>
            <option value={CHAPTER_HEADING_STYLE.centered}>{COMPILE_PROFILE.headingCentered}</option>
            <option value={CHAPTER_HEADING_STYLE.left}>{COMPILE_PROFILE.headingLeft}</option>
          </select>
        </label>
      </div>
      <div className="stack">
        <label className="inline">
          <input type="checkbox" name="includeSynopses" value="1" defaultChecked={profile.includeSynopses} />
          {COMPILE_PROFILE.includeSynopses}
        </label>
        <label className="inline">
          <input type="checkbox" name="includeMarginComments" value="1" defaultChecked={profile.includeMarginComments} />
          {COMPILE_PROFILE.includeMarginComments}
        </label>
      </div>
      <Result state={state} />
      <Button type="submit" disabled={pending}>
        {COMPILE_PROFILE.save}
      </Button>
    </form>
  );
}