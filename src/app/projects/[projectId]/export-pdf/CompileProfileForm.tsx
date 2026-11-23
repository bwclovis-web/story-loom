"use client";

import { useActionState } from "react";
import { IssueList } from "@/components/IssueList";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Atoms/Checkbox";
import { submitWithoutReset } from "@/components/submitWithoutReset";
import type { CompileProfileView } from "@/server/services/compileProfileService";
import { CHAPTER_HEADING_STYLE } from "@/server/services/compileProfileService";
import { TRIM_SIZE_KEYS, TRIM_SIZES } from "@/writing/compileLayout";
import { BOOK_THEME_KEYS } from "@/writing/bookThemes";
import { COMPILE_PROFILE } from "@/ui/labels";
import { saveCompileProfileAction, type CompileProfileFormResult } from "./actions";

function Result({ state }: { state: CompileProfileFormResult }) {
  if (!state.ok && state.issues?.length) return <IssueList issues={state.issues} />;
  if (state.message) return <Banner tone={state.ok ? "ok" : "error"}>{state.message}</Banner>;
  return null;
}

export function CompileProfileForm({
  projectId,
  profile,
  manuscript,
}: {
  projectId: string;
  profile: CompileProfileView;
  manuscript: { id: string; title: string }[];
}) {
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
      <label className="stack">
        {COMPILE_PROFILE.backMatter}
        <textarea name="backMatterBody" rows={3} defaultValue={profile.backMatterBody} />
      </label>
      <div className="row" style={{ flexWrap: "wrap", gap: "1rem" }}>
        <label>
          {COMPILE_PROFILE.trimSize}
          <select name="trimSize" defaultValue={profile.trimSize}>
            {TRIM_SIZE_KEYS.map((key) => (
              <option key={key} value={key}>
                {TRIM_SIZES[key].label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {COMPILE_PROFILE.marginInches}
          <input name="marginInches" type="number" min={0.5} max={1.25} step={0.05} defaultValue={profile.marginInches} />
        </label>
        <label>
          {COMPILE_PROFILE.bookTheme}
          <select name="bookTheme" defaultValue={profile.bookTheme ?? ""}>
            <option value="">{COMPILE_PROFILE.bookThemeNone}</option>
            {BOOK_THEME_KEYS.map((key) => (
              <option key={key} value={key}>
                {COMPILE_PROFILE.bookThemeOption(key)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {COMPILE_PROFILE.fontPreset}
          <select name="fontPreset" defaultValue={profile.fontPreset}>
            <option value="serif">{COMPILE_PROFILE.fontSerif}</option>
            <option value="sans">{COMPILE_PROFILE.fontSans}</option>
            <option value="mono">{COMPILE_PROFILE.fontMono}</option>
          </select>
        </label>
        <label>
          {COMPILE_PROFILE.spacingPreset}
          <select name="spacingPreset" defaultValue={profile.spacingPreset}>
            <option value="novel">{COMPILE_PROFILE.spacingNovel}</option>
            <option value="tight">{COMPILE_PROFILE.spacingTight}</option>
            <option value="loose">{COMPILE_PROFILE.spacingLoose}</option>
            <option value="manuscript">{COMPILE_PROFILE.spacingManuscript}</option>
          </select>
        </label>
      </div>
      <div className="row" style={{ flexWrap: "wrap", gap: "1rem" }}>
        <label>
          {COMPILE_PROFILE.runningHeader}
          <input name="runningHeader" type="text" maxLength={120} defaultValue={profile.runningHeader} />
        </label>
        <label>
          {COMPILE_PROFILE.runningFooter}
          <input name="runningFooter" type="text" maxLength={120} defaultValue={profile.runningFooter} />
        </label>
      </div>
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
        <Checkbox name="includeSynopses" value="1" defaultChecked={profile.includeSynopses} label={COMPILE_PROFILE.includeSynopses} />
        <Checkbox name="includeMarginComments" value="1" defaultChecked={profile.includeMarginComments} label={COMPILE_PROFILE.includeMarginComments} />
        <Checkbox name="firstParagraphNoIndent" value="1" defaultChecked={profile.firstParagraphNoIndent} label={COMPILE_PROFILE.firstParagraphNoIndent} />
        <Checkbox name="dropCap" value="1" defaultChecked={profile.dropCap} label={COMPILE_PROFILE.dropCap} />
        <Checkbox name="includeToc" value="1" defaultChecked={profile.includeToc} label={COMPILE_PROFILE.includeToc} />
      </div>
      {manuscript.length ? (
        <fieldset className="stack">
          <legend>{COMPILE_PROFILE.includeInCompile}</legend>
          <p className="small muted">{COMPILE_PROFILE.includeInCompileNote}</p>
          {manuscript.map((item) => (
            <div key={item.id}>
              <input type="hidden" name="manuscriptId" value={item.id} />
              <Checkbox
                name="includeRecord"
                value={item.id}
                defaultChecked={!profile.excludedRecordIds.includes(item.id)}
                label={item.title}
              />
            </div>
          ))}
        </fieldset>
      ) : null}
      <Result state={state} />
      <Button type="submit" disabled={pending}>
        {COMPILE_PROFILE.save}
      </Button>
    </form>
  );
}