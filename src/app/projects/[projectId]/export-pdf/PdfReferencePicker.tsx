"use client";

import { useState } from "react";
import { CanonBadge } from "@/components/Badges";
import type { AuthorityStatus } from "@/domain/statuses";
import { Checkbox } from "@/components/ui/Atoms/Checkbox";
import { PDF } from "@/ui/labels";

export interface PdfPickerGroup {
  type: string;
  label: string;
  records: { id: string; title: string; authorityStatus: AuthorityStatus; imageCount: number }[];
}

/** A plain GET form, so the browser downloads the PDF and the page stays as it is. */
export function PdfReferencePicker({
  action,
  docxAction,
  epubAction,
  markdownAction,
  wikiAction,
  spoilerChapters = [],
  groups,
  initialSelection,
}: {
  action: string;
  docxAction: string;
  epubAction: string;
  markdownAction: string;
  wikiAction: string;
  spoilerChapters?: { id: string; title: string }[];
  groups: PdfPickerGroup[];
  initialSelection: string[];
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSelection));
  const [wikiCeilingApproved, setWikiCeilingApproved] = useState(false);
  const [wikiSpoilerBefore, setWikiSpoilerBefore] = useState("");
  const toggle = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });

  return (
    <form method="get" action={action} className="stack pdf-picker">
      <input type="hidden" name="kind" value="references" />
      {wikiCeilingApproved ? <input type="hidden" name="ceiling" value="approved" /> : null}
      {wikiSpoilerBefore ? <input type="hidden" name="spoilerBefore" value={wikiSpoilerBefore} /> : null}
      {groups.map((group) => {
        const ids = group.records.map((r) => r.id);
        const allOn = ids.every((id) => selected.has(id));
        return (
          <fieldset key={group.type} className="panel">
            <legend className="sr-only">{group.label}</legend>
            <Checkbox
              className="pdf-group-label"
              checked={allOn}
              onChange={(e) => toggle(ids, e.target.checked)}
              aria-label={PDF.selectAll(group.label)}
              label={
                <>
                  {group.label} <span className="small muted">({group.records.length})</span>
                </>
              }
            />
            <div className="stack pdf-group-items">
              {group.records.map((r) => (
                <Checkbox
                  key={r.id}
                  name="record"
                  value={r.id}
                  checked={selected.has(r.id)}
                  onChange={(e) => toggle([r.id], e.target.checked)}
                  label={
                    <>
                      {r.title} <CanonBadge status={r.authorityStatus} />
                      {r.imageCount ? <span className="small muted">{PDF.imageCount(r.imageCount)}</span> : null}
                    </>
                  }
                />
              ))}
            </div>
          </fieldset>
        );
      })}
      <div className="row">
        <button type="submit" disabled={selected.size === 0}>
          {PDF.downloadReferences(selected.size)}
        </button>
        <button type="submit" formAction={docxAction} formMethod="get" disabled={selected.size === 0}>
          {PDF.downloadReferencesDocx(selected.size)}
        </button>
        <button type="submit" formAction={epubAction} formMethod="get" disabled={selected.size === 0}>
          {PDF.downloadReferencesEpub(selected.size)}
        </button>
        <button type="submit" formAction={markdownAction} formMethod="get" disabled={selected.size === 0}>
          {PDF.downloadReferencesMarkdown(selected.size)}
        </button>
        <button type="submit" formAction={wikiAction} formMethod="get" disabled={selected.size === 0}>
          {PDF.downloadReferencesWiki(selected.size)}
        </button>
        {selected.size === 0 ? (
          <span className="small muted" role="status">
            {PDF.nothingSelected}
          </span>
        ) : null}
      </div>
      <fieldset className="stack panel" style={{ border: "none", padding: 0, margin: 0 }}>
        <legend className="h3">{PDF.wikiOptionsHeading}</legend>
        <p className="small muted">{PDF.wikiFormatsNote}</p>
        <Checkbox
          checked={wikiCeilingApproved}
          onChange={(e) => setWikiCeilingApproved(e.target.checked)}
          label={PDF.wikiSpoilerApproved}
        />
        {spoilerChapters.length ? (
          <label className="stack">
            <span>{PDF.wikiSpoilerBefore}</span>
            <select
              className="input"
              value={wikiSpoilerBefore}
              onChange={(e) => setWikiSpoilerBefore(e.target.value)}
            >
              <option value="">{PDF.wikiSpoilerBeforeNone}</option>
              {spoilerChapters.map((chapter) => (
                <option key={chapter.id} value={chapter.id}>
                  {chapter.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <p className="small muted">
          Spoiler options apply only to the HTML wiki download. They filter selected documents or established facts in
          infoboxes; they do not change records.
        </p>
      </fieldset>
    </form>
  );
}
