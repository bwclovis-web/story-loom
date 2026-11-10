"use client";

import { useState } from "react";
import { CanonBadge } from "@/components/Badges";
import type { AuthorityStatus } from "@/domain/statuses";
import { PDF } from "@/ui/labels";

export interface PdfPickerGroup {
  type: string;
  label: string;
  records: { id: string; title: string; authorityStatus: AuthorityStatus; imageCount: number }[];
}

/** A plain GET form, so the browser downloads the PDF and the page stays as it is. */
export function PdfReferencePicker({ action, groups, initialSelection }: { action: string; groups: PdfPickerGroup[]; initialSelection: string[] }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSelection));
  const toggle = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });

  return (
    <form method="get" action={action} className="stack pdf-picker">
      <input type="hidden" name="kind" value="references" />
      {groups.map((group) => {
        const ids = group.records.map((r) => r.id);
        const allOn = ids.every((id) => selected.has(id));
        return (
          <fieldset key={group.type} className="panel">
            <legend className="sr-only">{group.label}</legend>
            <label className="inline pdf-group-label">
              <input type="checkbox" checked={allOn} onChange={(e) => toggle(ids, e.target.checked)} aria-label={PDF.selectAll(group.label)} />
              {group.label} <span className="small muted">({group.records.length})</span>
            </label>
            <div className="stack pdf-group-items">
              {group.records.map((r) => (
                <label key={r.id} className="inline">
                  <input
                    type="checkbox"
                    name="record"
                    value={r.id}
                    checked={selected.has(r.id)}
                    onChange={(e) => toggle([r.id], e.target.checked)}
                  />
                  {r.title} <CanonBadge status={r.authorityStatus} />
                  {r.imageCount ? <span className="small muted">{PDF.imageCount(r.imageCount)}</span> : null}
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}
      <div className="row">
        <button type="submit" disabled={selected.size === 0}>
          {PDF.downloadReferences(selected.size)}
        </button>
        {selected.size === 0 ? (
          <span className="small muted" role="status">
            {PDF.nothingSelected}
          </span>
        ) : null}
      </div>
    </form>
  );
}
